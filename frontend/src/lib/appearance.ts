// The appearance choice (Automatic, Light or Dark), kept in the `yl_appearance` cookie so the server
// renders the right scheme on the first paint. Plain values only (no React, no next/headers): the root
// layout parses the cookie with it on the server; the client hook is in `useAppearance.ts`.

export type Appearance = 'auto' | 'light' | 'dark';
/** MUI's name for the same choice (`system` follows `prefers-color-scheme`). */
export type ColorMode = 'system' | 'light' | 'dark';

/** The attribute on <html> that selects the scheme (`light` | `dark`); the theme keys its variables to it. */
export const APPEARANCE_ATTRIBUTE = 'data-appearance';

export const APPEARANCE_COOKIE = 'yl_appearance';
export const APPEARANCE_MAX_AGE = 60 * 60 * 24 * 365;

/** A stored `light` or `dark`; anything else (missing, unknown) is Automatic, the default. */
export function parseAppearance(value: string | undefined): Appearance {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/** A `document.cookie` assignment that stores the choice site-wide for a year (readable by the page). */
export function appearanceCookie(appearance: Appearance): string {
  return `${APPEARANCE_COOKIE}=${appearance}; Max-Age=${APPEARANCE_MAX_AGE}; Path=/; SameSite=Lax`;
}

export function modeForAppearance(appearance: Appearance): ColorMode {
  return appearance === 'auto' ? 'system' : appearance;
}

export function appearanceForMode(mode: ColorMode): Appearance {
  return mode === 'system' ? 'auto' : mode;
}
