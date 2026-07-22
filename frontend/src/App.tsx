// ルーティングとプロバイダ構成。認証状態でログイン画面/アプリを切り替える。

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RuntimeConfig } from './lib/config';
import { AppProvider } from './lib/appContext';
import { AuthProvider, useAuth } from './lib/auth';
import { ApiError } from './lib/api';
import { triggerForceLogout } from './lib/authEvents';
import { Layout, PlaceholderPage } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { BaselinePage } from './pages/BaselinePage';
import { ResidentsPage } from './pages/ResidentsPage';
import { RecordsPage } from './pages/RecordsPage';
import { SummariesPage } from './pages/SummariesPage';

/** セッション切れ(401)を検知したら強制ログアウトする。応答検証エラー(502合成)は対象外。 */
function handleAuthError(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) triggerForceLogout();
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
  queryCache: new QueryCache({ onError: handleAuthError }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
});

function AuthGate() {
  const { status } = useAuth();
  const { t } = useTranslation();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sub text-label-2">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  if (status === 'unauthenticated') {
    return <LoginPage />;
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/summaries" element={<SummariesPage />} />
        <Route path="/residents" element={<ResidentsPage />} />
        <Route path="/baseline" element={<BaselinePage />} />
        {/* 未実装メニュー。ナビは仕様どおり8項目出し、中身は準備中を明示する */}
        <Route
          path="/schedule"
          element={<PlaceholderPage titleKey="nav.schedule" bodyKey="placeholder.schedule" />}
        />
        <Route
          path="/reports"
          element={<PlaceholderPage titleKey="nav.reports" bodyKey="placeholder.reports" />}
        />
        <Route
          path="/settings"
          element={<PlaceholderPage titleKey="nav.settings" bodyKey="placeholder.settings" />}
        />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Route>
    </Routes>
  );
}

export default function App({ config }: { config: RuntimeConfig }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppProvider config={config}>
        <AuthProvider>
          <BrowserRouter>
            <AuthGate />
          </BrowserRouter>
        </AuthProvider>
      </AppProvider>
    </QueryClientProvider>
  );
}
