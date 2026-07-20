// モバイル (md未満) の下部ナビゲーション。サイドバーの置き換え。
// 主要4項目 + 「メニュー」。メニューは残りの項目をシートで開く。

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Menu, X } from 'lucide-react';
import { PRIMARY_NAV_ITEMS, SECONDARY_NAV_ITEMS } from './nav';

const ITEM = [
  'flex flex-1 flex-col items-center justify-center gap-1 rounded-control py-2 text-caption font-medium',
  'transition-colors duration-200 ease-standard',
  'outline-none focus-visible:ring-3 focus-visible:ring-accent/40',
].join(' ');

export function BottomNav() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && (
        <>
          {/* 背景タップで閉じる。ボタンにしてキーボードでも閉じられるようにする */}
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 bg-label/25 md:hidden"
          />
          <div
            className="fixed inset-x-0 bottom-16 z-40 mx-4 rounded-sheet border border-hairline bg-surface p-2 shadow-lg md:hidden"
            role="dialog"
            aria-label={t('nav.more')}
          >
            {SECONDARY_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-3 rounded-control px-4 py-3 text-body font-medium',
                      'transition-colors duration-200 ease-standard',
                      'outline-none focus-visible:ring-3 focus-visible:ring-accent/40',
                      isActive
                        ? 'bg-accent-tint text-accent-ink'
                        : 'text-label-2 hover:bg-accent-wash hover:text-label',
                    ].join(' ')
                  }
                >
                  <Icon aria-hidden="true" strokeWidth={2} className="size-5 shrink-0" />
                  {t(`nav.${item.key}`)}
                </NavLink>
              );
            })}
          </div>
        </>
      )}

      <nav
        aria-label={t('nav.primary')}
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 border-t border-separator bg-surface px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {PRIMARY_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                [ITEM, isActive ? 'text-accent-ink' : 'text-label-2'].join(' ')
              }
            >
              <Icon aria-hidden="true" strokeWidth={2} className="size-5" />
              {t(`nav.${item.key}Short`)}
            </NavLink>
          );
        })}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={[ITEM, open ? 'text-accent-ink' : 'text-label-2'].join(' ')}
        >
          {open ? (
            <X aria-hidden="true" strokeWidth={2} className="size-5" />
          ) : (
            <Menu aria-hidden="true" strokeWidth={2} className="size-5" />
          )}
          {t('nav.more')}
        </button>
      </nav>
    </>
  );
}
