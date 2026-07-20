// 平常時情報: 利用者ごとの「いつもの様子」を確認・更新する画面。
//
// 平常時情報は利用者登録時にも入力できるが、体調や生活リズムは変わるため
// 後から更新できる必要がある (登録時のみでは古い情報が残り続ける)。
// 既存の PUT /residents/{id} を使い、氏名・居室は変えずに baseline だけを差し替える。

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PencilLine } from 'lucide-react';
import { useApp } from '../lib/appContext';
import { useResidents, useUpdateResident } from '../lib/queries';
import type { Resident } from '../types';
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorText,
  Label,
  SkeletonCard,
  Spinner,
  Textarea,
} from '../components/ui';

export function BaselinePage() {
  const { t } = useTranslation();
  const { floor } = useApp();
  const residents = useResidents(floor);

  // 在籍者のみ。退所者の平常時情報は更新対象にしない
  const active = (residents.data ?? []).filter((r) => r.status === 'active');

  return (
    <div className="space-y-6">
      <p className="rounded-control border-l-4 border-info bg-info-tint px-4 py-3 text-sub text-label-2">
        {t('baselinePage.note')}
      </p>

      {residents.isLoading && (
        <div className="grid gap-6 wide:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {residents.isError && <ErrorText>{t('common.error')}</ErrorText>}
      {!residents.isLoading && active.length === 0 && (
        <EmptyState message={t('baselinePage.empty')} />
      )}

      <div className="grid gap-6 wide:grid-cols-2">
        {active.map((r) => (
          <BaselineCard key={r.id} resident={r} floor={floor} />
        ))}
      </div>
    </div>
  );
}

function BaselineCard({ resident, floor }: { resident: Resident; floor: string }) {
  const { t } = useTranslation();
  const update = useUpdateResident();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(resident.baseline);

  const onSave = async () => {
    await update.mutateAsync({
      id: resident.id,
      // 氏名・居室は現状の値をそのまま送り、平常時情報だけを差し替える
      input: { floor, name: resident.name, room: resident.room, baseline: text },
    });
    setEditing(false);
  };

  const onCancel = () => {
    setText(resident.baseline);
    setEditing(false);
  };

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="truncate">{resident.name}</CardTitle>
          <p className="text-sub text-label-2">
            {t('common.room')}: {resident.room}
          </p>
        </div>
        {!editing && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEditing(true)}
            aria-label={`${resident.name} ${t('baselinePage.editLabel')}`}
          >
            <PencilLine aria-hidden="true" />
            {t('common.edit')}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="mt-4">
          <Label htmlFor={`baseline-${resident.id}`}>{t('residents.baseline')}</Label>
          <Textarea
            id={`baseline-${resident.id}`}
            value={text}
            placeholder={t('baselinePage.placeholder')}
            onChange={(e) => setText(e.target.value)}
          />
          {update.isError && <ErrorText>{t('common.error')}</ErrorText>}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button disabled={update.isPending} onClick={() => void onSave()}>
              {update.isPending ? <Spinner label={t('common.save')} /> : t('common.save')}
            </Button>
            <Button variant="secondary" disabled={update.isPending} onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-4 whitespace-pre-wrap text-body text-label">
          {resident.baseline || (
            <span className="text-label-3">{t('baselinePage.unset')}</span>
          )}
        </p>
      )}
    </Card>
  );
}
