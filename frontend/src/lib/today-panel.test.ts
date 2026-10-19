import { describe, expect, it } from 'vitest';
import { TODAY_PANEL_COOKIE, TODAY_PANEL_MAX_AGE, parseTodayPanel, todayPanelCookie } from './today-panel';

describe("today's classes panel cookie", () => {
  it('names the cookie and keeps it for a year', () => {
    expect(TODAY_PANEL_COOKIE).toBe('yl_today_panel');
    expect(TODAY_PANEL_MAX_AGE).toBe(31536000);
  });

  it('defaults to closed when the cookie is missing or holds anything else', () => {
    expect(parseTodayPanel(undefined)).toBe(false);
    expect(parseTodayPanel('')).toBe(false);
    expect(parseTodayPanel('closed')).toBe(false);
    expect(parseTodayPanel('Open')).toBe(false);
    expect(parseTodayPanel('open ')).toBe(false);
    expect(parseTodayPanel('true')).toBe(false);
  });

  it('reads open', () => {
    expect(parseTodayPanel('open')).toBe(true);
  });

  it('serialises a document.cookie string for the whole site, sameSite lax', () => {
    expect(todayPanelCookie(true)).toBe('yl_today_panel=open; Max-Age=31536000; Path=/; SameSite=Lax');
    expect(todayPanelCookie(false)).toBe('yl_today_panel=closed; Max-Age=31536000; Path=/; SameSite=Lax');
  });
});
