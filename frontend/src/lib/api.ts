// 型付き API クライアント。全応答に型を付け、Cognito idToken を Authorization に載せる。

import { fetchAuthSession } from 'aws-amplify/auth';
import type { z } from 'zod';
import {
  AudioUploadUrlSchema,
  CareRecordSchema,
  DeleteResidentResponseSchema,
  HandoverSummarySchema,
  ResidentSchema,
  TranscriptionJobSchema,
  TranscriptionStatusSchema,
} from './schemas';
import type {
  AudioUploadUrl,
  CareRecord,
  Category,
  DeleteResidentResponse,
  HandoverSummary,
  Resident,
  Shift,
  TranscriptionJob,
  TranscriptionStatus,
} from '../types';

/** 話す言語 (Transcribe 対応の UI 言語)。 */
export type SpeakLang = 'ja' | 'en' | 'vi';

/** API エラー (HTTP ステータスとメッセージを保持)。 */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface ErrorBody {
  error?: string;
}

async function authHeader(): Promise<Record<string, string>> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface CreateRecordInput {
  floor: string;
  /** 対象利用者。必須（LLM に推定させない） */
  resident_id: string;
  text: string;
}

export interface ApproveRecordInput {
  floor: string;
  created_at: string;
  resident_id: string;
  category: Category;
  body_ja: string;
}

export interface ResidentInput {
  floor: string;
  name: string;
  room: string;
  baseline: string;
}

export interface ListRecordsParams {
  floor: string;
  shift?: Shift;
  date?: string;
  status?: 'draft' | 'approved';
}

export interface TriggerSummaryInput {
  floor: string;
  date?: string;
  shift?: Shift;
  /**
   * 既存サマリがあっても再生成する。職員が明示的に押す手動生成では true を送る
   * (冪等の force=false はスケジューラの再試行による重複課金防止用であり、
   * 人手の「生成」ボタンは常に最新の承認済み記録から作り直すのが期待挙動)。
   */
  force?: boolean;
}

export class ApiClient {
  private readonly base: string;
  constructor(base: string) {
    this.base = base;
  }

  /**
   * `schema` で応答を実行時検証してから返す。サーバーが想定外の形状を返した場合は
   * `ApiError(502, ...)` として扱う — 401 判定 (`status===401`, lib/authEvents 経由の
   * 強制ログアウト) と衝突しないよう、401 以外の合成ステータスにする。
   */
  private async request<T>(
    method: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(await authHeader()),
    };
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const data = (await res.json()) as ErrorBody;
        if (data.error) message = data.error;
      } catch {
        // 本文なし
      }
      throw new ApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    const data: unknown = await res.json();
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new ApiError(502, '応答の形式が不正です');
    }
    return parsed.data;
  }

  // --- 利用者 ---
  listResidents(floor: string, includeDischarged = false): Promise<Resident[]> {
    const q = new URLSearchParams({ floor });
    if (includeDischarged) q.set('include_discharged', 'true');
    return this.request('GET', `/residents?${q.toString()}`, ResidentSchema.array());
  }
  createResident(input: ResidentInput): Promise<Resident> {
    return this.request('POST', '/residents', ResidentSchema, input);
  }
  updateResident(id: string, input: ResidentInput): Promise<Resident> {
    return this.request('PUT', `/residents/${encodeURIComponent(id)}`, ResidentSchema, input);
  }
  deleteResident(id: string, floor: string): Promise<DeleteResidentResponse> {
    return this.request(
      'DELETE',
      `/residents/${encodeURIComponent(id)}?floor=${encodeURIComponent(floor)}`,
      DeleteResidentResponseSchema,
    );
  }
  seedDemo(floors?: string[]): Promise<Resident[]> {
    return this.request(
      'POST',
      '/demo-data',
      ResidentSchema.array(),
      floors ? { floors } : {},
    );
  }

  // --- 記録 ---
  createRecord(input: CreateRecordInput): Promise<CareRecord> {
    return this.request('POST', '/records', CareRecordSchema, input);
  }
  approveRecord(id: string, input: ApproveRecordInput): Promise<CareRecord> {
    return this.request(
      'PUT',
      `/records/${encodeURIComponent(id)}/approve`,
      CareRecordSchema,
      input,
    );
  }
  listRecords(params: ListRecordsParams): Promise<CareRecord[]> {
    const q = new URLSearchParams({ floor: params.floor });
    if (params.shift) q.set('shift', params.shift);
    if (params.date) q.set('date', params.date);
    if (params.status) q.set('status', params.status);
    return this.request('GET', `/records?${q.toString()}`, CareRecordSchema.array());
  }

  // --- 音声入力 (Transcribe) ---
  /** 音声アップロード用のプリサインド PUT URL を発行する。 */
  createAudioUploadUrl(contentType: string, ext: string): Promise<AudioUploadUrl> {
    return this.request('POST', '/uploads/audio-url', AudioUploadUrlSchema, {
      content_type: contentType,
      ext,
    });
  }
  /**
   * プリサインド URL へ音声 Blob を直接 PUT する (S3 直・Authorization ヘッダなし)。
   * ApiClient.request を通さないのは、S3 の署名付き URL に別の Authorization を
   * 載せると署名不一致で拒否されるため。
   */
  async uploadAudio(url: string, blob: Blob, contentType: string): Promise<void> {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: blob,
    });
    if (!res.ok) {
      throw new ApiError(res.status, `音声アップロードに失敗しました (${res.status})`);
    }
  }
  /** 文字起こしジョブを開始する。 */
  startTranscription(key: string, lang: SpeakLang): Promise<TranscriptionJob> {
    return this.request('POST', '/transcribe', TranscriptionJobSchema, { key, lang });
  }
  /** 文字起こしの状態を取得する (ポーリング用)。 */
  getTranscription(jobName: string): Promise<TranscriptionStatus> {
    return this.request(
      'GET',
      `/transcribe/${encodeURIComponent(jobName)}`,
      TranscriptionStatusSchema,
    );
  }

  // --- サマリ ---
  listSummaries(floor: string): Promise<HandoverSummary[]> {
    return this.request(
      'GET',
      `/summaries?floor=${encodeURIComponent(floor)}`,
      HandoverSummarySchema.array(),
    );
  }
  getSummaryDetail(floor: string, date: string, shift: Shift): Promise<HandoverSummary> {
    const q = new URLSearchParams({ floor, date, shift });
    return this.request('GET', `/summaries/detail?${q.toString()}`, HandoverSummarySchema);
  }
  triggerSummary(input: TriggerSummaryInput): Promise<HandoverSummary> {
    return this.request('POST', '/summaries/trigger', HandoverSummarySchema, input);
  }
}
