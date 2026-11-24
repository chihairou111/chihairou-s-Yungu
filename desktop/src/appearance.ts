/**
 * The gear's Appearance choice in the shell: the window follows it through `nativeTheme.themeSource`
 * (which also drives the pages' `prefers-color-scheme`, so Automatic, the splash and the start-error
 * page follow it too) and paints its background in the app's surface, so nothing flashes white.
 */
export type Appearance = 'auto' | 'light' | 'dark';

/** The app's surface (`frontend/src/theme/roles.ts`): the window's background before a page paints. */
export const LIGHT_SURFACE = '#f9f9ff';
export const DARK_SURFACE = '#111318';

export function isAppearance(v: unknown): v is Appearance {
  return v === 'auto' || v === 'light' || v === 'dark';
}

/** A value from the page: exactly one of the three, or an error. */
export function parseAppearance(v: unknown): Appearance {
  if (!isAppearance(v)) throw new Error('bad value');
  return v;
}

export function themeSourceFor(a: Appearance): 'system' | 'light' | 'dark' {
  return a === 'auto' ? 'system' : a;
}

export function windowBackground(dark: boolean): string {
  return dark ? DARK_SURFACE : LIGHT_SURFACE;
}
