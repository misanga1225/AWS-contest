// 左固定サイドバー (幅240px / 白背景 / 右に1pxボーダー / スクロールしない)。
//
// レスポンシブ:
//   wide (1200px) 以上 … 展開。ロゴ + アイコン + ラベル
//   md 〜 wide 未満    … 折りたたみ。アイコンのみ (ラベルは sr-only + aria-label で残す)
//   md 未満            … 非表示。BottomNav に置き換わる
//
// アクティブ表現は淡いグリーン背景 + 左4pxのグリーンライン。

import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppName } from './AppName';
import { NAV_ITEMS } from './nav';
import { WabisukeMark } from './WabisukeMark';

export function Sidebar() {
  const { t } = useTranslation();

  return (
    <aside
      className={[
        // fixed + overflow-hidden で「サイドバーはスクロールしない」を担保する
        'fixed inset-y-0 left-0 z-20 hidden overflow-hidden border-r border-separator bg-surface',
        'md:flex md:w-20 md:flex-col wide:w-60',
      ].join(' ')}
    >
      {/* ロゴ。ヘッダーと同じ 72px の高さに揃える */}
      <div className="flex h-18 shrink-0 items-center gap-2 px-4 wide:px-6">
        <WabisukeMark className="size-8 shrink-0" />
        <AppName className="hidden text-body font-bold leading-tight text-label wide:block" />
      </div>

      <nav aria-label={t('nav.primary')} className="flex flex-col gap-1 px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </nav>
    </aside>
  );
}

function SidebarLink({ item }: { item: (typeof NAV_ITEMS)[number] }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const label = t(`nav.${item.key}`);

  return (
    <NavLink
      to={item.to}
      // 折りたたみ時はラベルが見えないため aria-label と title で意味を補う
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        [
          'relative flex items-center gap-3 rounded-control py-3 text-sub font-medium',
          'transition-colors duration-200 ease-standard',
          'outline-none focus-visible:ring-3 focus-visible:ring-accent/40',
          // 折りたたみ時はアイコンを中央に、展開時は左寄せ
          'justify-center px-2 wide:justify-start wide:px-4',
          // アクティブの左4pxライン
          'before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full',
          'before:transition-colors before:duration-200 before:ease-standard',
          isActive
            ? 'bg-accent-tint text-accent-ink before:bg-accent'
            : 'text-label-2 before:bg-transparent hover:bg-accent-wash hover:text-label',
        ].join(' ')
      }
    >
      <Icon aria-hidden="true" strokeWidth={2} className="size-5 shrink-0" />
      {/* 展開時のみ表示。折りたたみ時も読み上げには残す */}
      <span className="sr-only wide:not-sr-only">{label}</span>
    </NavLink>
  );
}
