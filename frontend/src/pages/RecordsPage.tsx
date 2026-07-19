// ケア記録画面: 母語入力→LLM構造化→下書き確認・修正→承認、承認済み一覧。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/appContext';
import { useApproveRecord, useCreateRecord, useRecords, useResidents } from '../lib/queries';
import type { CareRecord, Category, Resident } from '../types';
import { CATEGORIES } from '../types';
import { CategoryBadge } from '../components/badges';
import { Button, Card, ErrorText, Label, Select, Textarea } from '../components/ui';

export function RecordsPage() {
  const { t } = useTranslation();
  const { floor } = useApp();
  const residents = useResidents(floor);
  const records = useRecords({ floor });
  const residentName = (id: string): string =>
    residents.data?.find((r) => r.id === id)?.name ?? id;

  const drafts = records.data?.filter((r) => r.status === 'draft') ?? [];
  const approved = records.data?.filter((r) => r.status === 'approved') ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">{t('records.title')}</h1>

      <ComposeCard floor={floor} residents={residents.data ?? []} />

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-700">{t('records.listDraft')}</h2>
        {drafts.length === 0 && <p className="text-slate-500">{t('records.empty')}</p>}
        {drafts.map((rec) => (
          <DraftCard key={rec.id} record={rec} floor={floor} residents={residents.data ?? []} />
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-700">{t('records.listApproved')}</h2>
        {approved.length === 0 && <p className="text-slate-500">{t('records.empty')}</p>}
        {approved.map((rec) => (
          <Card key={rec.id}>
            <div className="flex items-center gap-2">
              <CategoryBadge category={rec.category} />
              <span className="font-medium text-slate-800">{residentName(rec.resident_id)}</span>
              <span className="ml-auto text-xs text-slate-400">{rec.created_at}</span>
            </div>
            <p className="mt-2 text-slate-700">{rec.body_ja}</p>
            {rec.lang !== 'ja' && (
              <p className="mt-1 text-xs text-slate-400">
                {t('records.original')} ({rec.lang}): {rec.original_text}
              </p>
            )}
          </Card>
        ))}
      </section>
    </div>
  );
}

function ComposeCard({ floor, residents }: { floor: string; residents: Resident[] }) {
  const { t } = useTranslation();
  const create = useCreateRecord();
  const [text, setText] = useState('');
  const [residentId, setResidentId] = useState('');

  const onStructure = async () => {
    if (!text.trim()) return;
    await create.mutateAsync({ floor, resident_id: residentId || undefined, text });
    setText('');
    setResidentId('');
  };

  return (
    <Card>
      <h2 className="mb-3 font-semibold text-slate-700">{t('records.compose')}</h2>
      <div className="space-y-3">
        <div>
          <Label htmlFor="memo">{t('records.compose')}</Label>
          <Textarea
            id="memo"
            rows={3}
            value={text}
            placeholder={t('records.placeholder')}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="resident">{t('records.resident')}</Label>
            <Select
              id="resident"
              value={residentId}
              onChange={(e) => setResidentId(e.target.value)}
            >
              <option value="">{t('records.autoDetect')}</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.room})
                </option>
              ))}
            </Select>
          </div>
          <Button disabled={create.isPending || !text.trim()} onClick={() => void onStructure()}>
            {create.isPending ? t('records.structuring') : t('records.structure')}
          </Button>
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
      input: { floor, created_at: record.created_at, resident_id: residentId, category, body_ja: bodyJa },
    });
  };

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <p className="mb-2 text-sm font-semibold text-amber-700">{t('records.draftTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
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
      <p className="mt-2 text-xs text-slate-500">
        {t('records.original')} ({record.lang}): {record.original_text}
      </p>
      {approve.isError && <ErrorText>{t('common.error')}</ErrorText>}
      <div className="mt-3">
        <Button disabled={approve.isPending || !residentId} onClick={() => void onApprove()}>
          {approve.isPending ? t('records.approving') : t('records.approve')}
        </Button>
      </div>
    </Card>
  );
}
