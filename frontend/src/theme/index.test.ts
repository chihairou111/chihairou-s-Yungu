import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/colors';
import theme from './index';

describe('the theme (the one Rounded, Material 3 style)', () => {
  it('uses the Material 3 shape scale (cards = medium 12px)', () => {
    expect(theme.shape.borderRadius).toBe(12);
    expect(theme.yungu.shape).toEqual({ extraSmall: 4, small: 8, medium: 12, large: 16, extraLarge: 28, full: 9999 });
  });

  it('keeps the blue primary and derives M3 tonal surfaces from it', () => {
    const { palette, yungu } = theme;
    expect(palette.primary.main).toBe('#1565c0');
    expect(palette.background.default).toBe(yungu.color.surface);
    expect(palette.background.paper).toBe(yungu.color.surfaceContainerLow);
  });

  it('text meets WCAG AA on every surface it sits on', () => {
    const { palette, yungu } = theme;
    const c = yungu.color;
    // Page, cards, sheets and menus; the high/highest containers carry no coloured text.
    const surfaces = [c.surface, c.surfaceContainerLowest, c.surfaceContainerLow, c.surfaceContainer];
    for (const s of surfaces) {
      expect(contrastRatio(palette.text.primary, s)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.text.secondary, s)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.primary.main, s)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.error.main, s)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.warning.dark, s)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(c.onSecondaryContainer, c.secondaryContainer)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.onPrimaryContainer, c.primaryContainer)).toBeGreaterThanOrEqual(4.5);
  });

  it('card and list titles are 600, since the CJK fallback has no 500', () => {
    const { typography } = theme;
    expect(Number(typography.h3.fontWeight)).toBeGreaterThanOrEqual(600);
  });

  it('lists CJK families with real weights after Geist', () => {
    const family = theme.typography.fontFamily as string;
    expect(family).toMatch(/var\(--font-geist-sans\).*"PingFang SC".*"Noto Sans SC".*"Microsoft YaHei"/);
  });
});
