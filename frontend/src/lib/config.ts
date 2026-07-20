// 実行時設定。デプロイ後に S3 へ置かれる /config.json を読み込む。
// ビルド時結合を避けることで、同一ビルドを異なる環境へ配れる。
// ローカル開発では Vite の環境変数 (VITE_*) にフォールバックする。

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
