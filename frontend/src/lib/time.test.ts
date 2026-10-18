import { describe, expect, it } from 'vitest';
import {
  chinaClock,
  chinaDateLabel,
  dayIndex,
  formatWeekParam,
  parseWeekParam,
  shiftWeek,
  weekRangeLabel,
  weekStartOf,
} from './time';

const now = Date.UTC(2026, 9, 18, 9, 0); // Sun Oct 18 17:00 China
const oct12 = Date.UTC(2026, 9, 11, 16, 0); // Mon Oct 12 00:00 China

describe('china time', () => {
  it('chinaClock', () => {
    expect(chinaClock(Date.UTC(2026, 9, 12, 0, 0))).toBe('08:00');
  });
  it('chinaDateLabel', () => {
    expect(chinaDateLabel(Date.UTC(2026, 9, 12, 0, 0))).toBe('Mon 12');
  });
  it('weekStartOf Sunday night -> that week Monday', () => {
    expect(weekStartOf(Date.UTC(2026, 9, 18, 15, 30))).toBe(oct12);
  });
  it('weekStartOf Monday 00:00 China is itself', () => {
    expect(weekStartOf(oct12)).toBe(oct12);
  });
  it('parseWeekParam snaps to Monday', () => {
    expect(parseWeekParam('2026-10-14', now)).toBe(oct12);
  });
  it('parseWeekParam invalid/missing -> current week', () => {
    expect(parseWeekParam('garbage', now)).toBe(oct12);
    expect(parseWeekParam('2026-02-31', now)).toBe(oct12);
    expect(parseWeekParam(undefined, now)).toBe(oct12);
  });
  it('shiftWeek', () => {
    expect(shiftWeek(oct12, 1)).toBe(Date.UTC(2026, 9, 18, 16, 0));
    expect(shiftWeek(oct12, -1)).toBe(Date.UTC(2026, 9, 4, 16, 0));
  });
  it('formatWeekParam', () => {
    expect(formatWeekParam(oct12)).toBe('2026-10-12');
  });
  it('weekRangeLabel', () => {
    expect(weekRangeLabel(oct12)).toBe('Oct 12 – 18, 2026');
    expect(weekRangeLabel(weekStartOf(Date.UTC(2026, 8, 28, 0, 0)))).toBe('Sep 28 – Oct 4, 2026');
    expect(weekRangeLabel(weekStartOf(Date.UTC(2026, 11, 28, 0, 0)))).toBe('Dec 28, 2026 – Jan 3, 2027');
  });
  it('dayIndex Friday -> 4', () => {
    expect(dayIndex(Date.UTC(2026, 9, 16, 1, 0), oct12)).toBe(4);
  });
});
