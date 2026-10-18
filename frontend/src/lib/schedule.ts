import { dayIndex, weekStartOf } from './time';
import type { ClassEvent } from './types';

/** Classes (not routine items) on the China-time day containing `now`, sorted by start time. */
export function todaysClasses(events: ClassEvent[], now: number): ClassEvent[] {
  const weekStart = weekStartOf(now);
  const today = dayIndex(now, weekStart);
  return events
    .filter((e) => e.isClass && e.start >= weekStart && dayIndex(e.start, weekStart) === today)
    .sort((a, b) => a.start - b.start);
}
