// 一時的な見た目確認用エントリ (dev のみ)。fetch をダミー応答に差し替えて
// 実際の Layout / HomePage を描画する。確認が終わったら preview.html ごと削除する。

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import './lib/i18n';
import { AppProvider } from './lib/appContext';
import { AuthProvider } from './lib/auth';
import { Layout, PlaceholderPage } from './components/Layout';
import { HomePage } from './pages/HomePage';
import { BaselinePage } from './pages/BaselinePage';
import { RecordsPage } from './pages/RecordsPage';
import { ResidentsPage } from './pages/ResidentsPage';
import { SummariesPage } from './pages/SummariesPage';
import type { CareRecord, HandoverSummary, Resident } from './types';

const at = (h: number, m: number): string => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const RESIDENTS: Resident[] = [
  ['res-1', '佐藤 たかし', '301'],
  ['res-2', '鈴木 はるみ', '302'],
  ['res-3', '田中 きよし', '303'],
].map(([id, name, room]) => ({
  schema_version: 1,
  id,
  floor: '3',
  name,
  room,
  baseline: '',
  created_at: at(9, 0),
  status: 'active' as const,
  discharged_at: null,
}));

const rec = (
  id: string,
  resident_id: string,
  body_ja: string,
  h: number,
  m: number,
  by: string,
  status: 'draft' | 'approved' = 'approved',
): CareRecord => ({
  schema_version: 1,
  id,
  floor: '3',
  resident_id,
  category: 'note',
  body_ja,
  original_text: body_ja,
  lang: 'ja',
  status,
  created_by: by,
  created_at: at(h, m),
  approved_by: status === 'approved' ? by : null,
  approved_at: status === 'approved' ? at(h, m) : null,
});

const RECORDS: CareRecord[] = [
  rec('a', 'res-1', '発熱あり、食事量少なめでした。', 18, 30, '田中 花子'),
  rec('b', 'res-2', '入浴後、少し疲れた様子。休憩を増やしました。', 17, 45, '山本 健介'),
  rec('c', 'res-3', '水分をあまり摂れていませんでした。', 17, 20, '佐藤 里子'),
  ...Array.from({ length: 20 }, (_, i) => rec(`x${i}`, 'res-1', '通常のケアを実施。', 10, i, '田中 花子')),
  ...Array.from({ length: 5 }, (_, i) =>
    rec(`d${i}`, 'res-2', '未承認の下書きです。', 19, i, '山本 健介', 'draft'),
  ),
];

const SUMMARY: HandoverSummary = {
  schema_version: 1,
  floor: '3',
  date: new Date().toISOString().slice(0, 10),
  shift: 'night',
  generated_at: at(20, 0),
  items: [
    {
      priority: 'attention',
      resident_id: 'res-1',
      text: '発熱・食事量低下・呼吸状態に注意',
      evidence_record_ids: [],
    },
    {
      priority: 'attention',
      resident_id: 'res-2',
      text: '転倒リスク・夜間の見守り強化',
      evidence_record_ids: [],
    },
    {
      priority: 'change',
      resident_id: 'res-3',
      text: '食事量がやや低下・水分摂取少なめ',
      evidence_record_ids: [],
    },
    { priority: 'none', resident_id: null, text: 'その他 12 名 いつも通り', evidence_record_ids: [] },
  ],
};

window.fetch = ((input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  // 更新系は「送った内容をそのまま返す」ことで画面の反映まで確認できるようにする
  const echo = typeof init?.body === 'string' ? (JSON.parse(init.body) as object) : {};
  const body =
    method !== 'GET'
      ? { ...RESIDENTS[0], ...echo }
      : url.includes('/residents')
        ? RESIDENTS
        : url.includes('/summaries')
          ? [SUMMARY]
          : url.includes('/records')
            ? RECORDS
            : [];
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as typeof fetch;

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <AppProvider
        config={{
          apiEndpoint: 'https://preview.local',
          region: 'ap-northeast-1',
          userPoolId: 'x',
          userPoolClientId: 'x',
          floors: ['1', '2', '3'],
          shiftHours: { dayStart: '08:00', nightStart: '20:00' },
        }}
      >
        <AuthProvider>
          <MemoryRouter initialEntries={['/home']}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/home" element={<HomePage />} />
                <Route path="/records" element={<RecordsPage />} />
                <Route path="/summaries" element={<SummariesPage />} />
                <Route path="/residents" element={<ResidentsPage />} />
                <Route path="/baseline" element={<BaselinePage />} />
                <Route
                  path="/schedule"
                  element={
                    <PlaceholderPage titleKey="nav.schedule" bodyKey="placeholder.schedule" />
                  }
                />
                <Route
                  path="/reports"
                  element={<PlaceholderPage titleKey="nav.reports" bodyKey="placeholder.reports" />}
                />
                <Route
                  path="/settings"
                  element={
                    <PlaceholderPage titleKey="nav.settings" bodyKey="placeholder.settings" />
                  }
                />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </AppProvider>
    </QueryClientProvider>
  </StrictMode>,
);
