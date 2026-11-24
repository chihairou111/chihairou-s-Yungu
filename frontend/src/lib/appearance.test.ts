import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_COOKIE,
  APPEARANCE_MAX_AGE,
  appearanceCookie,
  appearanceForMode,
  modeForAppearance,
  parseAppearance,
} from './appearance';

describe('appearance cookie', () => {
  it('names the cookie and keeps it for a year', () => {
    expect(APPEARANCE_COOKIE).toBe('yl_appearance');
    expect(APPEARANCE_MAX_AGE).toBe(31536000);
  });

  it('reads the three choices', () => {
    expect(parseAppearance('dark')).toBe('dark');
    expect(parseAppearance('light')).toBe('light');
    expect(parseAppearance('auto')).toBe('auto');
  });

  it('treats a missing or unknown value as Automatic', () => {
    expect(parseAppearance(undefined)).toBe('auto');
    expect(parseAppearance('')).toBe('auto');
    expect(parseAppearance('x')).toBe('auto');
    expect(parseAppearance('Dark')).toBe('auto');
    expect(parseAppearance('dark ')).toBe('auto');
  });

  it('stores a choice site-wide for a year, readable by the page (not httpOnly)', () => {
    expect(appearanceCookie('dark')).toBe('yl_appearance=dark; Max-Age=31536000; Path=/; SameSite=Lax');
    expect(appearanceCookie('auto')).toBe('yl_appearance=auto; Max-Age=31536000; Path=/; SameSite=Lax');
  });

  it("maps a choice to MUI's mode and back", () => {
    expect(modeForAppearance('auto')).toBe('system');
    expect(modeForAppearance('light')).toBe('light');
    expect(modeForAppearance('dark')).toBe('dark');
    expect(appearanceForMode('system')).toBe('auto');
    expect(appearanceForMode('light')).toBe('light');
    expect(appearanceForMode('dark')).toBe('dark');
  });
});
