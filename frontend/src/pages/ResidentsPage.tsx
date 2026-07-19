// 利用者マスタ画面: 一覧・デモデータ初期化・追加(react-hook-form + zod)・削除。

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/appContext';
import {
  useCreateResident,
  useDeleteResident,
  useResidents,
  useSeedDemo,
} from '../lib/queries';
import { Button, Card, ErrorText, Input, Label, Textarea } from '../components/ui';

const schema = z.object({
  name: z.string().min(1),
  room: z.string(),
  baseline: z.string(),
});
type FormValues = z.infer<typeof schema>;

export function ResidentsPage() {
  const { t } = useTranslation();
  const { floor } = useApp();
  const residents = useResidents(floor);
  const seed = useSeedDemo();
  const create = useCreateResident();
  const remove = useDeleteResident();

  const { register, handleSubmit, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', room: '', baseline: '' },
  });

  const onCreate = handleSubmit(async (values) => {
    await create.mutateAsync({ floor, ...values });
    reset();
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">{t('residents.title')}</h1>
        <Button
          variant="secondary"
          disabled={seed.isPending}
          onClick={() => void seed.mutateAsync(undefined)}
        >
          {t('residents.seedDemo')}
        </Button>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-700">{t('residents.add')}</h2>
        <form onSubmit={(e) => void onCreate(e)} className="grid gap-3 sm:grid-cols-2">
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
          <div>
            <Button type="submit" disabled={create.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Card>

      {residents.isLoading && <p className="text-slate-500">{t('common.loading')}</p>}
      {residents.isError && <ErrorText>{t('common.error')}</ErrorText>}
      {residents.data && residents.data.length === 0 && (
        <p className="text-slate-500">{t('residents.empty')}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {residents.data?.map((r) => (
          <Card key={r.id}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-slate-800">{r.name}</p>
                <p className="text-sm text-slate-500">
                  {t('common.room')}: {r.room}
                </p>
              </div>
              <Button
                variant="danger"
                onClick={() => {
                  if (window.confirm(t('residents.confirmDelete'))) {
                    void remove.mutateAsync({ id: r.id, floor });
                  }
                }}
              >
                {t('common.delete')}
              </Button>
            </div>
            {r.baseline && <p className="mt-2 text-sm text-slate-600">{r.baseline}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}
