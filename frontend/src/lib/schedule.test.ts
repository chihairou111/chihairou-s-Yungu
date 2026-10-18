import { describe, expect, it } from 'vitest';
import { todaysClasses } from './schedule';
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
