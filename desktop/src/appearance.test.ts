import { describe, expect, it } from 'vitest';
import { DARK_SURFACE, LIGHT_SURFACE, parseAppearance, themeSourceFor, windowBackground } from './appearance';

describe('appearance', () => {
  it("maps the gear's choice to nativeTheme.themeSource (Automatic follows the system)", () => {
    expect(themeSourceFor('auto')).toBe('system');
    expect(themeSourceFor('light')).toBe('light');
    expect(themeSourceFor('dark')).toBe('dark');
  });

  it('accepts only auto, light or dark from the page', () => {
    expect(parseAppearance('auto')).toBe('auto');
    expect(parseAppearance('light')).toBe('light');
    expect(parseAppearance('dark')).toBe('dark');
    for (const bad of ['system', 'Dark', '', undefined, null, 1, {}, ['dark']]) {
      expect(() => parseAppearance(bad), String(bad)).toThrow('bad value');
    }
  });

  it("paints the window in the app's surface for the scheme in use", () => {
    expect(DARK_SURFACE).toBe('#111318');
    expect(LIGHT_SURFACE).toBe('#f9f9ff');
    expect(windowBackground(true)).toBe(DARK_SURFACE);
    expect(windowBackground(false)).toBe(LIGHT_SURFACE);
  });
});
