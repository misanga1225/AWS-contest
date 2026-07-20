// 優先度・カテゴリのバッジ表示。ラベルは i18n。
// アクセント(臙脂)はここでは使わない。バッジは状態を表すため semantic 色のみ。
// 色だけに情報を担わせない (HIG) ため、要注意にはドットを併記する。

import { useTranslation } from 'react-i18next';
import type { Category, Priority } from '../types';

const BASE = 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption';

const priorityClass: Record<Priority, string> = {
  attention: 'border-danger-muted bg-danger-tint text-danger font-semibold',
  change: 'border-warn-muted bg-warn-tint text-warn font-semibold',
  none: 'border-separator bg-fill text-label-2 font-medium',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const { t } = useTranslation();
  return (
    <span className={`${BASE} ${priorityClass[priority]}`}>
      {priority === 'attention' && (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-danger" />
      )}
      {t(`priority.${priority}`)}
    </span>
  );
}

export function CategoryBadge({ category }: { category: Category }) {
  const { t } = useTranslation();
  return (
    <span className={`${BASE} border-separator bg-sunken font-medium text-label-2`}>
      {t(`categories.${category}`)}
    </span>
  );
}
