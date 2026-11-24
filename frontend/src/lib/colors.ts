import { darkRoles, lightRoles } from '@/theme/roles';
import type { CourseColor } from './types';

/** Google Calendar event colors; every course gets one, shared by the calendar and course cards. */
export const COURSE_COLORS: Record<CourseColor, string> = {
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
};

/** Hex for a course color name; Graphite for anything outside the palette (e.g. a new service value). */
export function courseColorHex(color: string): string {
  return Object.hasOwn(COURSE_COLORS, color) ? COURSE_COLORS[color as CourseColor] : COURSE_COLORS.Graphite;
}

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

/** WCAG relative luminance of an sRGB color. */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG contrast ratio between two hex colors (1–21). */
export function contrastRatio(a: string, b: string): number {
  return ratio(parseHex(a), parseHex(b));
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** `amount` of `hex` laid over `surface` (0 = the surface, 1 = the color). */
export function tint(hex: string, surface: string, amount: number): string {
  const c = parseHex(hex);
  const s = parseHex(surface);
  return toHex(c.map((v, i) => v * amount + s[i] * (1 - amount)) as Rgb);
}

/** Share of the course color in a light event fill. */
export const EVENT_TINT = 0.18;
/** Ink contrast on the tint; above AA's 4.5 so small calendar text stays comfortable. */
const EVENT_INK_CONTRAST = 5.5;

/**
 * Google Calendar's light event style: a light tint of the course color over `surface`, with text in
 * a dark shade of the same hue (darkened just until it reads well on the tint).
 */
export function lightEventColors(hex: string, surface: string): { bg: string; fg: string } {
  const bg = tint(hex, surface, EVENT_TINT);
  let fg = toHex(parseHex(hex));
  for (let k = 0.05; contrastRatio(fg, bg) < EVENT_INK_CONTRAST && k <= 1; k += 0.05) {
    fg = tint(hex, '#000000', 1 - k);
  }
  return { bg, fg };
}

/** Share of the course color in a dark event fill: more than in light, so the hue still shows on a dark surface. */
export const DARK_EVENT_TINT = 0.26;

/**
 * The dark counterpart: a deeper tint of the course color over the dark card surface, with text in a
 * light shade of the same hue (lightened just until it reads well on the tint).
 */
function darkEventColors(hex: string, surface: string): { bg: string; fg: string } {
  const bg = tint(hex, surface, DARK_EVENT_TINT);
  let fg = toHex(parseHex(hex));
  for (let k = 0.05; contrastRatio(fg, bg) < EVENT_INK_CONTRAST && k <= 1; k += 0.05) {
    fg = tint(hex, '#ffffff', 1 - k);
  }
  return { bg, fg };
}

/**
 * A course block's fill and ink in each scheme, on the card surface (`surfaceContainerLow`) the
 * calendar sits on. Both go on the block as custom properties; CSS picks the pair for the scheme.
 */
export function courseEventColors(hex: string): { light: { bg: string; fg: string }; dark: { bg: string; fg: string } } {
  return {
    light: lightEventColors(hex, lightRoles.surfaceContainerLow),
    dark: darkEventColors(hex, darkRoles.surfaceContainerLow),
  };
}
