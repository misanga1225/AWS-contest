// 優先度・カテゴリのバッジ表示。ラベルは i18n。
// アクセント(ブランドグリーン)はここでは使わない。バッジは状態を表すため semantic 色のみ。
// 色だけに情報を担わせない (a11y) ため、要注意にはドットを併記する。
//
// 仕様: 高さ24px / 角丸999px / 左右padding12px / 文字12px。
// 文字色は -ink（濃色）を使う。ブランド値のままでは tint 背景で 4.5:1 に届かないため。

import { useTranslation } from 'react-i18next';
import type { Category, Priority } from '../types';

const BASE =
  'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-3 text-caption font-medium';

const priorityClass: Record<Priority, string> = {
  attention: 'border-danger-muted bg-danger-tint text-danger-ink',
  change: 'border-warn-muted bg-warn-tint text-warn-ink',
  none: 'border-success-muted bg-success-tint text-success-ink',
};

const dotClass: Record<Priority, string> = {
  attention: 'bg-danger',
  change: 'bg-warn',
  none: 'bg-success',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const { t } = useTranslation();
  return (
    <span className={`${BASE} ${priorityClass[priority]}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${dotClass[priority]}`} />
      {t(`priority.${priority}`)}
    </span>
  );
}

export function CategoryBadge({ category }: { category: Category }) {
  const { t } = useTranslation();
  return (
    <span className={`${BASE} border-hairline bg-sunken text-label-2`}>
      {t(`categories.${category}`)}
    </span>
  );
}
