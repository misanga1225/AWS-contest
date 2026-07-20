// ナビゲーション定義。サイドバー(デスクトップ)と下部ナビ(モバイル)で共有する。
// アイコンは Lucide (アウトライン・線幅2px) で統一する。
// アイコンだけで意味を持たせず、必ずテキストラベルを併記する (a11y)。

import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  HeartPulse,
  Home,
  Settings,
  SquarePen,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  /** ルーティング先 */
  to: string;
  /** i18n キー (nav.*) */
  key: string;
  icon: LucideIcon;
  /** モバイル下部ナビに出す主要項目か */
  primary?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/home', key: 'home', icon: Home, primary: true },
  { to: '/records', key: 'records', icon: SquarePen, primary: true },
  { to: '/summaries', key: 'summaries', icon: ClipboardList, primary: true },
  { to: '/residents', key: 'residents', icon: Users, primary: true },
  { to: '/baseline', key: 'baseline', icon: HeartPulse },
  { to: '/schedule', key: 'schedule', icon: CalendarDays },
  { to: '/reports', key: 'reports', icon: BarChart3 },
  { to: '/settings', key: 'settings', icon: Settings },
];

export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((i) => i.primary);
export const SECONDARY_NAV_ITEMS = NAV_ITEMS.filter((i) => !i.primary);
