// クラス名結合の最小ヘルパー。false/undefined を落として空白1つで連結する。
// clsx / tailwind-merge は依存を増やすため導入しない (後勝ちの解決が必要な箇所は書き方で回避する)。

export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0).join(' ');
}
