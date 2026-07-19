import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadConfig', () => {
  it('config.json のカンマ区切り floors を配列へ変換する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          apiEndpoint: 'https://api.example.com',
          region: 'ap-northeast-1',
          userPoolId: 'pool',
          userPoolClientId: 'client',
          floors: '1, 2 ,3',
        }),
      }),
    );
    const config = await loadConfig();
    expect(config.apiEndpoint).toBe('https://api.example.com');
    expect(config.floors).toEqual(['1', '2', '3']);
  });

  it('fetch 失敗時は環境変数フォールバックで既定フロアを返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const config = await loadConfig();
    expect(config.floors).toEqual(['1', '2', '3']);
  });
});
