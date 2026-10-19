import { describe, expect, it } from 'vitest';
import {
  chinaClock,
  chinaDateLabel,
  chinaDayNumber,
  chinaDueLabel,
  chinaShortDate,
  dayIndex,
  formatWeekParam,
  parseWeekParam,
  shiftWeek,
  weekRangeLabel,
  weekRangeShortLabel,
  weekStartOf,
} from './time';

const now = Date.UTC(2026, 9, 18, 9, 0); // Sun Oct 18 17:00 China
const oct12 = Date.UTC(2026, 9, 11, 16, 0); // Mon Oct 12 00:00 China

describe('china time', () => {
  it('chinaClock', () => {
    expect(chinaClock(Date.UTC(2026, 9, 12, 0, 0))).toBe('08:00');
  });
  it('chinaDueLabel', () => {
    expect(chinaDueLabel(Date.UTC(2026, 9, 16, 14, 0))).toBe('Oct 16, 22:00');
    // 17:30 UTC on Oct 16 is already Oct 17 in China.
    expect(chinaDueLabel(Date.UTC(2026, 9, 16, 17, 30))).toBe('Oct 17, 01:30');
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
  it('chinaShortDate', () => {
    expect(chinaShortDate(Date.UTC(2026, 9, 23, 14, 0))).toBe('Fri, Oct 23');
    // 17:30 UTC on Oct 16 is already Sat Oct 17 in China.
    expect(chinaShortDate(Date.UTC(2026, 9, 16, 17, 30))).toBe('Sat, Oct 17');
  });
  it('chinaDayNumber counts China calendar days, not host ones', () => {
    const sun2330 = Date.UTC(2026, 9, 18, 15, 30); // Sun Oct 18 23:30 China
    const mon0030 = Date.UTC(2026, 9, 18, 16, 30); // Mon Oct 19 00:30 China, same LA date
    expect(chinaDayNumber(mon0030) - chinaDayNumber(sun2330)).toBe(1);
    expect(chinaDayNumber(oct12) - chinaDayNumber(oct12 + 23 * 3600_000)).toBe(0);
  });
});

describe('weekRangeShortLabel', () => {
  const weekOf = (y: number, m: number, d: number) => weekStartOf(Date.UTC(y, m, d, 4, 0));
  it('uses one month name within a month', () => {
    expect(weekRangeShortLabel(weekOf(2026, 9, 19))).toBe('Oct 19–25');
  });
  it('names both months across a month or a year', () => {
    expect(weekRangeShortLabel(weekOf(2026, 9, 26))).toBe('Oct 26–Nov 1');
    expect(weekRangeShortLabel(weekOf(2026, 11, 28))).toBe('Dec 28–Jan 3');
  });
});
