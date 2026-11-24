import { describe, expect, it } from 'vitest';
import { darkRoles, lightRoles } from '@/theme/roles';
import { COURSE_COLORS, EVENT_TINT, contrastRatio, courseColorHex, courseEventColors, lightEventColors, tint } from './colors';

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

describe('courseColorHex', () => {
  it('maps a palette name to its hex', () => {
    expect(courseColorHex('Banana')).toBe('#F6BF26');
  });

  it('falls back to Graphite for a name outside the palette', () => {
    for (const bad of ['Chartreuse', 'toString', '', '__proto__']) {
      expect(courseColorHex(bad), bad).toBe('#616161');
    }
  });
});

describe('lightEventColors (Google Calendar light event style)', () => {
  const SURFACES = ['#ffffff', '#f3f3fa', '#f9f9ff', '#f5f7fa'];

  it('fills with a light tint of the course color over the surface', () => {
    expect(tint('#D50000', '#ffffff', 0.18)).toBe('#f7d1d1');
    expect(lightEventColors('#D50000', '#ffffff').bg).toBe(tint('#D50000', '#ffffff', EVENT_TINT));
    expect(EVENT_TINT).toBeGreaterThanOrEqual(0.15);
    expect(EVENT_TINT).toBeLessThanOrEqual(0.2);
  });

  it('writes in a dark shade of the course color that meets WCAG AA on the tint, on every surface', () => {
    for (const surface of SURFACES) {
      for (const [name, hex] of Object.entries(COURSE_COLORS)) {
        const { bg, fg } = lightEventColors(hex, surface);
        expect(contrastRatio(fg, bg), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        // Still recognisably a light fill, not the saturated color.
        expect(contrastRatio(bg, surface), `${name} tint on ${surface}`).toBeLessThan(1.6);
      }
    }
  });

  it('keeps the hue: the ink of a red course is red-dominant, of a blue course blue-dominant', () => {
    const red = lightEventColors(COURSE_COLORS.Tomato, '#ffffff').fg;
    const blue = lightEventColors(COURSE_COLORS.Blueberry, '#ffffff').fg;
    expect(parseInt(red.slice(1, 3), 16)).toBeGreaterThan(parseInt(red.slice(5, 7), 16));
    expect(parseInt(blue.slice(5, 7), 16)).toBeGreaterThan(parseInt(blue.slice(1, 3), 16));
  });
});

describe('courseEventColors (a course block in each scheme)', () => {
  const luminanceOrder = (a: string, b: string) => contrastRatio(a, '#000000') - contrastRatio(b, '#000000');

  it('is the light event style on the light card surface', () => {
    expect(courseEventColors('#D50000').light).toEqual(lightEventColors('#D50000', lightRoles.surfaceContainerLow));
  });

  it('reads at 5.5:1 or more in both schemes, for every course colour', () => {
    for (const [name, hex] of Object.entries(COURSE_COLORS)) {
      const { light, dark } = courseEventColors(hex);
      expect(contrastRatio(light.fg, light.bg), `${name} light`).toBeGreaterThanOrEqual(5.5);
      expect(contrastRatio(dark.fg, dark.bg), `${name} dark`).toBeGreaterThanOrEqual(5.5);
    }
  });

  it('fills dark blocks with a tint over the dark card surface, darker than the light fill', () => {
    for (const [name, hex] of Object.entries(COURSE_COLORS)) {
      const { light, dark } = courseEventColors(hex);
      expect(luminanceOrder(dark.bg, light.bg), name).toBeLessThan(0);
      // Darker than the light fill, but still visibly the course colour on the dark surface.
      expect(contrastRatio(dark.bg, darkRoles.surfaceContainerLow), name).toBeGreaterThan(1.1);
      // Light ink on the dark fill.
      expect(luminanceOrder(dark.fg, dark.bg), name).toBeGreaterThan(0);
    }
  });

  it('keeps the hue in the dark ink', () => {
    const red = courseEventColors(COURSE_COLORS.Tomato).dark.fg;
    const blue = courseEventColors(COURSE_COLORS.Blueberry).dark.fg;
    expect(parseInt(red.slice(1, 3), 16)).toBeGreaterThan(parseInt(red.slice(5, 7), 16));
    expect(parseInt(blue.slice(5, 7), 16)).toBeGreaterThan(parseInt(blue.slice(1, 3), 16));
  });
});
