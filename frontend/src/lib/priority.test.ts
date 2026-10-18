import { describe, expect, it } from 'vitest';
import { groupTodo, isSubmittedLate, priorityOf, relativeDue } from './priority';
import type { Assignment } from './types';

const now = Date.UTC(2026, 9, 18, 9, 0);
const H = 3600_000;
const D = 24 * H;
const MIN = 60_000;

function make(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 1,
    title: 'T',
    course: 'C',
    courseId: 1,
    dueAt: now + 3 * D,
    assignedAt: now - D,
    status: 'To submit',
    estimatedMinutes: null,
    schoolGroup: null,
    ...over,
  };
}

describe('priorityOf', () => {
  it('overdue when due in the past', () => {
    expect(priorityOf(make({ dueAt: now - 2 * D }), now)).toBe('overdue');
  });
  it('overdue when school marks Delayed even if due tomorrow', () => {
    expect(priorityOf(make({ schoolGroup: 'Delayed', dueAt: now + D }), now)).toBe('overdue');
  });
  it('nearly when due in 5 h', () => {
    expect(priorityOf(make({ dueAt: now + 5 * H }), now)).toBe('nearly');
  });
  it('nearly at exactly 24 h', () => {
    expect(priorityOf(make({ dueAt: now + D }), now)).toBe('nearly');
  });
  it('upcoming at 24 h + 1 min', () => {
    expect(priorityOf(make({ dueAt: now + D + MIN }), now)).toBe('upcoming');
  });
});

describe('groupTodo', () => {
  it('excludes Submitted items', () => {
    const g = groupTodo([make({ status: 'Submitted', dueAt: now - D })], now);
    expect(g).toEqual({ overdue: [], nearly: [], upcoming: [] });
  });
  it('sorts each group by dueAt ascending', () => {
    const a = make({ id: 1, dueAt: now + 5 * D });
    const b = make({ id: 2, dueAt: now + 2 * D });
    const c = make({ id: 3, dueAt: now + 3 * D });
    expect(groupTodo([a, b, c], now).upcoming.map((x) => x.id)).toEqual([2, 3, 1]);
  });
});

describe('isSubmittedLate', () => {
  it('true when submitted after due', () => {
    expect(isSubmittedLate(make({ dueAt: now, submittedAt: now + 1 }))).toBe(true);
  });
  it('false when on time', () => {
    expect(isSubmittedLate(make({ dueAt: now, submittedAt: now }))).toBe(false);
  });
  it('false without submittedAt', () => {
    expect(isSubmittedLate(make())).toBe(false);
  });
});

describe('relativeDue', () => {
  it.each([
    [-(2 * D + 3 * H), '2 days late'],
    [-D, '1 day late'],
    [-3 * H, '3 h late'],
    [5 * H, 'in 5 h'],
    [40 * MIN, 'in 40 min'],
    [5 * D + 2 * H, 'in 5 days'],
    [D, 'in 1 day'],
  ])('offset %i -> %s', (offset, expected) => {
    expect(relativeDue(now + offset, now)).toBe(expected);
  });
});
