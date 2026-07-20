// ホーム: 「今見るべき利用者」と「今日の状況」を3秒以内で把握できることを最優先にした画面。
// 勤務情報 + メインアクション → ダッシュボード指標 → 要注意の利用者 / 最近の記録。

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { useApp } from '../lib/appContext';
import { useRecords, useResidents, useSummaries, useTriggerSummary } from '../lib/queries';
import type { CareRecord, HandoverSummary, Priority, Resident, Shift } from '../types';
import { PriorityBadge } from '../components/badges';
import { Button, Card, CardTitle, EmptyState, ErrorText, Skeleton, Spinner } from '../components/ui';
import type { ShiftHours } from '../lib/config';

const PRIORITY_ORDER: Record<Priority, number> = { attention: 0, change: 1, none: 2 };

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** created_at (ISO) の時刻部分を HH:MM で返す。パースできなければ空文字。 */
function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * 現在時刻がどのシフト帯かを判定する。
 * シフト帯は SSM 由来 (config.json)。未配信なら null を返し、UI はシフト表示を省く。
 */
function currentShift(hours: ShiftHours | undefined): Shift | null {
  if (!hours) return null;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMins = (hhmm: string): number => {
    const [h, m] = hhmm.split(':');
    return Number(h) * 60 + Number(m);
  };
  const day = toMins(hours.dayStart);
  const night = toMins(hours.nightStart);
  // 日勤帯 = dayStart 以上 nightStart 未満。日をまたぐ夜勤はその補集合。
  return mins >= day && mins < night ? 'day' : 'night';
}

