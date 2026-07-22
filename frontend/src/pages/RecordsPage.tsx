// ケア記録画面: 母語入力→LLM構造化→下書き確認・修正→承認、承認済み一覧。

import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Mic, Square } from 'lucide-react';
import { useApi, useApp } from '../lib/appContext';
import type { ApiClient, SpeakLang } from '../lib/api';
import { MAX_RECORD_TEXT_CHARS } from '../lib/constants';
import { useApproveRecord, useCreateRecord, useRecords, useResidents } from '../lib/queries';
import type { CareRecord, Category, Resident } from '../types';
import { CATEGORIES } from '../types';
import { CategoryBadge } from '../components/badges';
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorText,
  Label,
  Select,
  Spinner,
  Textarea,
} from '../components/ui';

/** UI 言語コードから、話す言語 (Transcribe 対応の ja/en/vi) を求める。 */
function toSpeakLang(uiLang: string): SpeakLang {
  const base = uiLang.split('-')[0];
  return base === 'en' || base === 'vi' ? base : 'ja';
}

/** MediaRecorder が対応する音声形式から、送信用 content-type と拡張子を決める。 */
function audioFormat(mime: string): { contentType: string; ext: string } {
  const base = mime.split(';')[0].trim().toLowerCase();
  switch (base) {
    case 'audio/mp4':
      return { contentType: 'audio/mp4', ext: 'mp4' };
    case 'audio/ogg':
      return { contentType: 'audio/ogg', ext: 'ogg' };
    case 'audio/mpeg':
      return { contentType: 'audio/mpeg', ext: 'mp3' };
    default:
      // webm/opus が最も広く使える既定
      return { contentType: 'audio/webm', ext: 'webm' };
  }
}

/** ブラウザが録音に対応している形式を1つ選ぶ (非対応なら undefined = 既定に委ねる)。 */
function pickRecordingMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const m of ['audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

/** 文字起こしジョブを完了までポーリングし、テキストを返す。 */
async function pollTranscription(api: ApiClient, jobName: string): Promise<string> {
  const INTERVAL_MS = 2000;
  const MAX_ATTEMPTS = 45; // 最大 ~90 秒
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const res = await api.getTranscription(jobName);
    if (res.status === 'completed') return res.text ?? '';
    if (res.status === 'failed') throw new Error('transcription failed');
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
  throw new Error('transcription timed out');
}

type VoiceState = 'idle' | 'recording' | 'transcribing';

/**
 * マイク録音 → S3 直アップロード → バッチ Transcribe → テキスト取得までを担う。
 * 完了したテキストは `onTranscript` に渡す (呼び出し側が Textarea へ反映)。
 */
function useVoiceCapture(onTranscript: (text: string) => void) {
  const api = useApi();
  const [state, setState] = useState<VoiceState>('idle');
  // 'micDenied' | 'transcribeFailed' の i18n キー、または null
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  };

  const finish = async (lang: SpeakLang) => {
    setState('transcribing');
    const recorder = recorderRef.current;
    const mime = recorder?.mimeType || 'audio/webm';
    stopStream();
    const { contentType, ext } = audioFormat(mime);
    const blob = new Blob(chunksRef.current, { type: contentType });
    try {
      const { url, key } = await api.createAudioUploadUrl(contentType, ext);
      await api.uploadAudio(url, blob, contentType);
      const { job_name } = await api.startTranscription(key, lang);
      const text = await pollTranscription(api, job_name);
      onTranscript(text);
      setState('idle');
    } catch {
      setErrorKey('transcribeFailed');
      setState('idle');
    }
  };

  const start = async (lang: SpeakLang) => {
    setErrorKey(null);
    if (
      typeof MediaRecorder === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setErrorKey('micDenied');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErrorKey('micDenied');
      return;
    }
    streamRef.current = stream;
    const mime = pickRecordingMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => void finish(lang);
    recorderRef.current = recorder;
    recorder.start();
    setState('recording');
  };

  const stop = () => {
    recorderRef.current?.stop();
  };

  return { state, errorKey, start, stop };
}

