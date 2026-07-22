// 401 検知による強制ログアウトの仲介。
//
// queryClient (App.tsx) は React ツリー外のモジュールレベルで構築され、AuthProvider より
// 先に存在するため useAuth() を直接呼べない。ここで最小限のリスナー登録を仲介する。

type Listener = () => void;

let listener: Listener | null = null;

/** ログアウト処理を登録する (AuthProvider がマウント時に登録・アンマウント時に解除する)。 */
export function registerForceLogout(fn: Listener | null): void {
  listener = fn;
}

/** 登録済みのログアウト処理を呼び出す (ApiError.status===401 を検知した箇所から呼ぶ)。 */
export function triggerForceLogout(): void {
  listener?.();
}
