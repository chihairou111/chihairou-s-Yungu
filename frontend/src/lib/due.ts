import { chinaClock, chinaDayNumber, chinaShortDate, weekStartOf } from './time';
import type { Assignment } from './types';

const DAY = 24 * 3600_000;
const WEEK = 7 * DAY;

/**
 * The due day ("Due today", "Due tomorrow", "Due Thu, Oct 22") and, while the work is not yet late,
 * the China-time clock. One format for every view.
 */
export function dueParts(dueAt: number, now: number): { day: string; time: string | null } {
  const days = chinaDayNumber(dueAt) - chinaDayNumber(now);
  const day = days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due ${chinaShortDate(dueAt)}`;
  return { day, time: dueAt >= now ? chinaClock(dueAt) : null };
}

/** "Due today · 22:00", "Due Thu, Oct 22 · 22:00"; late work drops the time: "Due Sat, Oct 17". */
export function dueLabel(dueAt: number, now: number): string {
  const { day, time } = dueParts(dueAt, now);
  return time ? `${day} · ${time}` : day;
}

export interface DateGroup {
  label: string;
  items: Assignment[];
}

/** Buckets in the given label order, empty ones dropped. */
function bucket(items: Assignment[], labels: readonly string[], labelOf: (a: Assignment) => string): DateGroup[] {
  const groups = labels.map((label) => ({ label, items: items.filter((a) => labelOf(a) === label) }));
  return groups.filter((g) => g.items.length > 0);
}

const UPCOMING = ['Tomorrow', 'This week', 'Next week', 'Later'] as const;

/** Upcoming work by China date, soonest first: Tomorrow · This week (through Sunday) · Next week · Later. */
export function upcomingGroups(items: Assignment[], now: number): DateGroup[] {
  const thisWeek = weekStartOf(now);
  const sorted = [...items].sort((a, b) => a.dueAt - b.dueAt);
  return bucket(sorted, UPCOMING, (a) => {
    if (chinaDayNumber(a.dueAt) - chinaDayNumber(now) <= 1) return 'Tomorrow';
    const week = weekStartOf(a.dueAt);
    if (week === thisWeek) return 'This week';
    if (week === thisWeek + WEEK) return 'Next week';
    return 'Later';
  });
}

const SUBMITTED = ['This week', 'Last week', 'Earlier'] as const;

/** When the work was handed in; the due date only for a row that does not say (never from the service). */
const handedInAt = (a: Assignment) => a.submittedAt ?? a.dueAt;

/**
 * Submitted work by when it was handed in (China weeks), newest first: This week · Last week · Earlier.
 * Ties keep the list's order.
 */
export function submittedGroups(items: Assignment[], now: number): DateGroup[] {
  const thisWeek = weekStartOf(now);
  const sorted = [...items].sort((a, b) => handedInAt(b) - handedInAt(a));
  return bucket(sorted, SUBMITTED, (a) => {
    const week = weekStartOf(handedInAt(a));
    // A hand-in stamped after this week (a clock ahead of China time) still reads as this week's.
    if (week >= thisWeek) return 'This week';
    if (week === thisWeek - WEEK) return 'Last week';
    return 'Earlier';
  });
}
