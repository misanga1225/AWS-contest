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

  it('シフト帯を UTC からローカル時刻へ変換する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          apiEndpoint: 'https://api.example.com',
          region: 'ap-northeast-1',
          userPoolId: 'pool',
          userPoolClientId: 'client',
          floors: '1',
          shiftDayStart: '00:00',
          shiftNightStart: '09:00',
        }),
      }),
    );
    const config = await loadConfig();
    // 変換量はテスト実行環境のタイムゾーン依存なので、UTC からのオフセットで検証する
    const offsetMin = -new Date().getTimezoneOffset();
    const expect1 = (utcMin: number): string => {
      const m = ((utcMin + offsetMin) % 1440 + 1440) % 1440;
      const pad = (n: number): string => String(n).padStart(2, '0');
      return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    };
    expect(config.shiftHours?.dayStart).toBe(expect1(0));
    expect(config.shiftHours?.nightStart).toBe(expect1(9 * 60));
  });

  it('シフト帯が不正・欠落なら undefined にする', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          apiEndpoint: 'https://api.example.com',
          region: 'ap-northeast-1',
          userPoolId: 'pool',
          userPoolClientId: 'client',
          floors: '1',
          shiftDayStart: '25:00',
          shiftNightStart: '09:00',
        }),
      }),
    );
    const config = await loadConfig();
    expect(config.shiftHours).toBeUndefined();
  });

  it('fetch 失敗時は環境変数フォールバックで既定フロアを返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const config = await loadConfig();
    expect(config.floors).toEqual(['1', '2', '3']);
  });
});
