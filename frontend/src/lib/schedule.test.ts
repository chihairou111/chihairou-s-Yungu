import { describe, expect, it } from 'vitest';
import { classTimeline, nowLineHours, todaysClasses } from './schedule';
import type { ClassEvent } from './types';

const HOUR = 3600_000;
const MIN = 60_000;
// Mon Oct 19 2026, 10:00 China time — still Sunday Oct 18 in Los Angeles, where `npm test` runs.
const NOW = Date.UTC(2026, 9, 19, 2, 0);
const MONDAY = Date.UTC(2026, 9, 18, 16, 0); // Mon Oct 19 00:00 China

const ev = (name: string, startMs: number, isClass = true, room: string | null = 'D419'): ClassEvent => ({
  name,
  room,
  start: startMs,
  end: startMs + 40 * MIN,
  isClass,
  courseId: isClass ? 1 : null,
});

describe('todaysClasses', () => {
  it("keeps only today's China-time classes, sorted by start", () => {
    expect(new Date(NOW).getDate()).toBe(18); // guard: the host clock really is on a different day
    const events = [
      ev('H Physics I', MONDAY + 12.5 * HOUR),
      ev('Lunch', MONDAY + 11.5 * HOUR, false, null),
      ev('Chinese I', MONDAY + 8 * HOUR),
      ev('Tuesday Algebra', MONDAY + 24 * HOUR + 8 * HOUR),
      ev('Sunday class', MONDAY - 2 * HOUR),
      ev('CL Business I', MONDAY + 8.75 * HOUR, true, 'D405'),
    ];
    expect(todaysClasses(events, NOW).map((e) => e.name)).toEqual(['Chinese I', 'CL Business I', 'H Physics I']);
  });

  it('returns an empty list when nothing is a class today', () => {
    expect(todaysClasses([ev('Lunch', MONDAY + 11.5 * HOUR, false, null)], NOW)).toEqual([]);
  });

  it('does not mutate its input', () => {
    const events = [ev('B', MONDAY + 9 * HOUR), ev('A', MONDAY + 8 * HOUR)];
    todaysClasses(events, NOW);
    expect(events.map((e) => e.name)).toEqual(['B', 'A']);
  });
});

describe('classTimeline', () => {
  const day = [ev('A', MONDAY + 8 * HOUR), ev('B', MONDAY + 9 * HOUR), ev('C', MONDAY + 10 * HOUR), ev('D', MONDAY + 11 * HOUR)];

  it('marks ended classes, the one in progress and the next one', () => {
    // 09:10: A ended, B runs until 09:40, C is next.
    expect(classTimeline(day, MONDAY + 9 * HOUR + 10 * MIN)).toEqual(['ended', 'now', 'next', 'later']);
  });

  it('marks only the next class between classes', () => {
    expect(classTimeline(day, MONDAY + 9 * HOUR + 50 * MIN)).toEqual(['ended', 'ended', 'next', 'later']);
    expect(classTimeline(day, MONDAY)).toEqual(['next', 'later', 'later', 'later']);
  });

  it('treats a class as ended at its end time, and everything as ended after the last class', () => {
    expect(classTimeline(day, MONDAY + 8 * HOUR + 40 * MIN)).toEqual(['ended', 'next', 'later', 'later']);
    expect(classTimeline(day, MONDAY + 20 * HOUR)).toEqual(['ended', 'ended', 'ended', 'ended']);
  });
});

describe('nowLineHours', () => {
  const WEEK = MONDAY; // Mon Oct 19 00:00 China

  it('gives the hours since the first grid hour on the current day', () => {
    // Wed 10:30, grid 08:00–16:00.
    expect(nowLineHours(WEEK + 2 * 24 * HOUR + 10.5 * HOUR, WEEK, 8, 8)).toEqual({ day: 2, hours: 2.5 });
  });

  it('hides outside the hour range', () => {
    expect(nowLineHours(WEEK + 7.5 * HOUR, WEEK, 8, 8)).toBeNull();
    expect(nowLineHours(WEEK + 16 * HOUR + MIN, WEEK, 8, 8)).toBeNull();
    expect(nowLineHours(WEEK + 16 * HOUR, WEEK, 8, 8)).toEqual({ day: 0, hours: 8 });
  });

  it('hides when now is not in the shown week', () => {
    expect(nowLineHours(WEEK - HOUR, WEEK, 0, 24)).toBeNull();
    expect(nowLineHours(WEEK + 7 * 24 * HOUR + 9 * HOUR, WEEK, 8, 8)).toBeNull();
  });
});
