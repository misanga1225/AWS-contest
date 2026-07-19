// 優先度・カテゴリのバッジ表示。ラベルは i18n。

import { useTranslation } from 'react-i18next';
import type { Category, Priority } from '../types';

const priorityClass: Record<Priority, string> = {
  attention: 'bg-red-100 text-red-800 border-red-200',
  change: 'bg-amber-100 text-amber-800 border-amber-200',
  none: 'bg-slate-100 text-slate-600 border-slate-200',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${priorityClass[priority]}`}
    >
      {t(`priority.${priority}`)}
    </span>
  );
}

export function CategoryBadge({ category }: { category: Category }) {
  const { t } = useTranslation();
  return (
    <span className="inline-block rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
      {t(`categories.${category}`)}
    </span>
  );
}
