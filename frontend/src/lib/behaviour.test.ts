import { describe, expect, it } from 'vitest';
import {
  chinaMonth,
  earliestMonth,
  formatPoints,
  groupRecords,
  monthLabel,
  monthName,
  parseMonthParam,
  shiftMonth,
} from './behaviour';
import type { BehaviourRecord } from './types';

/** China wall clock (UTC+8) to ms. */
const china = (y: number, mo: number, d: number, h = 12, mi = 0) => Date.UTC(y, mo - 1, d, h - 8, mi);
const NOW = china(2026, 10, 21, 9, 30); // Wed Oct 21, 09:30 China

const rec = (id: string, at: number, extra: Partial<BehaviourRecord> = {}): BehaviourRecord => ({
  id,
  name: `行为 ${id}`,
  points: 2,
  level: null,
  kind: 'bonus',
  at,
  subject: null,
  recorder: 'Teacher 1',
  remark: null,
  revoked: false,
  ...extra,
});

describe('months in China time', () => {
  it('names the China month of an instant, not the host one', () => {
    expect(chinaMonth(china(2026, 9, 30, 23, 30))).toBe('2026-09');
    expect(chinaMonth(china(2026, 10, 1, 0, 30))).toBe('2026-10'); // still Sep 30 in UTC
  });

  it('labels a month', () => {
    expect(monthName('2026-10')).toBe('October');
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(monthLabel('2027-01')).toBe('January 2027');
  });

  it('steps months across years', () => {
    expect(shiftMonth('2026-10', -1)).toBe('2026-09');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });

  it('goes back to the start of the previous school year (September), never further', () => {
    expect(earliestMonth(NOW)).toBe('2025-09');
    expect(earliestMonth(china(2027, 3, 1))).toBe('2025-09');
    expect(earliestMonth(china(2027, 9, 1))).toBe('2026-09');
    expect(earliestMonth(china(2026, 8, 31, 23, 59))).toBe('2024-09');
  });

  it('reads ?month, falling back to this month and keeping to the allowed range', () => {
    expect(parseMonthParam('2026-09', NOW)).toBe('2026-09');
    expect(parseMonthParam(undefined, NOW)).toBe('2026-10');
    for (const bad of ['', '2026-13', '2026-00', '2026-1', '2026-10-01', 'October', '２026-10']) {
      expect(parseMonthParam(bad, NOW)).toBe('2026-10');
    }
    expect(parseMonthParam('2026-11', NOW)).toBe('2026-10'); // the future: this month
    expect(parseMonthParam('2024-05', NOW)).toBe('2025-09'); // too old: the earliest
  });
});

describe('formatPoints', () => {
  it('signs points with a real minus', () => {
    expect(formatPoints(2)).toBe('+2');
    expect(formatPoints(-17)).toBe('−17');
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(0.5)).toBe('+0.5');
  });
});

describe('groupRecords', () => {
  it('this month: This week, then Earlier in October, newest first', () => {
    const records = [
      rec('a', china(2026, 10, 21, 7, 33)),
      rec('b', china(2026, 10, 19, 0, 5)), // Monday 00:05: this week
      rec('c', china(2026, 10, 18, 23, 50)), // Sunday: earlier
      rec('d', china(2026, 10, 2)),
    ];
    const groups = groupRecords([...records].reverse(), '2026-10', NOW);
    expect(groups.map((g) => [g.label, g.records.map((r) => r.id)])).toEqual([
      ['This week', ['a', 'b']],
      ['Earlier in October', ['c', 'd']],
    ]);
  });

  it('this month with nothing this week: only Earlier', () => {
    const groups = groupRecords([rec('d', china(2026, 10, 2))], '2026-10', NOW);
    expect(groups.map((g) => g.label)).toEqual(['Earlier in October']);
  });

  it('a past month: one group per week, each range kept inside the month', () => {
    const records = [
      rec('a', china(2026, 9, 30, 20)),
      rec('b', china(2026, 9, 28, 8)),
      rec('c', china(2026, 9, 15)),
      rec('d', china(2026, 9, 1, 0, 10)),
    ];
    const groups = groupRecords(records, '2026-09', NOW);
    expect(groups.map((g) => [g.label, g.records.map((r) => r.id)])).toEqual([
      ['Sep 28–30', ['a', 'b']],
      ['Sep 14–20', ['c']],
      ['Sep 1–6', ['d']],
    ]);
  });

  it('a single-day remainder of a week reads as that day', () => {
    // Feb 2026 starts on a Sunday.
    expect(groupRecords([rec('a', china(2026, 2, 1))], '2026-02', NOW)[0].label).toBe('Feb 1');
  });

  it('nothing: no groups', () => {
    expect(groupRecords([], '2026-10', NOW)).toEqual([]);
  });
});
