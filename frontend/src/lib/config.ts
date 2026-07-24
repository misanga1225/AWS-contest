// 実行時設定。デプロイ後に S3 へ置かれる /config.json を読み込む。
// ビルド時結合を避けることで、同一ビルドを異なる環境へ配れる。
// ローカル開発では Vite の環境変数 (VITE_*) にフォールバックする。

import type { Shift } from '../types';

/**
 * シフト帯の開始時刻 (HH:MM)。**表示用にローカル時刻へ変換済み**。
 *
 * 実体は SSM Parameter Store で、infra が config.json に **UTC** で書き出す
 * (EventBridge Scheduler が UTC で動くため)。UI は職員のローカル時刻で
 * 「いま日勤か夜勤か」を示す必要があるので、読み込み時に変換する。
 *
 * 未配信の環境では undefined になり、UI は時刻を伏せてシフト名も出さない
 * (時刻をフロントにハードコードしない)。
 */
export interface ShiftHours {
  dayStart: string;
  nightStart: string;
}

/**
 * 現在時刻がどのシフト帯かを判定する。
 *
 * シフト帯は SSM 由来 (config.json) をローカル時刻へ変換済み ([`ShiftHours`])。
 * 未配信 (hours 無し) なら null を返し、呼び出し側でシフト表示や既定選択を省く。
 * サマリ生成の既定シフトにも使い、夜勤帯に取った記録が日勤サマリから漏れるのを防ぐ。
 */
export function currentShift(hours: ShiftHours | undefined): Shift | null {
  if (!hours) return null;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMins = (hhmm: string): number => {
    const [h, m] = hhmm.split(':');
    return Number(h) * 60 + Number(m);
  };
  const day = toMins(hours.dayStart);
  const night = toMins(hours.nightStart);
  // 日勤帯 = dayStart 以上 nightStart 未満。日をまたぐ夜勤はその補集合。
  return mins >= day && mins < night ? 'day' : 'night';
}

/**
 * 選択中のシフトが指す対象日 (YYYY-MM-DD, ローカル基準) を返す。
 *
 * 日勤は日をまたがないので常に今日。夜勤は backend (`services::summaries::target_ended_shift`)
 * と同じ規約で「開始日」の日付を返す: 現在時刻がまだ日勤開始前 (=前夜からの夜勤が続いている
 * 時間帯) なら前日、日勤開始後 (=今夜の夜勤はこれから) なら今日。
 * サマリの一覧取得・生成トリガの両方で、この日付を「探す/送る」対象として使う。
 */
export function targetDateForShift(
  hours: ShiftHours | undefined,
  shift: Shift,
  now: Date = new Date(),
): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const dateStr = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (shift === 'day' || !hours) return dateStr(now);
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMins = (hhmm: string): number => {
    const [h, m] = hhmm.split(':');
    return Number(h) * 60 + Number(m);
  };
  if (mins < toMins(hours.dayStart)) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return dateStr(yesterday);
  }
  return dateStr(now);
}

/** UTC の "HH:MM" を、本日の日付基準でローカルの "HH:MM" に変換する。 */
function utcHhmmToLocal(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface RuntimeConfig {
  apiEndpoint: string;
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  /** 対象フロア一覧 (config.json ではカンマ区切り文字列で届く)。 */
  floors: string[];
  /** シフト帯。config.json に無ければ undefined。 */
  shiftHours?: ShiftHours;
}

function parseFloors(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * 両方が UTC の HH:MM 形式のときだけシフト帯として採用し、ローカル時刻に変換する。
 * 片方でも欠けていれば undefined (UI 側でシフト表示を省く)。
 */
function parseShiftHours(dayStartUtc: unknown, nightStartUtc: unknown): ShiftHours | undefined {
  if (typeof dayStartUtc !== 'string' || typeof nightStartUtc !== 'string') return undefined;
  if (!HHMM.test(dayStartUtc) || !HHMM.test(nightStartUtc)) return undefined;
  return {
    dayStart: utcHhmmToLocal(dayStartUtc),
    nightStart: utcHhmmToLocal(nightStartUtc),
  };
}

function fromEnv(): RuntimeConfig {
  return {
    apiEndpoint: import.meta.env.VITE_API_ENDPOINT ?? '',
    region: import.meta.env.VITE_AWS_REGION ?? 'ap-northeast-1',
    userPoolId: import.meta.env.VITE_USER_POOL_ID ?? '',
    userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID ?? '',
    floors: parseFloors(import.meta.env.VITE_FLOORS ?? '1,2,3'),
    shiftHours: parseShiftHours(
      import.meta.env.VITE_SHIFT_DAY_START,
      import.meta.env.VITE_SHIFT_NIGHT_START,
    ),
  };
}

interface RawConfig {
  apiEndpoint: string;
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  floors: string;
  shiftDayStart?: string;
  shiftNightStart?: string;
}

function isRawConfig(v: unknown): v is RawConfig {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.apiEndpoint === 'string' &&
    typeof o.region === 'string' &&
    typeof o.userPoolId === 'string' &&
    typeof o.userPoolClientId === 'string' &&
    typeof o.floors === 'string'
  );
}

/** /config.json を取得し、失敗時は環境変数へフォールバックする。 */
export async function loadConfig(): Promise<RuntimeConfig> {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (res.ok) {
      const data: unknown = await res.json();
      if (isRawConfig(data)) {
        return {
          ...data,
          floors: parseFloors(data.floors),
          shiftHours: parseShiftHours(data.shiftDayStart, data.shiftNightStart),
        };
      }
    }
  } catch {
    // ネットワーク不通など: 環境変数へフォールバック
  }
  return fromEnv();
}
