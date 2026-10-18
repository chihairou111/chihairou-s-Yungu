import { describe, expect, it } from 'vitest';
import { COURSE_COLORS, contrastRatio, courseColorHex, readableTextOn } from './colors';

const DARK = 'rgba(0,0,0,0.87)';

describe('COURSE_COLORS', () => {
  it('uses the Google Calendar event palette', () => {
    expect(COURSE_COLORS).toEqual({
      Tomato: '#D50000',
      Flamingo: '#E67C73',
      Tangerine: '#F4511E',
      Banana: '#F6BF26',
      Sage: '#33B679',
      Basil: '#0B8043',
      Peacock: '#039BE5',
      Blueberry: '#3F51B5',
      Lavender: '#7986CB',
      Grape: '#8E24AA',
      Graphite: '#616161',
    });
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG formula for known pairs', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#3F51B5', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#3F51B5'), 10);
  });
});

describe('readableTextOn', () => {
  it('puts white text on dark colors', () => {
    for (const name of ['Tomato', 'Basil', 'Blueberry', 'Grape', 'Graphite'] as const) {
      expect(readableTextOn(COURSE_COLORS[name]), name).toBe('#fff');
    }
  });

  it('puts near-black text on light colors', () => {
    for (const name of ['Banana', 'Flamingo', 'Tangerine', 'Sage', 'Peacock', 'Lavender'] as const) {
      expect(readableTextOn(COURSE_COLORS[name]), name).toBe(DARK);
    }
  });

  it('always meets WCAG AA (4.5:1) on every palette color', () => {
    for (const [name, hex] of Object.entries(COURSE_COLORS)) {
      const fg = readableTextOn(hex) === '#fff' ? '#ffffff' : '#212121'; // 87% black over white-ish ≈ #212121 worst case
      expect(contrastRatio(fg, hex), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('accepts lowercase and 3-digit hex', () => {
    expect(readableTextOn('#fff')).toBe(DARK);
    expect(readableTextOn('#000')).toBe('#fff');
    expect(readableTextOn('#3f51b5')).toBe('#fff');
  });
});

describe('courseColorHex', () => {
  it('maps a palette name to its hex', () => {
    expect(courseColorHex('Banana')).toBe('#F6BF26');
  });

  it('falls back to Graphite for a name outside the palette, so text color never fails', () => {
    for (const bad of ['Chartreuse', 'toString', '', '__proto__']) {
      expect(courseColorHex(bad), bad).toBe('#616161');
      expect(() => readableTextOn(courseColorHex(bad))).not.toThrow();
    }
  });
});
