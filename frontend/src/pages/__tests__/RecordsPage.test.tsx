// ケア記録画面の統合テスト。
// - DraftCard: 母語(非ja)記録に逆翻訳の確認用テキストを併記し、ja には出さない。
// - ComposeCard: 音声入力 → S3 直アップロード → 文字起こし結果が本文へ入る縦割り。
// fetch と MediaRecorder/getUserMedia だけを差し替え、画面〜API は本物を通す。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '../../lib/i18n';
import { AppProvider } from '../../lib/appContext';
import type { RuntimeConfig } from '../../lib/config';
import type { CareRecord, Resident } from '../../types';
import { RecordsPage } from '../RecordsPage';

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
  schema_version: 2,
  id: 'res-1',
  floor: '3',
  name: '佐藤 たかし',
  room: '301',
  baseline: '',
  created_at: new Date().toISOString(),
  status: 'active',
  discharged_at: null,
};

function record(over: Partial<CareRecord>): CareRecord {
  return {
    schema_version: 2,
    id: 'r1',
    floor: '3',
    resident_id: 'res-1',
    category: 'note',
    body_ja: '昼食を全量摂取した。',
    original_text: 'Ăn hết bữa trưa',
    lang: 'vi',
    verification_text: 'Đã ăn hết bữa trưa',
    status: 'draft',
    created_by: 'staff',
    created_at: new Date().toISOString(),
    approved_by: null,
    approved_at: null,
    ...over,
  };
}

/** テストごとに差し替える下書きセット。 */
let DRAFTS: CareRecord[] = [];

beforeEach(() => {
  DRAFTS = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const ok = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );

      // S3 プリサインド URL への直 PUT
      if (url.startsWith('https://fake-s3.test/')) return Promise.resolve(new Response(null, { status: 200 }));
      if (url.includes('/uploads/audio-url'))
        return ok({ url: 'https://fake-s3.test/audio/x.webm', key: 'audio/x.webm' });
      if (url.includes('/transcribe/')) return ok({ status: 'completed', text: '水分をよく摂れている' });
      if (url.includes('/transcribe')) return ok({ job_name: 'wabisuke-JOB1' });
      if (url.includes('/residents')) return ok([RESIDENT]);
      if (url.includes('/records') && method === 'GET') return ok(DRAFTS);
      return ok({});
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
          <RecordsPage />
        </MemoryRouter>
      </AppProvider>
    </QueryClientProvider>,
  );
}

describe('RecordsPage DraftCard 逆翻訳', () => {
  it('母語(vi)の下書きに逆翻訳の確認用テキストを併記する', async () => {
    DRAFTS = [record({})];
    renderPage();
    // 原文が母語で読める
    expect(await screen.findByText(/Ăn hết bữa trưa/)).toBeTruthy();
    // body_ja の逆翻訳が確認用として出る
    expect(screen.getByText(/Đã ăn hết bữa trưa/)).toBeTruthy();
    expect(screen.getByText(/確認用/)).toBeTruthy();
  });

  it('日本語(ja)の下書きには逆翻訳を出さない', async () => {
    DRAFTS = [record({ id: 'r2', lang: 'ja', verification_text: null, original_text: '昼食を全量摂取した。' })];
    renderPage();
    await screen.findByText(/下書きを確認・修正/);
    expect(screen.queryByText(/確認用/)).toBeNull();
  });
});

describe('RecordsPage 音声入力', () => {
  // jsdom には MediaRecorder / getUserMedia が無いので最小のフェイクを注入する。
  class FakeMediaRecorder {
    static isTypeSupported() {
      return true;
    }
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    mimeType = 'audio/webm';
    start() {}
    stop() {
      this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) });
      this.onstop?.();
    }
  }

  beforeEach(() => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      mediaDevices: {
        getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop() {} }] }),
      },
    });
  });

  it('録音→停止で文字起こし結果が本文に入る', async () => {
    DRAFTS = [];
    renderPage();

    // 録音開始
    fireEvent.click(await screen.findByRole('button', { name: /音声で入力/ }));
    // 録音中は停止ボタンが出る
    const stopBtn = await screen.findByRole('button', { name: /停止/ });
    fireEvent.click(stopBtn);

    // ポーリング完了で文字起こしテキストが Textarea に入る
    const memo = (await screen.findByLabelText('ケアメモ')) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(memo.value).toContain('水分をよく摂れている');
    });
  });
});
