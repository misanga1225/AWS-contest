// バックエンド domain 型に対応する TypeScript 型。API 応答には必ず型を付ける (any 禁止)。
// 実行時検証は lib/schemas.ts の zod スキーマで行い、型はそこから z.infer で導出する
// (型定義とランタイム検証が乖離しないようにするため)。

import type { z } from 'zod';
import {
  AudioUploadUrlSchema,
  CareRecordSchema,
  CategorySchema,
  DeleteResidentOutcomeSchema,
  DeleteResidentResponseSchema,
  HandoverSummarySchema,
  PrioritySchema,
  RecordStatusSchema,
  ResidentSchema,
  ResidentStatusSchema,
  ShiftSchema,
  SummaryItemSchema,
  TranscriptionJobSchema,
  TranscriptionStatusSchema,
} from './lib/schemas';

/** ケア記録のカテゴリ (domain::Category と一致)。 */
export type Category = z.infer<typeof CategorySchema>;

/** 記録の確定状態。 */
export type RecordStatus = z.infer<typeof RecordStatusSchema>;

/** サマリの優先度 3 段階。 */
export type Priority = z.infer<typeof PrioritySchema>;

/** シフト種別。 */
export type Shift = z.infer<typeof ShiftSchema>;

/** サポートする UI 言語。 */
export type Lang = 'ja' | 'en' | 'vi';

export const CATEGORIES: readonly Category[] = CategorySchema.options;

/** ケア記録。 */
export type CareRecord = z.infer<typeof CareRecordSchema>;

/**
 * 利用者の在籍状態。
 * ケア記録には法定の保存義務があるため、記録がある利用者は物理削除せず discharged にする。
 */
export type ResidentStatus = z.infer<typeof ResidentStatusSchema>;

/** 利用者マスタ。 */
export type Resident = z.infer<typeof ResidentSchema>;

/** 利用者の削除要求の結果。記録の有無で挙動が変わる。 */
export type DeleteResidentOutcome = z.infer<typeof DeleteResidentOutcomeSchema>;

export type DeleteResidentResponse = z.infer<typeof DeleteResidentResponseSchema>;

/** サマリの 1 項目。 */
export type SummaryItem = z.infer<typeof SummaryItemSchema>;

/** 音声アップロード用プリサインド URL の発行結果。 */
export type AudioUploadUrl = z.infer<typeof AudioUploadUrlSchema>;

/** 文字起こしジョブ開始の応答。 */
export type TranscriptionJob = z.infer<typeof TranscriptionJobSchema>;

/** 文字起こしの状態。completed のときのみ text を含む。 */
export type TranscriptionStatus = z.infer<typeof TranscriptionStatusSchema>;

/** 横断申し送りサマリ。 */
export type HandoverSummary = z.infer<typeof HandoverSummarySchema>;
