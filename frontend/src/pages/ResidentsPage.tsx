// 利用者マスタ画面: 一覧・デモデータ初期化・追加(react-hook-form + zod)・削除。

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/appContext';
import { useCreateResident, useDeleteResident, useResidents, useSeedDemo } from '../lib/queries';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { DeleteResidentOutcome } from '../types';
import {
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorText,
  Input,
  Label,
  SkeletonCard,
  Textarea,
} from '../components/ui';

const schema = z.object({
  name: z.string().min(1),
  room: z.string(),
  baseline: z.string(),
});
type FormValues = z.infer<typeof schema>;

export function ResidentsPage() {
  const { t } = useTranslation();
  const { floor } = useApp();
  const [showDischarged, setShowDischarged] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [result, setResult] = useState<DeleteResidentOutcome | null>(null);
  const residents = useResidents(floor, showDischarged);
  const seed = useSeedDemo();
  const create = useCreateResident();
  const remove = useDeleteResident();

  const { register, handleSubmit, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    // onChange: 入力の途中で isValid が更新され、保存ボタンの活性が入力に追従する
    mode: 'onChange',
    defaultValues: { name: '', room: '', baseline: '' },
  });

  const onCreate = handleSubmit(async (values) => {
    await create.mutateAsync({ floor, ...values });
    reset();
  });

  const isEmpty = residents.data && residents.data.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-4">
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sub text-label-2">
            <input
              type="checkbox"
              checked={showDischarged}
              onChange={(e) => setShowDischarged(e.target.checked)}
              className="size-4 accent-accent"
            />
            {t('residents.showDischarged')}
          </label>
          <Button
            variant="secondary"
            size="sm"
            disabled={seed.isPending}
            onClick={() => void seed.mutateAsync(undefined)}
          >
            {t('residents.seedDemo')}
          </Button>
        </div>
      </div>

      {result && (
        <p className="rounded-control border-l-4 border-accent bg-accent-tint px-4 py-3 text-sub text-label">
          {result === 'discharged' ? t('residents.resultDischarged') : t('residents.resultDeleted')}
        </p>
      )}

      <Card>
        <CardTitle className="mb-6">{t('residents.add')}</CardTitle>
        <form onSubmit={(e) => void onCreate(e)} className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="name">{t('common.name')}</Label>
            <Input id="name" {...register('name')} />
            {formState.errors.name && <ErrorText>{t('common.error')}</ErrorText>}
          </div>
          <div>
            <Label htmlFor="room">{t('common.room')}</Label>
            <Input id="room" {...register('room')} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="baseline">{t('residents.baseline')}</Label>
            <Textarea id="baseline" rows={2} {...register('baseline')} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending || !formState.isValid}>
              {t('common.save')}
            </Button>
            {!formState.isValid && (
              <span className="ml-3 text-sub text-label-2">{t('residents.needName')}</span>
            )}
          </div>
        </form>
      </Card>

      {residents.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {residents.isError && <ErrorText>{t('common.error')}</ErrorText>}
      {isEmpty && <EmptyState message={t('residents.empty')} />}

      <div className="grid gap-3 sm:grid-cols-2">
        {residents.data?.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-body font-semibold text-label">{r.name}</p>
                  {r.status === 'discharged' && (
                    <span className="inline-flex shrink-0 items-center rounded-full border border-hairline bg-sunken px-3 h-6 text-caption font-medium text-label-2">
                      {t('residents.dischargedBadge')}
                    </span>
                  )}
                </div>
                <p className="text-sub text-label-2">
                  {t('common.room')}: {r.room}
                </p>
                {r.discharged_at && (
                  <p className="text-caption tabular-nums text-label-3">
                    {t('residents.dischargedAt')}: {r.discharged_at}
                  </p>
                )}
              </div>
              {r.status === 'active' && (
                <Button variant="ghost" size="sm" onClick={() => setPendingDelete(r.id)}>
                  {t('residents.discharge')}
                </Button>
              )}
            </div>
            {r.baseline && <p className="mt-3 text-sub text-label-2">{r.baseline}</p>}
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('residents.confirmDelete')}
        message={t('residents.confirmDeleteBody')}
        confirmLabel={t('residents.discharge')}
        cancelLabel={t('common.cancel')}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const id = pendingDelete;
          setPendingDelete(null);
          if (id === null) return;
          // 記録の有無でサーバ側が物理削除/退所を決めるため、結果を受けて表示を出し分ける
          void remove
            .mutateAsync({ id, floor })
            .then((res) => setResult(res.outcome))
            .catch(() => setResult(null));
        }}
      />
    </div>
  );
}
