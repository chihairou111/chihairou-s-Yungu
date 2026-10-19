// Whether the docked Today's classes panel is open on the Assignments page. No next/headers
// import, so client code can use it; the page reads the cookie on the server for the first paint.

export const TODAY_PANEL_COOKIE = 'yl_today_panel';
export const TODAY_PANEL_MAX_AGE = 60 * 60 * 24 * 365;

/** True only for a stored `open`; a missing or unknown value means closed (the default). */
export function parseTodayPanel(value: string | undefined): boolean {
  return value === 'open';
}

/** A `document.cookie` assignment that stores the panel state site-wide for a year. */
export function todayPanelCookie(open: boolean): string {
  return `${TODAY_PANEL_COOKIE}=${open ? 'open' : 'closed'}; Max-Age=${TODAY_PANEL_MAX_AGE}; Path=/; SameSite=Lax`;
}
