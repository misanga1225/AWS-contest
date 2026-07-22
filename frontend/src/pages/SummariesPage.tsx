// 申し送りサマリ画面: 手動生成・3段階優先度表示・根拠記録ドリルダウン・追記表示。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/appContext';
import { currentShift } from '../lib/config';
import { useRecords, useResidents, useSummaries, useTriggerSummary } from '../lib/queries';
import type { CareRecord, HandoverSummary, Priority, Resident, Shift, SummaryItem } from '../types';
import { PriorityBadge } from '../components/badges';
import { Segmented } from '../components/Segmented';
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  SkeletonCard,
  Spinner,
} from '../components/ui';

const PRIORITY_ORDER: Record<Priority, number> = { attention: 0, change: 1, none: 2 };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SummariesPage() {
  const { t } = useTranslation();
  const { floor, config } = useApp();
  const summaries = useSummaries(floor);
  const approvedRecords = useRecords({ floor, status: 'approved' });
  // 退所者も含める。サマリが参照する利用者が退所していても氏名を解決できるようにするため
  const residents = useResidents(floor, true);
  const trigger = useTriggerSummary();
  // 既定は「現在のシフト」。夜勤帯に取った記録が日勤サマリから漏れて空に見えるのを防ぐ
  // (シフト帯未配信なら day)。職員は必要に応じてセレクタで切り替えられる。
  const [shift, setShift] = useState<Shift>(() => currentShift(config.shiftHours) ?? 'day');

  // 表示するサマリは「本日 + 選択中シフト」に一致するもの。
  // 全体最新 (data[0]) を出すとシフトを切り替えても表示が変わらず、別シフトを生成した
  // 瞬間に無関係なサマリへ切り替わってしまう。手動生成が対象とする本日分に揃える。
  const today = todayStr();
  const selected: HandoverSummary | undefined = summaries.data?.find(
    (s) => s.date === today && s.shift === shift,
  );

  const onGenerate = async () => {
    // force=true: 既存の空/古いサマリをそのまま返さず、最新の承認済み記録から作り直す
    await trigger.mutateAsync({ floor, date: today, shift, force: true });
  };

  const shiftOptions = [
    { value: 'day' as const, label: t('summaries.day') },
    { value: 'night' as const, label: t('summaries.night') },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto flex items-center gap-3">
          <Segmented
            options={shiftOptions}
            value={shift}
            onChange={setShift}
            ariaLabel={t('summaries.shift')}
          />
          <Button disabled={trigger.isPending} onClick={() => void onGenerate()}>
            {trigger.isPending ? (
              <Spinner label={t('summaries.generating')} />
            ) : (
              t('summaries.generate')
            )}
          </Button>
        </div>
      </div>

      {trigger.isError && <ErrorText>{t('common.error')}</ErrorText>}

      {/* LLM 出力である旨の注意書き。目立たせすぎず、常に視界には入る位置に置く */}
      <p className="rounded-control border-l-4 border-info bg-info-tint px-4 py-3 text-sub text-label-2">
        {t('summaries.aiNote')}
      </p>

      {summaries.isLoading && (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {selected === undefined && !summaries.isLoading && (
        <EmptyState message={t('summaries.empty')} />
      )}

      {selected && (
        <SummaryView
          summary={selected}
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
      <p className="text-caption tabular-nums text-label-3">
        {t('summaries.generatedAt')}: {summary.generated_at} / {t('summaries.shift')}:{' '}
        {t(`summaries.${summary.shift === 'night' ? 'night' : 'day'}`)}
      </p>

      {/* 項目ゼロのサマリは灰色の生成時刻行しか描画されず「生成できていない」ように
          見えるため、対象記録が無かったことを明示する (生成は成功している)。 */}
      {items.length === 0 ? (
        <Card tone="sunken">
          <p className="text-sub text-label-2">{t('summaries.noItems')}</p>
        </Card>
      ) : (
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
      )}

      {appended.length > 0 && (
        <Card tone="accent">
          <p className="mb-2 text-section text-accent-ink">{t('summaries.appended')}</p>
          <ul className="space-y-1.5">
            {appended.map((r) => (
              <li key={r.id} className="flex gap-2 text-sub text-label">
                <span aria-hidden="true" className="text-label-3">
                  ・
                </span>
                {r.body_ja}
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
        {residentLabel && <span className="text-section text-label">{residentLabel}</span>}
      </div>
      <p className="mt-2 text-label">{item.text}</p>
      {evidence.length > 0 && (
        <details className="group mt-3 border-t border-separator pt-2">
          <summary
            className={[
              'inline-flex cursor-pointer items-center gap-1 rounded-control px-1 py-0.5 text-sub font-medium text-accent-ink outline-none',
              'transition-colors duration-200 ease-standard hover:text-accent-hover',
              'focus-visible:ring-3 focus-visible:ring-accent/40',
            ].join(' ')}
          >
            {/* 自前の開閉シェブロン (::marker は index.css で非表示にしている) */}
            <span
              aria-hidden="true"
              className="transition-transform duration-200 ease-standard group-open:rotate-90"
            >
              ›
            </span>
            {t('summaries.evidence')} ({evidence.length})
          </summary>
          <ul className="mt-2 space-y-1.5 pl-4">
            {evidence.map((r) => (
              <li key={r.id} className="text-sub text-label-2">
                <span className="tabular-nums text-label-3">[{r.created_at}]</span> {r.body_ja}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
