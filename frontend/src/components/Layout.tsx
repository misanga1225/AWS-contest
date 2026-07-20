// 認証後の共通レイアウト: ナビ・フロア選択・言語切替・ログアウト。
// 装飾はこのナビゲーション層に集中させ、コンテンツ層(カード・リスト)は素朴に保つ (HIG)。

import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/appContext';
import { useAuth } from '../lib/auth';
import type { Lang } from '../types';
import { AppName } from './AppName';
import { Segmented } from './Segmented';
import { Button, Select } from './ui';

const LANGS: readonly Lang[] = ['ja', 'en', 'vi'];
const LANG_OPTIONS = LANGS.map((l) => ({ value: l, label: l.toUpperCase() }));

export function Layout() {
  const { t, i18n } = useTranslation();
  const { config, floor, setFloor } = useApp();
  const { username, logout } = useAuth();

  // アクティブ表現は塗りつぶしタブではなく、下線インジケータ + accent 文字色。
  const navClass = ({ isActive }: { isActive: boolean }): string =>
    [
      'relative rounded-control px-3 py-2 text-[14px] font-medium outline-none',
      'transition-[color,background-color,box-shadow] duration-150 ease-spring',
      'focus-visible:ring-3 focus-visible:ring-accent/30',
      'after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full',
      'after:transition-[background-color] after:duration-150 after:ease-spring',
      isActive
        ? 'text-accent after:bg-accent'
        : 'text-label-2 hover:text-label hover:bg-fill after:bg-transparent',
    ].join(' ');

  const currentLang = (LANGS.find((l) => i18n.language.startsWith(l)) ?? 'ja') as Lang;

  return (
    <div className="min-h-screen">
      {/*
        半透明 + ブラーはここだけに使う。スクロール時にコンテンツが透けることで
        「下に続きがある」ことを示す機能的な意味を持たせる (honest materiality)。
      */}
      <header className="sticky top-0 z-10 border-b border-separator bg-surface/72 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
          <AppName className="text-[15px] font-semibold tracking-tight text-label" />

          <nav className="flex gap-0.5">
            <NavLink to="/residents" className={navClass}>
              {t('nav.residents')}
            </NavLink>
            <NavLink to="/records" className={navClass}>
              {t('nav.records')}
            </NavLink>
            <NavLink to="/summaries" className={navClass}>
              {t('nav.summaries')}
            </NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sub text-label-2">
              {t('common.floor')}
              <Select
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                aria-label={t('common.floor')}
                className="h-8 w-auto py-1 text-sub"
              >
                {config.floors.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </label>

            <Segmented
              options={LANG_OPTIONS}
              value={currentLang}
              onChange={(l) => void i18n.changeLanguage(l)}
              ariaLabel="language"
            />

            <span className="h-4 w-px bg-separator" aria-hidden="true" />

            {username && <span className="text-sub text-label-2">{username}</span>}
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              {t('auth.signOut')}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-6">
        <Outlet />
      </main>
    </div>
  );
}
