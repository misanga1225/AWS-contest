// バックエンド domain 型に対応する TypeScript 型。API 応答には必ず型を付ける (any 禁止)。

/** ケア記録のカテゴリ (domain::Category と一致)。 */
export type Category = 'meal' | 'hydration' | 'toileting' | 'vitals' | 'incident' | 'note';

/** 記録の確定状態。 */
export type RecordStatus = 'draft' | 'approved';

/** サマリの優先度 3 段階。 */
export type Priority = 'attention' | 'change' | 'none';

/** シフト種別。 */
export type Shift = 'day' | 'night';

/** サポートする UI 言語。 */
export type Lang = 'ja' | 'en' | 'vi';

export const CATEGORIES: readonly Category[] = [
  'meal',
  'hydration',
  'toileting',
  'vitals',
  'incident',
  'note',
];

/** ケア記録。 */
export interface CareRecord {
  schema_version: number;
  id: string;
  floor: string;
  resident_id: string;
  category: Category;
  body_ja: string;
  original_text: string;
  lang: string;
  status: RecordStatus;
  created_by: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
}

/**
 * 利用者の在籍状態。
 * ケア記録には法定の保存義務があるため、記録がある利用者は物理削除せず discharged にする。
 */
export type ResidentStatus = 'active' | 'discharged';

/** 利用者マスタ。 */
export interface Resident {
  schema_version: number;
  id: string;
  floor: string;
  name: string;
  room: string;
  baseline: string;
  created_at: string;
  status: ResidentStatus;
  discharged_at: string | null;
}

/** 利用者の削除要求の結果。記録の有無で挙動が変わる。 */
export type DeleteResidentOutcome = 'deleted' | 'discharged';

export interface DeleteResidentResponse {
  outcome: DeleteResidentOutcome;
}

/** サマリの 1 項目。 */
export interface SummaryItem {
  priority: Priority;
  resident_id: string | null;
  text: string;
  evidence_record_ids: string[];
}

/** 横断申し送りサマリ。 */
export interface HandoverSummary {
  schema_version: number;
  floor: string;
  date: string;
  shift: string;
  items: SummaryItem[];
  generated_at: string;
}
