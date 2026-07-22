// API 応答の実行時検証スキーマ (zod)。types.ts の型はここから z.infer で導出し、
// 「型は書いたが実行時は無検証」という食い違いを防ぐ。

import { z } from 'zod';

export const CategorySchema = z.enum([
  'meal',
  'hydration',
  'toileting',
  'vitals',
  'incident',
  'note',
]);

export const RecordStatusSchema = z.enum(['draft', 'approved']);
export const PrioritySchema = z.enum(['attention', 'change', 'none']);
export const ShiftSchema = z.enum(['day', 'night']);
export const ResidentStatusSchema = z.enum(['active', 'discharged']);
export const DeleteResidentOutcomeSchema = z.enum(['deleted', 'discharged']);

export const CareRecordSchema = z.object({
  schema_version: z.number(),
  id: z.string(),
  floor: z.string(),
  resident_id: z.string(),
  category: CategorySchema,
  body_ja: z.string(),
  original_text: z.string(),
  // LLM が検出した言語コード。ja/en/vi 以外の値も返りうるため enum ではなく string。
  lang: z.string(),
  verification_text: z.string().nullable().optional(),
  status: RecordStatusSchema,
  created_by: z.string(),
  created_at: z.string(),
  approved_by: z.string().nullable(),
  approved_at: z.string().nullable(),
});

export const ResidentSchema = z.object({
  schema_version: z.number(),
  id: z.string(),
  floor: z.string(),
  name: z.string(),
  room: z.string(),
  baseline: z.string(),
  created_at: z.string(),
  status: ResidentStatusSchema,
  discharged_at: z.string().nullable(),
});

export const DeleteResidentResponseSchema = z.object({
  outcome: DeleteResidentOutcomeSchema,
});

export const SummaryItemSchema = z.object({
  priority: PrioritySchema,
  resident_id: z.string().nullable(),
  text: z.string(),
  evidence_record_ids: z.array(z.string()),
});

export const AudioUploadUrlSchema = z.object({
  url: z.string(),
  key: z.string(),
});

export const TranscriptionJobSchema = z.object({
  job_name: z.string(),
});

export const TranscriptionStatusSchema = z.object({
  status: z.enum(['in_progress', 'failed', 'completed']),
  text: z.string().optional(),
});

export const HandoverSummarySchema = z.object({
  schema_version: z.number(),
  floor: z.string(),
  date: z.string(),
  shift: z.string(),
  items: z.array(SummaryItemSchema),
  generated_at: z.string(),
});
