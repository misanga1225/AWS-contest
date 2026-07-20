// 平常時情報画面の統合テスト。編集 → 保存が PUT /residents/{id} まで届くことを見る。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../../lib/i18n';
import { AppProvider } from '../../lib/appContext';
import type { RuntimeConfig } from '../../lib/config';
import type { Resident } from '../../types';
import { BaselinePage } from '../BaselinePage';

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: () => Promise.resolve({ tokens: undefined }),
}));

const CONFIG: RuntimeConfig = {
  apiEndpoint: 'https://api.test',
  region: 'ap-northeast-1',
  userPoolId: 'pool',
  userPoolClientId: 'client',
  floors: ['3'],
};

const RESIDENT: Resident = {
  schema_version: 1,
  id: 'res-1',
  floor: '3',
  name: '佐藤 たかし',
  room: '301',
  baseline: '食事は自力で全量摂取。',
  created_at: new Date().toISOString(),
  status: 'active',
  discharged_at: null,
};

/** 退所者は編集対象に出さないことの確認用 */
const DISCHARGED: Resident = {
  ...RESIDENT,
  id: 'res-2',
  name: '鈴木 はるみ',
  status: 'discharged',
  discharged_at: new Date().toISOString(),
};

let calls: { method: string; url: string; body: unknown }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        url,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      const body = method === 'PUT' ? RESIDENT : [RESIDENT, DISCHARGED];
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
});

afterEach(cleanup);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppProvider config={CONFIG}>
        <MemoryRouter>
          <BaselinePage />
        </MemoryRouter>
      </AppProvider>
    </QueryClientProvider>,
  );
}

describe('BaselinePage', () => {
  it('在籍中の利用者だけを表示する', async () => {
    renderPage();
    expect(await screen.findByText('佐藤 たかし')).toBeTruthy();
    expect(screen.queryByText('鈴木 はるみ')).toBeNull();
  });

  it('平常時情報を編集して保存すると、氏名・居室を保ったまま PUT する', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /佐藤 たかし/ }));

    const textarea = await screen.findByLabelText('平常時情報');
    fireEvent.change(textarea, { target: { value: '夜間の見守りを強化。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'PUT')).toBe(true);
    });
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toContain('/residents/res-1');
    // baseline だけが変わり、氏名・居室・フロアは元の値を保つ
    expect(put?.body).toEqual({
      floor: '3',
      name: '佐藤 たかし',
      room: '301',
      baseline: '夜間の見守りを強化。',
    });
  });

  it('キャンセルすると編集内容を破棄し、PUT しない', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /佐藤 たかし/ }));

    fireEvent.change(await screen.findByLabelText('平常時情報'), {
      target: { value: '書きかけ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    // 元の値が表示に戻っている
    expect(await screen.findByText('食事は自力で全量摂取。')).toBeTruthy();
  });
});
