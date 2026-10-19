import { dayIndex, weekStartOf } from './time';
import type { ClassEvent } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Classes (not routine items) on the China-time day containing `now`, sorted by start time. */
export function todaysClasses(events: ClassEvent[], now: number): ClassEvent[] {
  const weekStart = weekStartOf(now);
  const today = dayIndex(now, weekStart);
  return events
    .filter((e) => e.isClass && e.start >= weekStart && dayIndex(e.start, weekStart) === today)
    .sort((a, b) => a.start - b.start);
}

export type ClassTiming = 'ended' | 'now' | 'next' | 'later';

/** Where each of a day's classes (sorted by start) stands at `now`: ended, in progress, the next to start, or later. */
export function classTimeline(classes: ClassEvent[], now: number): ClassTiming[] {
  const next = classes.findIndex((c) => c.start >= now);
  return classes.map((c, i) => {
    if (c.end <= now) return 'ended';
    if (c.start <= now) return 'now';
    return i === next ? 'next' : 'later';
  });
}

/**
 * Where the current-time line goes in a week grid: the day column (0 = Monday) and the hours below
 * the grid's first hour. Null when `now` is outside the week or outside the shown hours.
 */
export function nowLineHours(now: number, weekStart: number, firstHour: number, hourCount: number): { day: number; hours: number } | null {
  if (now < weekStart || now >= weekStart + 7 * DAY) return null;
  const day = dayIndex(now, weekStart);
  const hours = (now - weekStart - day * DAY) / HOUR - firstHour;
  if (hours < 0 || hours > hourCount) return null;
  return { day, hours };
}
