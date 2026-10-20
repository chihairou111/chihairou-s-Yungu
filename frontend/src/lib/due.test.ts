import { describe, expect, it } from 'vitest';
import { dueLabel, dueParts, submittedGroups, upcomingGroups } from './due';
import type { Assignment } from './types';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const SUN = Date.UTC(2026, 9, 18, 9, 0); // Sun Oct 18 17:00 China
const WED = SUN - 4 * DAY; // Wed Oct 14 17:00 China
/** 22:00 China time on Oct `date` 2026. */
const oct22h = (date: number) => Date.UTC(2026, 9, date, 14, 0);

let id = 1;
const item = (title: string, dueAt: number, extra: Partial<Assignment> = {}): Assignment => ({
  id: id++,
  title,
  course: 'Product Design I',
  courseId: 10,
  dueAt,
  assignedAt: dueAt - 7 * DAY,
  status: 'To submit',
  estimatedMinutes: null,
  schoolGroup: null,
  ...extra,
});

describe('dueLabel', () => {
  it('names the China calendar day and the time', () => {
    expect(dueLabel(oct22h(18), SUN)).toBe('Due today · 22:00');
    expect(dueLabel(oct22h(19), SUN)).toBe('Due tomorrow · 22:00');
    expect(dueLabel(oct22h(22), SUN)).toBe('Due Thu, Oct 22 · 22:00');
  });

  it('drops the time once the work is late', () => {
    expect(dueLabel(SUN - DAY, SUN)).toBe('Due Sat, Oct 17');
    // Earlier today, already past: still "late", no time.
    expect(dueLabel(SUN - HOUR, SUN)).toBe('Due today');
  });

  it('splits into day and time parts', () => {
    expect(dueParts(oct22h(18), SUN)).toEqual({ day: 'Due today', time: '22:00' });
    expect(dueParts(SUN - DAY, SUN)).toEqual({ day: 'Due Sat, Oct 17', time: null });
  });
});

describe('upcomingGroups', () => {
  it('groups by Tomorrow, This week (through Sunday), Next week and Later, in due order', () => {
    const items = [
      item('Mon 26', oct22h(26)),
      item('Sat 17', oct22h(17)),
      item('Thu 15', oct22h(15)),
      item('Sun 25', oct22h(25)),
      item('Sun 18', oct22h(18)),
      item('Mon 19', oct22h(19)),
    ];
    const groups = upcomingGroups(items, WED);
    expect(groups.map((g) => [g.label, g.items.map((a) => a.title)])).toEqual([
      ['Tomorrow', ['Thu 15']],
      ['This week', ['Sat 17', 'Sun 18']],
      ['Next week', ['Mon 19', 'Sun 25']],
      ['Later', ['Mon 26']],
    ]);
  });

  it('omits empty groups, and on a Sunday tomorrow wins over next week', () => {
    const groups = upcomingGroups([item('Tue 20', oct22h(20)), item('Mon 19', oct22h(19))], SUN);
    expect(groups.map((g) => [g.label, g.items.map((a) => a.title)])).toEqual([
      ['Tomorrow', ['Mon 19']],
      ['Next week', ['Tue 20']],
    ]);
  });
});

describe('submittedGroups', () => {
  const handedIn = (title: string, submittedAt: number, dueAt = submittedAt + DAY) =>
    item(title, dueAt, { status: 'Submitted', submittedAt });

  it('groups by the week it was handed in, This week / Last week / Earlier, newest hand-in first', () => {
    const items = [
      handedIn('Oct 4', oct22h(4)),
      handedIn('Oct 12', oct22h(12)),
      handedIn('Oct 16', oct22h(16)),
      handedIn('Oct 11', oct22h(11)),
      handedIn('Oct 5', oct22h(5)),
    ];
    const groups = submittedGroups(items, SUN);
    expect(groups.map((g) => [g.label, g.items.map((a) => a.title)])).toEqual([
      ['This week', ['Oct 16', 'Oct 12']],
      ['Last week', ['Oct 11', 'Oct 5']],
      ['Earlier', ['Oct 4']],
    ]);
  });

  it('orders by hand-in time, not due date: work handed in early for a later deadline is in the week it was handed in', () => {
    const items = [
      handedIn('Due Oct 30, handed in Oct 13', oct22h(13), oct22h(30)),
      handedIn('Due Oct 10, handed in late Oct 15', oct22h(15), oct22h(10)),
      handedIn('Due Oct 9, handed in Oct 8', oct22h(8), oct22h(9)),
    ];
    const groups = submittedGroups(items, SUN);
    expect(groups.map((g) => [g.label, g.items.map((a) => a.title)])).toEqual([
      ['This week', ['Due Oct 10, handed in late Oct 15', 'Due Oct 30, handed in Oct 13']],
      ['Last week', ['Due Oct 9, handed in Oct 8']],
    ]);
  });

  it('falls back to the due date when the hand-in time is missing', () => {
    const groups = submittedGroups([handedIn('Oct 14', oct22h(14)), item('No time, due Oct 16', oct22h(16), { status: 'Submitted' })], SUN);
    expect(groups.map((g) => [g.label, g.items.map((a) => a.title)])).toEqual([['This week', ['No time, due Oct 16', 'Oct 14']]]);
  });

  it('returns no groups for no work', () => {
    expect(submittedGroups([], SUN)).toEqual([]);
  });
});
