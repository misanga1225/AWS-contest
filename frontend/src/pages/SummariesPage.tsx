// 申し送りサマリ画面: 手動生成・3段階優先度表示・根拠記録ドリルダウン・追記表示。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/appContext';
import { useRecords, useResidents, useSummaries, useTriggerSummary } from '../lib/queries';
import type { CareRecord, HandoverSummary, Priority, Resident, Shift, SummaryItem } from '../types';
import { PriorityBadge } from '../components/badges';
import { Button, Card, ErrorText, Select } from '../components/ui';

const PRIORITY_ORDER: Record<Priority, number> = { attention: 0, change: 1, none: 2 };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SummariesPage() {
  const { t } = useTranslation();
  const { floor } = useApp();
  const summaries = useSummaries(floor);
  const approvedRecords = useRecords({ floor, status: 'approved' });
  const residents = useResidents(floor);
  const trigger = useTriggerSummary();
  const [shift, setShift] = useState<Shift>('day');

  const latest: HandoverSummary | undefined = summaries.data?.[0];

  const onGenerate = async () => {
    await trigger.mutateAsync({ floor, date: todayStr(), shift });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-slate-800">{t('summaries.title')}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={shift}
            onChange={(e) => setShift(e.target.value as Shift)}
            aria-label="shift"
          >
            <option value="day">{t('summaries.day')}</option>
            <option value="night">{t('summaries.night')}</option>
          </Select>
          <Button disabled={trigger.isPending} onClick={() => void onGenerate()}>
            {trigger.isPending ? t('summaries.generating') : t('summaries.generate')}
          </Button>
        </div>
      </div>

      {trigger.isError && <ErrorText>{t('common.error')}</ErrorText>}

      <p className="rounded-md bg-slate-100 p-3 text-sm text-slate-600">{t('summaries.aiNote')}</p>

      {summaries.isLoading && <p className="text-slate-500">{t('common.loading')}</p>}
      {latest === undefined && !summaries.isLoading && (
        <p className="text-slate-500">{t('summaries.empty')}</p>
      )}

      {latest && (
        <SummaryView
          summary={latest}
          records={approvedRecords.data ?? []}
          residents={residents.data ?? []}
        />
      )}
    </div>
  );
}

function SummaryView({
  summary,
  records,
  residents,
}: {
  summary: HandoverSummary;
  records: CareRecord[];
  residents: Resident[];
}) {
  const { t } = useTranslation();
  const recordById = new Map(records.map((r) => [r.id, r]));
  const residentName = (id: string | null): string => {
    if (!id) return '';
    return residents.find((r) => r.id === id)?.name ?? id;
  };

  const items = [...summary.items].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );

  // サマリ生成後に承認された記録 = 追記
  const appended = records.filter(
    (r) => r.approved_at !== null && r.approved_at > summary.generated_at,
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        {t('summaries.generatedAt')}: {summary.generated_at} / {t('summaries.shift')}:{' '}
        {t(`summaries.${summary.shift === 'night' ? 'night' : 'day'}`)}
      </p>

      <div className="space-y-3">
        {items.map((item, idx) => (
          <ItemCard
            key={idx}
            item={item}
            residentLabel={residentName(item.resident_id)}
            recordById={recordById}
          />
        ))}
      </div>

      {appended.length > 0 && (
        <Card className="border-sky-200 bg-sky-50/40">
          <p className="mb-2 text-sm font-semibold text-sky-700">{t('summaries.appended')}</p>
          <ul className="space-y-1">
            {appended.map((r) => (
              <li key={r.id} className="text-sm text-slate-700">
                ・{r.body_ja}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ItemCard({
  item,
  residentLabel,
  recordById,
}: {
  item: SummaryItem;
  residentLabel: string;
  recordById: Map<string, CareRecord>;
}) {
  const { t } = useTranslation();
  const evidence = item.evidence_record_ids
    .map((id) => recordById.get(id))
    .filter((r): r is CareRecord => r !== undefined);

  return (
    <Card>
      <div className="flex items-center gap-2">
        <PriorityBadge priority={item.priority} />
        {residentLabel && <span className="text-sm font-medium text-slate-700">{residentLabel}</span>}
      </div>
      <p className="mt-2 text-slate-800">{item.text}</p>
      {evidence.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-sky-700">
            {t('summaries.evidence')} ({evidence.length})
          </summary>
          <ul className="mt-1 space-y-1 pl-4">
            {evidence.map((r) => (
              <li key={r.id} className="text-sm text-slate-600">
                ・[{r.created_at}] {r.body_ja}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
