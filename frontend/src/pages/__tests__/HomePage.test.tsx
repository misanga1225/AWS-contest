// ホーム画面の統合テスト。ApiClient → TanStack Query → 画面まで通す。
// fetch だけを差し替え、集計・並び替えは本物のコードに行わせる。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../../lib/i18n';
import { AppProvider } from '../../lib/appContext';
import type { RuntimeConfig } from '../../lib/config';
import type { CareRecord, HandoverSummary, Resident } from '../../types';
import { HomePage } from '../HomePage';

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: () => Promise.resolve({ tokens: undefined }),
}));

const CONFIG: RuntimeConfig = {
  apiEndpoint: 'https://api.test',
  region: 'ap-northeast-1',
  userPoolId: 'pool',
  userPoolClientId: 'client',
  floors: ['3'],
  shiftHours: { dayStart: '08:00', nightStart: '20:00' },
};

/** 今日の日付で HH:MM の ISO 文字列を作る。 */
function todayAt(hh: number, mm: number): string {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function record(over: Partial<CareRecord>): CareRecord {
  return {
    schema_version: 1,
    id: 'r1',
    floor: '3',
    resident_id: 'res-1',
    category: 'note',
    body_ja: '本文',
    original_text: '本文',
    lang: 'ja',
    status: 'approved',
    created_by: '田中 花子',
    created_at: todayAt(10, 0),
    approved_by: '田中 花子',
    approved_at: todayAt(10, 5),
    ...over,
  };
}

const RESIDENTS: Resident[] = [
  {
    schema_version: 1,
    id: 'res-1',
    floor: '3',
    name: '佐藤 たかし',
    room: '301',
    baseline: '',
    created_at: daysAgo(30),
    status: 'active',
    discharged_at: null,
  },
  {
    schema_version: 1,
    id: 'res-2',
    floor: '3',
    name: '鈴木 はるみ',
    room: '302',
    baseline: '',
    created_at: daysAgo(30),
    status: 'active',
    discharged_at: null,
  },
];

const SUMMARY: HandoverSummary = {
  schema_version: 1,
  floor: '3',
  date: '2026-07-20',
  shift: 'night',
  generated_at: todayAt(20, 0),
  items: [
    // わざと「特記なし」を先頭に置き、画面側で優先度順に並ぶことを確かめる
    { priority: 'none', resident_id: 'res-2', text: 'いつも通り', evidence_record_ids: [] },
    {
      priority: 'attention',
      resident_id: 'res-1',
      text: '発熱・食事量低下・呼吸状態に注意',
      evidence_record_ids: [],
    },
  ],
};

const RECORDS: CareRecord[] = [
  record({ id: 'a', created_at: todayAt(9, 0), body_ja: '朝の記録' }),
  record({ id: 'b', created_at: todayAt(18, 30), body_ja: '夕方の記録' }),
  // 未承認 (下書き) 1件
  record({ id: 'c', status: 'draft', approved_at: null, approved_by: null }),
  // 昨日の承認済み → 「本日の記録」には数えない
  record({ id: 'd', created_at: daysAgo(1) }),
];

/** テストごとに記録セットを差し替えたい場合に設定する (未設定なら RECORDS)。 */
let RECORDS_OVERRIDE: CareRecord[] | null = null;

beforeEach(() => {
  RECORDS_OVERRIDE = null;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL) => {
      const url = String(input);
      const body = url.includes('/residents')
        ? RESIDENTS
        : url.includes('/summaries')
          ? [SUMMARY]
          : url.includes('/records')
            ? (RECORDS_OVERRIDE ?? RECORDS)
            : [];
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
});

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppProvider config={CONFIG}>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </AppProvider>
    </QueryClientProvider>,
  );
}

// 各テストで同じ document に描画するため、明示的に後片付けする
// (vitest globals:false のため testing-library の自動 cleanup が効かない)
afterEach(cleanup);

/** 件数カードの数字を読む。読み込み中はスケルトンなので数字の出現を待つ。 */
async function metricValue(title: string): Promise<string> {
  const card = (await screen.findByText(title)).closest('div');
  if (!card) throw new Error(`card not found for ${title}`);
  const value = await within(card).findByText(/^\d+$/);
  return value.textContent ?? '';
}

describe('HomePage', () => {
  it('本日の承認済み件数を数える (前日の記録は含めない)', async () => {
    renderHome();
    expect(await metricValue('本日の記録（承認済み）')).toBe('2');
  });

  it('未承認の下書き件数を数える', async () => {
    renderHome();
    expect(await metricValue('未承認記録')).toBe('1');
  });

  it('要注意の利用者を優先度順に並べる', async () => {
    renderHome();
    // 氏名は「最近の記録」にも出るため、要注意カード内に限って並び順を見る
    const card = (await screen.findByText('要注意の利用者')).closest('div');
    if (!card) throw new Error('attention card not found');
    await within(card).findByText('佐藤 たかし');
    const names = within(card)
      .getAllByText(/^(佐藤 たかし|鈴木 はるみ)$/)
      .map((el) => el.textContent);
    // attention の佐藤が none の鈴木より前に来る
    expect(names).toEqual(['佐藤 たかし', '鈴木 はるみ']);
  });

  it('最近の記録を新しい順に並べる', async () => {
    renderHome();
    await screen.findByText('夕方の記録');
    const bodies = screen.getAllByText(/^(朝の記録|夕方の記録)$/).map((el) => el.textContent);
    expect(bodies[0]).toBe('夕方の記録');
  });

  it('承認済み記録が無いときはサマリ作成を押せず、理由を示す', async () => {
    // 下書きだけの状態 (= 何も承認していない)
    RECORDS_OVERRIDE = [record({ id: 'c', status: 'draft', approved_at: null, approved_by: null })];
    renderHome();
    const button = await screen.findByRole('button', { name: /申し送りサマリを作成/ });
    await waitFor(() => {
      expect(button).toHaveProperty('disabled', true);
    });
    expect(screen.getByText(/承認済みの記録がまだありません/)).toBeTruthy();
  });

  it('承認済み記録があればサマリ作成を押せる', async () => {
    renderHome();
    const button = await screen.findByRole('button', { name: /申し送りサマリを作成/ });
    await waitFor(() => {
      expect(button).toHaveProperty('disabled', false);
    });
    expect(screen.queryByText(/承認済みの記録がまだありません/)).toBeNull();
  });

  it('フロアと現在のシフトを表示する', async () => {
    renderHome();
    expect(await screen.findByText(/3階フロア/)).toBeTruthy();
  });
});
