import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import '../../lib/i18n';
import { CategoryBadge, PriorityBadge } from '../badges';

describe('badges', () => {
  it('カテゴリを日本語ラベルで表示する', () => {
    const { container } = render(<CategoryBadge category="incident" />);
    expect(container.textContent).toContain('インシデント');
  });

  it('優先度を日本語ラベルで表示する', () => {
    const { container } = render(<PriorityBadge priority="attention" />);
    expect(container.textContent).toContain('要注意');
  });
});
