import { describe, expect, it } from 'vitest';
import { NEARLY_OVERDUE_MS, groupTodo, isSubmittedLate, priorityOf } from '../priority';
import { chinaClock, dayIndex, weekStartOf } from '../time';
import { buildSubmitted, buildTodo } from './fixtures';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MIDNIGHT_CHINA = Date.UTC(2026, 9, 18, 16, 0); // Mon Oct 19 00:00 China

/** China-time calendar day number of `ms` (days since the epoch, China wall clock). */
const chinaDay = (ms: number) => Math.floor((ms + 8 * HOUR) / DAY);

// Every quarter hour across a China day, plus the instants either side of the 22:00 cut-over.
const NOWS = [
  ...Array.from({ length: 96 }, (_, i) => MIDNIGHT_CHINA + i * 15 * MIN),
  MIDNIGHT_CHINA + 22 * HOUR - 1,
  MIDNIGHT_CHINA + 22 * HOUR,
  MIDNIGHT_CHINA + 22 * HOUR + 1,
];

const byId = (now: number) => new Map(buildTodo(now).map((a) => [a.id, a]));

describe('mock fixtures', () => {
  it('puts every due time at 22:00 China time', () => {
    for (const now of NOWS) {
      for (const a of [...buildTodo(now), ...buildSubmitted(now)]) {
        expect(chinaClock(a.dueAt), `id ${a.id} at now=${now}`).toBe('22:00');
      }
    }
  });

  it('keeps the nearly-overdue item in the future and within the threshold at any time of day', () => {
    for (const now of NOWS) {
      const nearly = byId(now).get(102)!;
      expect(nearly.dueAt, `now=${now}`).toBeGreaterThan(now);
      expect(nearly.dueAt - now, `now=${now}`).toBeLessThanOrEqual(NEARLY_OVERDUE_MS);
      expect(priorityOf(nearly, now)).toBe('nearly');
    }
  });

  it("uses today's 22:00 while it is still ahead, otherwise tomorrow's", () => {
    const morning = MIDNIGHT_CHINA + 9 * HOUR;
    expect(byId(morning).get(102)!.dueAt).toBe(MIDNIGHT_CHINA + 22 * HOUR);
    const lateNight = MIDNIGHT_CHINA + 23 * HOUR;
    expect(byId(lateNight).get(102)!.dueAt).toBe(MIDNIGHT_CHINA + DAY + 22 * HOUR);
  });

  it('keeps the overdue item two China days back and upcoming items several days out', () => {
    for (const now of NOWS) {
      const items = byId(now);
      expect(chinaDay(items.get(101)!.dueAt)).toBe(chinaDay(now) - 2);
      expect(chinaDay(items.get(104)!.dueAt)).toBe(chinaDay(now) + 3);
      expect(chinaDay(items.get(103)!.dueAt)).toBe(chinaDay(now) + 5);
      expect(chinaDay(items.get(105)!.dueAt)).toBe(chinaDay(now) + 4);
      const groups = groupTodo(buildTodo(now), now);
      expect(groups.overdue.map((a) => a.id)).toEqual([101]);
      expect(groups.nearly.map((a) => a.id)).toEqual([106, 102]);
      expect(groups.upcoming.map((a) => a.id).sort()).toEqual([103, 104, 105]);
    }
  });

  it('has one item returned for revision, its original deadline days past, filed under nearly', () => {
    for (const now of NOWS) {
      const returned = buildTodo(now).filter((a) => a.revision);
      expect(returned.map((a) => a.id)).toEqual([106]);
      expect(chinaDay(returned[0].dueAt)).toBe(chinaDay(now) - 8);
      expect(priorityOf(returned[0], now)).toBe('nearly');
    }
  });

  it('keeps submitted items in the past with at least one late', () => {
    for (const now of NOWS) {
      const done = buildSubmitted(now);
      expect(done.every((a) => a.dueAt < now && a.submittedAt! < now)).toBe(true);
      expect(done.some(isSubmittedLate)).toBe(true);
      expect(done.filter(isSubmittedLate).map((a) => a.id)).toEqual([201]);
    }
  });

  it('is independent of the week boundary', () => {
    const sundayNight = weekStartOf(MIDNIGHT_CHINA) + 6 * DAY + 23 * HOUR;
    expect(dayIndex(sundayNight, weekStartOf(sundayNight))).toBe(6);
    const nearly = byId(sundayNight).get(102)!;
    expect(nearly.dueAt).toBe(weekStartOf(sundayNight) + 7 * DAY + 22 * HOUR);
  });
});
