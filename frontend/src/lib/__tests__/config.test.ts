import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, targetDateForShift } from '../config';

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

describe('targetDateForShift', () => {
  const hours = { dayStart: '09:00', nightStart: '18:00' };

  it('日勤は常に当日の日付を返す', () => {
    const now = new Date(2026, 6, 23, 22, 0);
    expect(targetDateForShift(hours, 'day', now)).toBe('2026-07-23');
  });

  it('夜勤かつ日勤開始前 (前夜からの夜勤中) は前日の日付を返す', () => {
    // 7/23 7:00 = 7/22 夜勤 (18:00開始) がまだ続いている時間帯
    const now = new Date(2026, 6, 23, 7, 0);
    expect(targetDateForShift(hours, 'night', now)).toBe('2026-07-22');
  });

  it('夜勤かつ日勤開始後 (今夜の夜勤はこれから) は当日の日付を返す', () => {
    const now = new Date(2026, 6, 23, 22, 0);
    expect(targetDateForShift(hours, 'night', now)).toBe('2026-07-23');
  });

  it('シフト帯未配信 (hours 無し) なら常に当日の日付を返す', () => {
    const now = new Date(2026, 6, 23, 7, 0);
    expect(targetDateForShift(undefined, 'night', now)).toBe('2026-07-23');
  });

  it('月をまたぐ場合も正しく前日を計算する', () => {
    const now = new Date(2026, 7, 1, 7, 0); // 8/1 7:00 → 7/31 夜勤中
    expect(targetDateForShift(hours, 'night', now)).toBe('2026-07-31');
  });
});
