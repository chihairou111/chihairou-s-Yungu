import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, STYLE_COOKIE, STYLE_MAX_AGE, parseStyle, styleCookie } from './style';

describe('style cookie', () => {
  it('names the cookie and keeps it for a year', () => {
    expect(STYLE_COOKIE).toBe('yl_style');
    expect(STYLE_MAX_AGE).toBe(31536000);
  });

  it('defaults a new visitor to the newer, rounded style', () => {
    expect(DEFAULT_STYLE).toBe('expressive');
    expect(parseStyle(undefined)).toBe('expressive');
    expect(parseStyle('')).toBe('expressive');
  });

  it('falls back to the default for unknown values', () => {
    expect(parseStyle('bogus')).toBe('expressive');
    expect(parseStyle('Classic')).toBe('expressive');
    expect(parseStyle('classic ')).toBe('expressive');
  });

  it('reads both known styles', () => {
    expect(parseStyle('classic')).toBe('classic');
    expect(parseStyle('expressive')).toBe('expressive');
  });

  it('serialises a document.cookie string for the whole site, sameSite lax', () => {
    expect(styleCookie('classic')).toBe('yl_style=classic; Max-Age=31536000; Path=/; SameSite=Lax');
    expect(styleCookie('expressive')).toBe('yl_style=expressive; Max-Age=31536000; Path=/; SameSite=Lax');
  });
});
