// 認証後の共通レイアウト: ナビ・フロア選択・言語切替・ログアウト。

import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/appContext';
import { useAuth } from '../lib/auth';
import type { Lang } from '../types';
import { Button, Select } from './ui';

const LANGS: readonly Lang[] = ['ja', 'en', 'vi'];

export function Layout() {
  const { t, i18n } = useTranslation();
  const { config, floor, setFloor } = useApp();
  const { username, logout } = useAuth();

  const navClass = ({ isActive }: { isActive: boolean }): string =>
    `rounded-md px-3 py-2 text-sm font-medium ${
      isActive ? 'bg-sky-600 text-white' : 'text-slate-700 hover:bg-slate-100'
    }`;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-lg font-bold text-sky-700">{t('appName')}</span>
          <nav className="flex gap-1">
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
          <div className="ml-auto flex items-center gap-2">
            <label className="text-sm text-slate-600">{t('common.floor')}</label>
            <Select value={floor} onChange={(e) => setFloor(e.target.value)} aria-label="floor">
              {config.floors.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
            <Select
              value={i18n.language}
              onChange={(e) => void i18n.changeLanguage(e.target.value)}
              aria-label="language"
            >
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </Select>
            {username && <span className="text-sm text-slate-500">{username}</span>}
            <Button variant="ghost" onClick={() => void logout()}>
              {t('auth.signOut')}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
