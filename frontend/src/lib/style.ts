// The visual style the owner picked in Settings. No next/headers import, so client code can use it.

/** `classic` = Material 2 (small 4px corners); `expressive` = Material 3, rounded. */
export type UiStyle = 'classic' | 'expressive';

export const STYLE_COOKIE = 'yl_style';
export const STYLE_MAX_AGE = 60 * 60 * 24 * 365;
/** A new visitor gets the newer style. */
export const DEFAULT_STYLE: UiStyle = 'expressive';

/** The stored style, or the default when the cookie is missing or holds anything else. */
export function parseStyle(value: string | undefined): UiStyle {
  return value === 'classic' || value === 'expressive' ? value : DEFAULT_STYLE;
}

/** A `document.cookie` assignment that stores the style site-wide for a year. */
export function styleCookie(style: UiStyle): string {
  return `${STYLE_COOKIE}=${style}; Max-Age=${STYLE_MAX_AGE}; Path=/; SameSite=Lax`;
}
