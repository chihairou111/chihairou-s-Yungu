import { chinaDayNumber, chinaShortDate, dayIndex, shiftWeek, weekStartOf } from './time';
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

/** On a day without classes, from this China-time hour the panel looks ahead to the next school day. */
const SCHOOL_OUT_HOUR = 16;

const byStart = (a: ClassEvent, b: ClassEvent) => a.start - b.start;

export interface PanelClasses {
  /** `today`: today's classes (possibly none); `next`: today is over, these are the next school day's. */
  label: 'today' | 'next';
  /** The shown day: "Mon, Oct 19"; for the next day "Tomorrow · Tue, Oct 20" or "Mon, Oct 26". */
  dayLabel: string;
  items: ClassEvent[];
}

/**
 * What the Today's classes panel shows at `now`: today's classes until the last has ended (or, on a
 * day without classes, until school is out), then the classes of the next day in `events` that has any.
 */
export function classesForPanel(events: ClassEvent[], now: number): PanelClasses {
  const today = todaysClasses(events, now);
  const todayNumber = chinaDayNumber(now);
  const over = today.length > 0 ? today.every((c) => c.end <= now) : (now - weekStartOf(now)) % DAY >= SCHOOL_OUT_HOUR * HOUR;
  if (over) {
    const later = events.filter((e) => e.isClass && chinaDayNumber(e.start) > todayNumber).sort(byStart);
    if (later.length > 0) {
      const day = chinaDayNumber(later[0].start);
      const date = chinaShortDate(later[0].start);
      return {
        label: 'next',
        dayLabel: day === todayNumber + 1 ? `Tomorrow · ${date}` : date,
        items: later.filter((e) => chinaDayNumber(e.start) === day),
      };
    }
  }
  return { label: 'today', dayLabel: chinaShortDate(now), items: today };
}

/**
 * The classes `classesForPanel` may need from `now` on: today's and those of the next day with
 * classes. Loads next week only when this week has no class after today.
 */
export async function loadPanelClasses(now: number, getWeek: (weekStart: number) => Promise<ClassEvent[]>): Promise<ClassEvent[]> {
  const todayNumber = chinaDayNumber(now);
  const fromToday = (week: ClassEvent[]) => week.filter((e) => e.isClass && chinaDayNumber(e.start) >= todayNumber);
  const weekStart = weekStartOf(now);
  let classes = fromToday(await getWeek(weekStart));
  if (!classes.some((e) => chinaDayNumber(e.start) > todayNumber)) {
    classes = [...classes, ...fromToday(await getWeek(shiftWeek(weekStart, 1)))];
  }
  classes.sort(byStart);
  const later = classes.find((e) => chinaDayNumber(e.start) > todayNumber);
  const lastDay = later ? chinaDayNumber(later.start) : todayNumber;
  return classes.filter((e) => chinaDayNumber(e.start) <= lastDay);
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
