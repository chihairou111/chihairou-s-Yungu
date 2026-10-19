import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/colors';
import { getTheme } from './index';

describe('getTheme', () => {
  it('classic keeps the MD2 4px corners everywhere', () => {
    const t = getTheme('classic');
    expect(t.yungu.style).toBe('classic');
    expect(t.shape.borderRadius).toBe(4);
    expect(t.yungu.shape).toEqual({ extraSmall: 4, small: 4, medium: 4, large: 4, extraLarge: 4, full: 4 });
  });

  it('classic keeps today\'s palette', () => {
    const { palette } = getTheme('classic');
    expect(palette.primary.main).toBe('#1565c0');
    expect(palette.background).toMatchObject({ default: '#f5f7fa', paper: '#ffffff' });
    expect(palette.text).toMatchObject({ primary: '#1b2330', secondary: '#5f6b7a' });
    expect(palette.divider).toBe('#e3e8ef');
  });

  it('expressive uses the Material 3 shape scale (cards = medium 12px)', () => {
    const t = getTheme('expressive');
    expect(t.yungu.style).toBe('expressive');
    expect(t.shape.borderRadius).toBe(12);
    expect(t.yungu.shape).toEqual({ extraSmall: 4, small: 8, medium: 12, large: 16, extraLarge: 28, full: 9999 });
  });

  it('expressive keeps the blue primary and derives M3 tonal surfaces from it', () => {
    const { palette, yungu } = getTheme('expressive');
    expect(palette.primary.main).toBe('#1565c0');
    expect(palette.background.default).toBe(yungu.color.surface);
    expect(palette.background.paper).toBe(yungu.color.surfaceContainerLow);
  });

  it('expressive text meets WCAG AA on every surface it sits on', () => {
    const { palette, yungu } = getTheme('expressive');
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

  it('expressive card and list titles are 600, since the CJK fallback has no 500', () => {
    const { typography } = getTheme('expressive');
    expect(Number(typography.h3.fontWeight)).toBeGreaterThanOrEqual(600);
  });

  it('both styles list CJK families with real weights after Geist', () => {
    for (const style of ['classic', 'expressive'] as const) {
      const family = getTheme(style).typography.fontFamily as string;
      expect(family).toMatch(/var\(--font-geist-sans\).*"PingFang SC".*"Noto Sans SC".*"Microsoft YaHei"/);
    }
  });
});