export function HomePage() {
  const { t } = useTranslation();
  const { config, floor } = useApp();
  const navigate = useNavigate();

  const records = useRecords({ floor });
  const residents = useResidents(floor, true);
  const summaries = useSummaries(floor);
  const trigger = useTriggerSummary();

  const shift = currentShift(config.shiftHours);

  const all = useMemo(() => records.data ?? [], [records.data]);
  const approved = all.filter((r) => r.status === 'approved');
  const approvedToday = approved.filter((r) => isToday(r.created_at));
  const drafts = all.filter((r) => r.status === 'draft');

  /*
   * サマリは承認済み記録から作る。1件も無いまま生成すると、中身の無いサマリが
   * 出来てしまい (かつ Bedrock を無駄に呼ぶ) ので押させない。
   * 「本日分」ではなく「承認済みが1件でもあるか」で判定する:
   *   夜勤は日付をまたぐため、本日分に限ると深夜帯で誤って押せなくなる。
   */
  const canGenerate = !records.isLoading && approved.length > 0;

  const latest: HandoverSummary | undefined = summaries.data?.[0];

  const onGenerate = async () => {
    await trigger.mutateAsync({ floor, date: todayStr(), shift: shift ?? 'day' });
    void navigate('/summaries');
  };

  // 勤務情報: 「3階フロア / 夜勤」。時刻はシフト帯が配信されている環境でのみ添える。
  const shiftLabel = shift
    ? `${t(`summaries.${shift}`)}${
        config.shiftHours
          ? `（${shift === 'day' ? config.shiftHours.dayStart : config.shiftHours.nightStart}〜）`
          : ''
      }`
    : null;

  return (
    <div className="space-y-8">
      {/* 勤務情報 + メインアクション */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-title text-label">
          {t('home.floorLabel', { floor })}
          {shiftLabel && (
            <>
              <span aria-hidden="true" className="mx-2 text-label-3">
                /
              </span>
              {shiftLabel}
            </>
          )}
        </p>

        <div className="flex w-full flex-col items-start gap-2 sm:w-auto sm:items-end">
          <Button
            onClick={() => void onGenerate()}
            disabled={trigger.isPending || !canGenerate}
            className="w-full sm:w-60"
          >
            {trigger.isPending ? (
              <Spinner label={t('summaries.generating')} />
            ) : (
              <>
                <Sparkles aria-hidden="true" />
                {t('home.createSummary')}
              </>
            )}
          </Button>
          {/* 押せない理由を必ず添える。無効なだけでは理由が分からず手が止まるため */}
          {!canGenerate && !records.isLoading && (
            <span className="text-sub text-label-2">{t('home.needApprovedRecords')}</span>
          )}
        </div>
      </div>

      {trigger.isError && <ErrorText>{t('common.error')}</ErrorText>}

      {/* ダッシュボード指標 */}
      <div className="grid gap-6 sm:grid-cols-2 wide:grid-cols-3">
        <MetricCard
          title={t('home.approvedToday')}
          value={approvedToday.length}
          loading={records.isLoading}
        />
        <MetricCard
          title={t('home.unapproved')}
          value={drafts.length}
          loading={records.isLoading}
          tone={drafts.length > 0 ? 'warn' : 'default'}
        />
      </div>

      {/* 要注意の利用者 / 最近の記録 */}
      <div className="grid gap-6 wide:grid-cols-2">
        <AttentionCard
          summary={latest}
          residents={residents.data ?? []}
          loading={summaries.isLoading}
        />
        <RecentRecordsCard
          records={all.filter((r) => r.status === 'approved')}
          residents={residents.data ?? []}
          loading={records.isLoading}
        />
      </div>
    </div>
  );
}

/** 件数カード。タイトル・件数・単位のみ。数字は 40px 太字。 */
function MetricCard({
  title,
  value,
  loading,
  tone = 'default',
}: {
  title: string;
  value: number;
  loading: boolean;
  tone?: 'default' | 'warn';
}) {
  const { t } = useTranslation();
  return (
    <Card className="flex min-h-35 flex-col justify-between">
      <p className="text-body text-label-2">{title}</p>
      {loading ? (
        <Skeleton className="h-10 w-20" />
      ) : (
        <p className="flex items-baseline gap-1">
          <span
            className={`tabular text-metric ${tone === 'warn' && value > 0 ? 'text-warn-ink' : 'text-label'}`}
          >
            {value}
          </span>
          <span className="text-sub text-label-2">{t('home.unit')}</span>
        </p>
      )}
    </Card>
  );
}

/** 最新サマリの項目を優先度順に並べ、「今見るべき利用者」を先頭に出す。 */
function AttentionCard({
  summary,
  residents,
  loading,
}: {
  summary: HandoverSummary | undefined;
  residents: Resident[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  const nameOf = (id: string | null): string => {
    if (!id) return t('home.wholeFloor');
    return residents.find((r) => r.id === id)?.name ?? id;
  };

  const items = summary ? [...summary.items].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  ) : [];

  return (
    <Card className="flex flex-col">
      <CardTitle>{t('home.attention')}</CardTitle>
      <div className="mt-4 flex-1">
        {loading && <RowSkeletons />}
        {!loading && items.length === 0 && <EmptyState message={t('home.noAttention')} />}
        {!loading &&
          items.map((item, idx) => (
            <Link
              key={idx}
              to="/summaries"
              // 利用者カードはクリック可能。ホバーでわずかにグレーへ、押下で軽く沈む
              className={[
                'flex items-start gap-3 border-b border-hairline px-2 py-4 last:border-b-0',
                'cursor-pointer rounded-control transition-colors duration-200 ease-standard',
                'hover:bg-sunken active:scale-[0.995]',
                'outline-none focus-visible:ring-3 focus-visible:ring-accent/40',
              ].join(' ')}
            >
              <PriorityBadge priority={item.priority} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-label">
                  {nameOf(item.resident_id)}
                </span>
                <span className="clamp-2 mt-0.5 block text-sub text-label-2">{item.text}</span>
              </span>
            </Link>
          ))}
      </div>
    </Card>
  );
}

/** 直近の承認済み記録。時刻と記録者を添える。 */
function RecentRecordsCard({
  records,
  residents,
  loading,
}: {
  records: CareRecord[];
  residents: Resident[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  const nameOf = (id: string): string => residents.find((r) => r.id === id)?.name ?? id;

  // created_at の新しい順に上位5件
  const recent = [...records]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5);

  return (
    <Card className="flex flex-col">
      <CardTitle>{t('home.recent')}</CardTitle>
      <div className="mt-4 flex-1">
        {loading && <RowSkeletons />}
        {!loading && recent.length === 0 && <EmptyState message={t('records.empty')} />}
        {!loading &&
          recent.map((rec) => (
            <div
              key={rec.id}
              className="border-b border-hairline py-4 pl-3 last:border-b-0 border-l-2 border-l-accent-muted"
            >
              <p className="truncate text-body font-medium text-label">
                {nameOf(rec.resident_id)}
              </p>
              <p className="clamp-2 mt-0.5 text-sub text-label-2">{rec.body_ja}</p>
              <p className="mt-1 flex items-center gap-2 text-caption text-label-3">
                <span className="truncate">{rec.created_by}</span>
                <span className="tabular ml-auto shrink-0">{timeOf(rec.created_at)}</span>
              </p>
            </div>
          ))}
      </div>

      <Link
        to="/records"
        className="mt-4 inline-flex items-center gap-1 self-start rounded-control px-2 py-1 text-sub font-medium text-accent-ink outline-none transition-colors duration-200 ease-standard hover:text-accent-hover focus-visible:ring-3 focus-visible:ring-accent/40"
      >
        {t('home.seeAllRecords')} ›
      </Link>
    </Card>
  );
}

function RowSkeletons() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}
