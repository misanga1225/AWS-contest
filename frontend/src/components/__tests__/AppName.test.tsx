import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import i18n from '../../lib/i18n';
import { AppName } from '../AppName';

afterEach(async () => {
  await i18n.changeLanguage('ja');
});

describe('AppName', () => {
  it('日本語UIでは AI に「ラブ」のルビを振る', () => {
    const { container } = render(<AppName />);
    const rt = container.querySelector('rt');
    expect(rt?.textContent).toBe('ラブ');
    expect(container.querySelector('ruby')?.textContent).toContain('AI');
    expect(container.textContent).toContain('ヘルパー わびすけ');
  });

  it('日本語UIでも読み上げにはプレーンな名称を渡す', () => {
    const { container } = render(<AppName />);
    expect(container.firstElementChild?.getAttribute('aria-label')).toBe('AIヘルパー わびすけ');
  });

  it('英語UIではルビを振らない', async () => {
    await i18n.changeLanguage('en');
    const { container } = render(<AppName />);
    expect(container.querySelector('ruby')).toBeNull();
    expect(container.textContent).toBe('AI Helper Wabisuke');
  });
});
