import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/colors';
import { darkPalette, darkRoles, lightPalette, lightRoles } from './expressive';

const schemes = [
  ['light', lightRoles, lightPalette],
  ['dark', darkRoles, darkPalette],
] as const;

describe.each(schemes)('the %s scheme meets WCAG AA', (_name, c, palette) => {
  it('body text on its surfaces (4.5:1)', () => {
    expect(contrastRatio(c.onSurface, c.surface)).toBeGreaterThanOrEqual(4.5);
    for (const s of [c.surface, c.surfaceContainerLow, c.surfaceContainer, c.surfaceContainerHigh]) {
      expect(contrastRatio(c.onSurfaceVariant, s)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('text on its tonal containers (4.5:1)', () => {
    expect(contrastRatio(c.onPrimaryContainer, c.primaryContainer)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.onSecondaryContainer, c.secondaryContainer)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.onSuccessContainer, c.successContainer)).toBeGreaterThanOrEqual(4.5);
  });

  it('outlines against the surface (3:1)', () => {
    expect(contrastRatio(c.outline, c.surface)).toBeGreaterThanOrEqual(3);
  });

  it('palette chips: the ink (.dark) on its container (.light) (4.5:1)', () => {
    for (const key of ['error', 'warning', 'primary', 'success', 'info'] as const) {
      expect(contrastRatio(palette[key].dark, palette[key].light), key).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('coloured text on the page, cards, sheets and menus (4.5:1)', () => {
    for (const s of [c.surface, c.surfaceContainerLowest, c.surfaceContainerLow, c.surfaceContainer]) {
      expect(contrastRatio(palette.primary.main, s)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.error.main, s)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette.warning.dark, s)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('success and info marks (icons) on the page and cards (3:1)', () => {
    for (const s of [c.surface, c.surfaceContainerLowest, c.surfaceContainerLow]) {
      expect(contrastRatio(palette.success.main, s)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(palette.info.main, s)).toBeGreaterThanOrEqual(3);
    }
  });

  it('filled buttons: contrast text on the main colour (4.5:1)', () => {
    for (const key of ['error', 'warning', 'primary'] as const) {
      expect(contrastRatio(palette[key].contrastText, palette[key].main)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