export function RecordsPage() {
  const { t } = useTranslation();
  const { floor } = useApp();
  // 退所者も含める。過去記録の参照先が退所していても氏名を解決できるようにするため
  const residents = useResidents(floor, true);
  const records = useRecords({ floor });
  const residentName = (id: string): string =>
    residents.data?.find((r) => r.id === id)?.name ?? id;

  const drafts = records.data?.filter((r) => r.status === 'draft') ?? [];
  const approved = records.data?.filter((r) => r.status === 'approved') ?? [];

  return (
    <div className="space-y-6">
      {/* ページタイトルは共通ヘッダーが出す (Layout がルートから解決) */}
      {/* 新規投稿先は在籍者のみ。退所者に新しい記録は書けない */}
      <ComposeCard
        floor={floor}
        residents={(residents.data ?? []).filter((r) => r.status === 'active')}
      />

      <section className="space-y-4">
        <SectionHeading label={t('records.listDraft')} count={drafts.length} />
        {drafts.length === 0 && <EmptyState message={t('records.empty')} />}
        {drafts.map((rec) => (
          <DraftCard key={rec.id} record={rec} floor={floor} residents={residents.data ?? []} />
        ))}
      </section>

      <section className="space-y-3">
        <SectionHeading label={t('records.listApproved')} count={approved.length} />
        {approved.length === 0 && <EmptyState message={t('records.empty')} />}
        {approved.map((rec) => (
          <Card key={rec.id}>
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={rec.category} />
              <span className="text-section text-label">{residentName(rec.resident_id)}</span>
              <span className="ml-auto text-caption tabular-nums text-label-3">
                {rec.created_at}
              </span>
            </div>
            <p className="mt-2 text-label">{rec.body_ja}</p>
            {rec.lang !== 'ja' && (
              <p className="mt-2 border-t border-separator pt-2 text-caption text-label-3">
                {t('records.original')} ({rec.lang}): {rec.original_text}
              </p>
            )}
          </Card>
        ))}
      </section>
    </div>
  );
}

// 見出しはサイズではなくウェイトと色で立たせる (HIG)。件数は補助情報として淡く添える。
function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <h2 className="flex items-baseline gap-2 text-section text-label">
      {label}
      <span className="text-caption font-normal tabular-nums text-label-3">{count}</span>
    </h2>
  );
}

// 利用者は必ず選ぶ (LLM に「誰の記録か」を推定させない)。文字数上限は
// backend/api/src/services/records.rs::MAX_TEXT_CHARS と一致させる。
const composeSchema = z.object({
  resident_id: z.string().min(1),
  text: z.string().trim().min(1).max(MAX_RECORD_TEXT_CHARS),
});
type ComposeValues = z.infer<typeof composeSchema>;

