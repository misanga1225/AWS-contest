// フロントとバックエンドで一致させる必要がある定数。

/**
 * ケアメモ本文の最大文字数。
 * backend/api/src/services/records.rs の MAX_TEXT_CHARS と必ず一致させること
 * (バックエンド側の上限を変更したらここも合わせて変更する)。
 */
export const MAX_RECORD_TEXT_CHARS = 4000;
