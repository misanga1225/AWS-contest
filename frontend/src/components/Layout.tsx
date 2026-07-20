// 認証後の共通レイアウト: 左サイドバー + メインコンテンツの2カラム構成。
// ページタイトルはルートから解決してヘッダーに出す (各ページは h1 を持たない)。

import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, LogOut, UserRound } from 'lucide-react';
import { useApp } from '../lib/appContext';
import { useAuth } from '../lib/auth';
import { useRecords } from '../lib/queries';
import type { Lang } from '../types';
import { NAV_ITEMS } from './nav';
import { BottomNav } from './BottomNav';
import { Segmented } from './Segmented';
import { Sidebar } from './Sidebar';
import { Button, Select } from './ui';

const LANGS: readonly Lang[] = ['ja', 'en', 'vi'];
const LANG_OPTIONS = LANGS.map((l) => ({ value: l, label: l.toUpperCase() }));

export function Layout() {
  const { t, i18n } = useTranslation();
  const { config, floor, setFloor } = useApp();
  const { username, logout } = useAuth();
  const { pathname } = useLocation();

  const current = NAV_ITEMS.find((i) => pathname.startsWith(i.to));
  const pageTitle = current ? t(`nav.${current.key}`) : t('nav.home');

  const currentLang = (LANGS.find((l) => i18n.language.startsWith(l)) ?? 'ja') as Lang;

  return (
    <div className="min-h-screen">
      <Sidebar />
      <BottomNav />

      {/* サイドバー幅の分だけ本文を寄せる。下部ナビに隠れないよう pb を確保する */}
      <div className="md:pl-20 wide:pl-60">
        <div className="mx-auto max-w-[1600px] px-4 pb-24 md:px-8 md:pb-10 wide:px-12">
          <header className="flex h-18 items-center gap-4">
            <h1 className="truncate text-title font-bold text-label md:text-display">{pageTitle}</h1>

            <div className="ml-auto flex items-center gap-3">
              <label className="hidden items-center gap-2 text-sub text-label-2 md:flex">
                <span className="sr-only wide:not-sr-only">{t('common.floor')}</span>
                <Select
                  value={floor}
                  onChange={(e) => setFloor(e.target.value)}
                  aria-label={t('common.floor')}
                  className="h-10 w-auto px-3 text-sub"
                >
                  {config.floors.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </label>

              <div className="hidden wide:block">
                <Segmented
                  options={LANG_OPTIONS}
                  value={currentLang}
                  onChange={(l) => void i18n.changeLanguage(l)}
                  ariaLabel="language"
                />
              </div>

              <NotificationBell />

              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="flex size-8 items-center justify-center rounded-full bg-accent-tint text-accent-ink"
                >
                  <UserRound strokeWidth={2} className="size-5" />
                </span>
                {username && (
                  <span className="hidden text-sub font-medium text-label md:inline">
                    {username}
                  </span>
                )}
              </span>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => void logout()}
                aria-label={t('auth.signOut')}
              >
                <LogOut aria-hidden="true" />
                <span className="hidden wide:inline">{t('auth.signOut')}</span>
              </Button>
            </div>
          </header>

          {/* モバイルはヘッダーに入りきらないフロア切替をここに出す */}
          <label className="mb-4 flex items-center gap-2 text-sub text-label-2 md:hidden">
            {t('common.floor')}
            <Select
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              aria-label={t('common.floor')}
              className="h-10 w-auto px-3 text-sub"
            >
              {config.floors.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </label>

          <main>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

/**
 * 通知ベル。未承認の下書き件数を出し、押すとケアメモ画面へ移動する。
 * 「承認待ちが溜まっていること」は見落とすと申し送りが欠けるため、常時視界に置く。
 * (通知基盤は無いので、既存の記録データだけで成立する範囲に留めている)
 */
function NotificationBell() {
  const { t } = useTranslation();
  const { floor } = useApp();
  const navigate = useNavigate();
  const drafts = useRecords({ floor, status: 'draft' });
  const count = drafts.data?.length ?? 0;

  return (
    <button
      type="button"
      onClick={() => void navigate('/records')}
      // 件数を読み上げに含める。ドットだけでは何件か分からないため
      aria-label={
        count > 0
          ? `${t('common.notifications')}: ${t('home.unapproved')} ${count}`
          : t('common.notifications')
      }
      className="relative flex size-10 items-center justify-center rounded-control text-label-2 outline-none transition-colors duration-200 ease-standard hover:bg-fill hover:text-label focus-visible:ring-3 focus-visible:ring-accent/40"
    >
      <Bell aria-hidden="true" strokeWidth={2} className="size-5" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="tabular absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

/** 未実装メニュー用の「準備中」ページ。行き止まりにせず実装済み画面へ導線を残す。 */
export function PlaceholderPage({ titleKey, bodyKey }: { titleKey: string; bodyKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-card border border-dashed border-separator bg-surface/60 px-6 py-16 text-center">
      <p className="text-section text-label">{t(titleKey)}</p>
      <p className="mx-auto mt-2 max-w-md text-sub text-label-2">{t(bodyKey)}</p>
      <NavLink
        to="/home"
        className="mt-6 inline-flex items-center gap-1 rounded-control px-2 py-1 text-sub font-medium text-accent-ink outline-none transition-colors duration-200 ease-standard hover:text-accent-hover focus-visible:ring-3 focus-visible:ring-accent/40"
      >
        {t('common.backToHome')} ›
      </NavLink>
    </div>
  );
}
