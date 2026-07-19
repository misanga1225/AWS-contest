// ルーティングとプロバイダ構成。認証状態でログイン画面/アプリを切り替える。

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RuntimeConfig } from './lib/config';
import { AppProvider } from './lib/appContext';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { ResidentsPage } from './pages/ResidentsPage';
import { RecordsPage } from './pages/RecordsPage';
import { SummariesPage } from './pages/SummariesPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

function AuthGate() {
  const { status } = useAuth();
  const { t } = useTranslation();

  if (status === 'loading') {
    return <p className="p-6 text-slate-500">{t('common.loading')}</p>;
  }
  if (status === 'unauthenticated') {
    return <LoginPage />;
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/residents" element={<ResidentsPage />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/summaries" element={<SummariesPage />} />
        <Route path="*" element={<Navigate to="/residents" replace />} />
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
