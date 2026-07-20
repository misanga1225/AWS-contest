// ケア記録画面: 母語入力→LLM構造化→下書き確認・修正→承認、承認済み一覧。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/appContext';
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

function ComposeCard({ floor, residents }: { floor: string; residents: Resident[] }) {
  const { t } = useTranslation();
  const create = useCreateRecord();
  const [text, setText] = useState('');
  const [residentId, setResidentId] = useState('');

  // 利用者は必ず選ぶ。LLM に「誰の記録か」を推定させない
  const canSubmit = text.trim().length > 0 && residentId !== '';

  const onStructure = async () => {
    if (!canSubmit) return;
    await create.mutateAsync({ floor, resident_id: residentId, text });
    setText('');
    setResidentId('');
  };

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
      <div className="space-y-4">
        <div>
          <Label htmlFor="resident">{t('records.resident')}</Label>
          <Select id="resident" value={residentId} onChange={(e) => setResidentId(e.target.value)}>
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
          <Textarea
            id="memo"
            rows={3}
            value={text}
            placeholder={t('records.placeholder')}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={create.isPending || !canSubmit} onClick={() => void onStructure()}>
            {create.isPending ? (
              <Spinner label={t('records.structuring')} />
            ) : (
              t('records.structure')
            )}
          </Button>
          {!canSubmit && !create.isPending && (
            <span className="text-sub text-label-3">
              {residentId === '' ? t('records.selectResidentHint') : t('records.enterMemoHint')}
            </span>
          )}
        </div>
        {create.isError && <ErrorText>{t('common.error')}</ErrorText>}
      </div>
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
      {approve.isError && <ErrorText>{t('common.error')}</ErrorText>}
      <div className="mt-4">
        <Button disabled={approve.isPending || !residentId} onClick={() => void onApprove()}>
          {approve.isPending ? <Spinner label={t('records.approving')} /> : t('records.approve')}
        </Button>
      </div>
    </Card>
  );
}
