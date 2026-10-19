import { describe, expect, it, vi } from 'vitest';
import { classTimeline, classesForPanel, loadPanelClasses, nowLineHours, todaysClasses } from './schedule';
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

describe('classesForPanel', () => {
  const DAY = 24 * HOUR;
  /** Two classes on each weekday of the week starting at `monday`, plus a routine item. */
  const week = (monday: number) =>
    [0, 1, 2, 3, 4].flatMap((d) => [
      ev(`Day${d} A`, monday + d * DAY + 8 * HOUR),
      ev(`Day${d} Lunch`, monday + d * DAY + 11.5 * HOUR, false, null),
      ev(`Day${d} B`, monday + d * DAY + 14 * HOUR),
    ]);
  const events = [...week(MONDAY), ...week(MONDAY + 7 * DAY)];
  const names = (r: { items: ClassEvent[] }) => r.items.map((e) => e.name);

  it("shows today's classes during the school day", () => {
    const r = classesForPanel(events, MONDAY + 10 * HOUR);
    expect(r.label).toBe('today');
    expect(r.dayLabel).toBe('Mon, Oct 19');
    expect(names(r)).toEqual(['Day0 A', 'Day0 B']);
  });

  it("keeps today's classes until the last one has ended", () => {
    expect(classesForPanel(events, MONDAY + 14 * HOUR + 39 * MIN).label).toBe('today');
    expect(classesForPanel(events, MONDAY + 14 * HOUR + 40 * MIN).label).toBe('next');
  });

  it("after the last class, shows tomorrow's classes", () => {
    const r = classesForPanel(events, MONDAY + 21 * HOUR);
    expect(r).toEqual({ label: 'next', dayLabel: 'Tomorrow · Tue, Oct 20', items: r.items });
    expect(names(r)).toEqual(['Day1 A', 'Day1 B']);
  });

  it("on Friday evening, skips the weekend to Monday's classes", () => {
    const r = classesForPanel(events, MONDAY + 4 * DAY + 21 * HOUR);
    expect(r.label).toBe('next');
    expect(r.dayLabel).toBe('Mon, Oct 26');
    expect(names(r)).toEqual(['Day0 A', 'Day0 B']);
    expect(r.items[0].start).toBe(MONDAY + 7 * DAY + 8 * HOUR);
  });

  it('on a day without classes, shows the next school day only once school is out', () => {
    const saturday = MONDAY + 5 * DAY;
    expect(classesForPanel(events, saturday + 10 * HOUR)).toEqual({ label: 'today', dayLabel: 'Sat, Oct 24', items: [] });
    const evening = classesForPanel(events, saturday + 20 * HOUR);
    expect(evening.label).toBe('next');
    expect(evening.dayLabel).toBe('Mon, Oct 26');
  });

  it("keeps today's ended classes when nothing later is known", () => {
    const r = classesForPanel(week(MONDAY), MONDAY + 4 * DAY + 21 * HOUR);
    expect(r.label).toBe('today');
    expect(names(r)).toEqual(['Day4 A', 'Day4 B']);
  });
});

describe('loadPanelClasses', () => {
  const DAY = 24 * HOUR;
  const weekOf = (monday: number) => [0, 1, 2, 3, 4].map((d) => ev(`W${(monday - MONDAY) / (7 * DAY)} D${d}`, monday + d * DAY + 8 * HOUR));

  it("loads only this week while it has a class day after today, and keeps today's and the next day's classes", async () => {
    const getWeek = vi.fn(async (ws: number) => weekOf(ws));
    const classes = await loadPanelClasses(MONDAY + 21 * HOUR, getWeek);
    expect(getWeek.mock.calls).toEqual([[MONDAY]]);
    expect(classes.map((e) => e.name)).toEqual(['W0 D0', 'W0 D1']);
  });

  it('loads next week as well on Friday evening', async () => {
    const getWeek = vi.fn(async (ws: number) => weekOf(ws));
    const classes = await loadPanelClasses(MONDAY + 4 * DAY + 21 * HOUR, getWeek);
    expect(getWeek.mock.calls).toEqual([[MONDAY], [MONDAY + 7 * DAY]]);
    expect(classes.map((e) => e.name)).toEqual(['W0 D4', 'W1 D0']);
  });
});