function ComposeCard({ floor, residents }: { floor: string; residents: Resident[] }) {
  const { t, i18n } = useTranslation();
  const create = useCreateRecord();
  // 話す言語は既定を現在の UI 言語にし、職員が明示選択する (自動言語判定は使わない)
  const [speakLang, setSpeakLang] = useState<SpeakLang>(() => toSpeakLang(i18n.language));

  const { register, handleSubmit, reset, setValue, getValues, watch, formState } =
    useForm<ComposeValues>({
      resolver: zodResolver(composeSchema),
      mode: 'onChange',
      defaultValues: { resident_id: '', text: '' },
    });
  const text = watch('text');

  // 文字起こし結果は既存本文に追記する (手入力を消さない)。職員が Textarea で編集して送信する。
  const voice = useVoiceCapture((transcript) => {
    if (!transcript.trim()) return;
    const prev = getValues('text');
    setValue('text', prev.trim() ? `${prev.trim()}\n${transcript}` : transcript, {
      shouldValidate: true,
      shouldDirty: true,
    });
  });

  const onSubmit = handleSubmit(async (values) => {
    await create.mutateAsync({ floor, resident_id: values.resident_id, text: values.text });
    reset();
  });

  // 利用者が 1 人も登録されていないと投稿できない。行き止まりにせず登録画面へ誘導する
  if (residents.length === 0) {
    return (
      <Card>
        <CardTitle className="mb-2">{t('records.compose')}</CardTitle>
        <p className="text-sub text-label-2">{t('records.noResidents')}</p>
        <Link
          to="/residents"
          className="mt-4 inline-flex items-center gap-1 rounded-control px-2 py-1 text-sub font-medium text-accent-ink outline-none transition-colors duration-200 ease-standard hover:text-accent-hover focus-visible:ring-3 focus-visible:ring-accent/40"
        >
          {t('records.goToResidents')} ›
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <CardTitle className="mb-6">{t('records.compose')}</CardTitle>
      <form onSubmit={(e) => void onSubmit(e)}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="resident">{t('records.resident')}</Label>
            <Select id="resident" {...register('resident_id')}>
              <option value="">{t('records.selectResident')}</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.room})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="memo">{t('records.memo')}</Label>
            <Textarea id="memo" rows={3} placeholder={t('records.placeholder')} {...register('text')} />
            <p className="mt-1 text-caption text-label-3">
              {text.length}/{MAX_RECORD_TEXT_CHARS}
            </p>
          </div>
          {/* 音声入力: 話す言語を選び、録音→文字起こし結果を上の本文へ追記する */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="speak-lang">{t('records.speakLang')}</Label>
              <Select
                id="speak-lang"
                value={speakLang}
                disabled={voice.state !== 'idle'}
                onChange={(e) => setSpeakLang(e.target.value as SpeakLang)}
              >
                <option value="ja">日本語</option>
                <option value="en">English</option>
                <option value="vi">Tiếng Việt</option>
              </Select>
            </div>
            {voice.state === 'recording' ? (
              <Button variant="danger" onClick={() => voice.stop()}>
                <Square aria-hidden="true" />
                {t('records.stopRecording')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={voice.state === 'transcribing'}
                onClick={() => void voice.start(speakLang)}
              >
                {voice.state === 'transcribing' ? (
                  <Spinner label={t('records.transcribing')} />
                ) : (
                  <>
                    <Mic aria-hidden="true" />
                    {t('records.voiceInput')}
                  </>
                )}
              </Button>
            )}
            {voice.state === 'recording' && (
              <span className="flex items-center gap-2 text-sub text-danger-ink">
                <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-danger" />
                {t('records.recording')}
              </span>
            )}
          </div>
          {voice.errorKey && <ErrorText>{t(`records.${voice.errorKey}`)}</ErrorText>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={create.isPending || !formState.isValid}>
              {create.isPending ? (
                <Spinner label={t('records.structuring')} />
              ) : (
                t('records.structure')
              )}
            </Button>
            {!formState.isValid && !create.isPending && (
              <span className="text-sub text-label-3">
                {formState.errors.resident_id
                  ? t('records.selectResidentHint')
                  : text.length > MAX_RECORD_TEXT_CHARS
                    ? t('records.tooLongHint', { max: MAX_RECORD_TEXT_CHARS })
                    : t('records.enterMemoHint')}
              </span>
            )}
          </div>
          {create.isError && <ErrorText>{t('common.error')}</ErrorText>}
        </div>
      </form>
    </Card>
  );
}

function DraftCard({
  record,
  floor,
  residents,
}: {
  record: CareRecord;
  floor: string;
  residents: Resident[];
}) {
  const { t } = useTranslation();
  const approve = useApproveRecord();
  const [residentId, setResidentId] = useState(record.resident_id);
  const [category, setCategory] = useState<Category>(record.category);
  const [bodyJa, setBodyJa] = useState(record.body_ja);

  const onApprove = async () => {
    await approve.mutateAsync({
      id: record.id,
      input: {
        floor,
        created_at: record.created_at,
        resident_id: residentId,
        category,
        body_ja: bodyJa,
      },
    });
  };

  return (
    <Card tone="warn">
      <p className="mb-4 flex items-center gap-2 text-section text-warn-ink">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />
        {t('records.draftTitle')}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`res-${record.id}`}>{t('records.resident')}</Label>
          <Select
            id={`res-${record.id}`}
            value={residentId}
            onChange={(e) => setResidentId(e.target.value)}
          >
            <option value="">--</option>
            {residents.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.room})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`cat-${record.id}`}>{t('records.category')}</Label>
          <Select
            id={`cat-${record.id}`}
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`body-${record.id}`}>{t('records.bodyJa')}</Label>
          <Textarea
            id={`body-${record.id}`}
            rows={2}
            value={bodyJa}
            onChange={(e) => setBodyJa(e.target.value)}
          />
        </div>
      </div>
      <p className="mt-3 border-t border-warn-muted pt-3 text-caption text-label-2">
        {t('records.original')} ({record.lang}): {record.original_text}
      </p>
      {/*
        母語(en/vi)入力のとき、日本語記録(body_ja)を原文言語へ逆翻訳した確認用テキストを併記する。
        原文(母語・そのまま読める)と逆翻訳を並べることで、外国人職員が「整形で意味が変わって
        いないか」を承認前に母語で照合できる (human-in-the-loop の実効性を担保)。
        表示は対応言語(en/vi)に限定し、LLM が日本語を zh 等と誤判定しても無関係な逆翻訳を出さない。
      */}
      {(record.lang === 'en' || record.lang === 'vi') && record.verification_text && (
        <p className="mt-2 text-caption text-label-2">
          {t('records.verification')}: {record.verification_text}
        </p>
      )}
      {approve.isError && <ErrorText>{t('common.error')}</ErrorText>}
      <div className="mt-4">
        <Button disabled={approve.isPending || !residentId} onClick={() => void onApprove()}>
          {approve.isPending ? <Spinner label={t('records.approving')} /> : t('records.approve')}
        </Button>
      </div>
    </Card>
  );
}
