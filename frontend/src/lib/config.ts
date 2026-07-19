// 実行時設定。デプロイ後に S3 へ置かれる /config.json を読み込む。
// ビルド時結合を避けることで、同一ビルドを異なる環境へ配れる。
// ローカル開発では Vite の環境変数 (VITE_*) にフォールバックする。

export interface RuntimeConfig {
  apiEndpoint: string;
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  /** 対象フロア一覧 (config.json ではカンマ区切り文字列で届く)。 */
  floors: string[];
}

function parseFloors(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function fromEnv(): RuntimeConfig {
  return {
    apiEndpoint: import.meta.env.VITE_API_ENDPOINT ?? '',
    region: import.meta.env.VITE_AWS_REGION ?? 'ap-northeast-1',
    userPoolId: import.meta.env.VITE_USER_POOL_ID ?? '',
    userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID ?? '',
    floors: parseFloors(import.meta.env.VITE_FLOORS ?? '1,2,3'),
  };
}

interface RawConfig {
  apiEndpoint: string;
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  floors: string;
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
        return { ...data, floors: parseFloors(data.floors) };
      }
    }
  } catch {
    // ネットワーク不通など: 環境変数へフォールバック
  }
  return fromEnv();
}
