import { describe, expect, it } from 'vitest';
import type { CssVarsTheme } from '@mui/material/styles';
import { contrastRatio } from '@/lib/colors';
import theme from './index';
import { darkPalette, lightRoles } from './expressive';

describe('the theme (the one Rounded, Material 3 style)', () => {
  it('uses the Material 3 shape scale (cards = medium 12px)', () => {
    expect(theme.shape.borderRadius).toBe(12);
    expect(theme.yungu.shape).toEqual({ extraSmall: 4, small: 8, medium: 12, large: 16, extraLarge: 28, full: 9999 });
  });

  it('keeps the blue primary and derives M3 tonal surfaces from it', () => {
    const { palette, yungu } = theme;
    expect(palette.primary.main).toBe('#1565c0');
    expect(palette.background.default).toBe(lightRoles.surface);
    expect(palette.background.paper).toBe(lightRoles.surfaceContainerLow);
    expect(yungu.color.surface).toBe('var(--yungu-surface)');
  });

  it('has a dark scheme keyed to data-appearance on <html>, read through CSS variables', () => {
    const vars = theme as unknown as CssVarsTheme;
    expect(vars.colorSchemes.dark).toBeDefined();
    expect(vars.colorSchemes.dark?.palette.mode).toBe('dark');
    expect(vars.colorSchemeSelector).toBe('data-appearance');
    expect(theme.yungu.color.surface).toMatch(/^var\(--[\w-]+\)$/);
    expect(theme.yungu.rail.bg).toMatch(/^var\(--[\w-]+\)$/);
    expect(theme.yungu.header.bg).toMatch(/^var\(--[\w-]+\)$/);
    expect(theme.yungu.dialog.bg).toBe('var(--yungu-dialog)');
    expect(theme.yungu.menu.bg).toBe('var(--yungu-menu)');
  });

  it('keeps the light scheme exactly as it was', () => {
    expect(lightRoles).toEqual({
      surface: '#f9f9ff',
      surfaceContainerLowest: '#ffffff',
      surfaceContainerLow: '#f3f3fa',
      surfaceContainer: '#ededf4',
      surfaceContainerHigh: '#e7e8ee',
      surfaceContainerHighest: '#e2e2e9',
      onSurface: '#191c20',
      onSurfaceVariant: '#44474e',
      outline: '#74777f',
      outlineVariant: '#c4c6d0',
      primaryContainer: '#d6e3ff',
      onPrimaryContainer: '#001b3e',
      secondaryContainer: '#dae2f9',
      onSecondaryContainer: '#131c2b',
      successContainer: '#dcf3e3',
      onSuccessContainer: '#1b6c3a',
    });
  });

  it('text meets WCAG AA on every surface it sits on', () => {
    const { palette } = theme;
    const c = lightRoles;
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
    // Behaviour points: bonus on its green container, deductions on the error pair.
    expect(contrastRatio(c.onSuccessContainer, c.successContainer)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.error.dark, palette.error.light)).toBeGreaterThanOrEqual(4.5);
  });

  it('dark surfaces are tonal: no white elevation overlay on menus, dialogs or sheets', () => {
    const vars = theme as unknown as CssVarsTheme;
    expect(vars.colorSchemes.dark?.overlays.every((o) => o === 'none')).toBe(true);
  });

  it('the dark scheme sets its own success and info colours, not MUI\'s defaults', () => {
    const vars = theme as unknown as CssVarsTheme;
    const dark = vars.colorSchemes.dark!.palette;
    expect(dark.success.main).toBe(darkPalette.success.main);
    expect(dark.info.main).toBe(darkPalette.info.main);
    // Light keeps MUI's defaults, as before.
    expect(theme.palette.success.main).toBe('#2e7d32');
    expect(theme.palette.info.main).toBe('#0288d1');
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
