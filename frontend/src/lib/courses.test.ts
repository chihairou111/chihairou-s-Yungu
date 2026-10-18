import { describe, expect, it } from 'vitest';
import { dueStatus, groupByCourse } from './courses';
import type { Assignment, Course } from './types';

const NOW = Date.UTC(2026, 9, 18, 9, 0); // Sun Oct 18 17:00 China (Sun 02:00 in Los Angeles)
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('dueStatus', () => {
  it('says how late overdue work is, in red', () => {
    expect(dueStatus(NOW - 2 * DAY, NOW)).toEqual({ label: '2 days late', tone: 'error' });
    expect(dueStatus(NOW - DAY - HOUR, NOW)).toEqual({ label: '1 day late', tone: 'error' });
    expect(dueStatus(NOW - 5 * HOUR, NOW)).toEqual({ label: '5 h late', tone: 'error' });
  });

  it('says "Due today" for later the same China day, in red', () => {
    expect(dueStatus(NOW + 5 * HOUR, NOW)).toEqual({ label: 'Due today', tone: 'error' }); // 22:00
    expect(dueStatus(NOW, NOW)).toEqual({ label: 'Due today', tone: 'error' });
  });

  it('says "Due tomorrow" for the next China day, in amber', () => {
    // Mon 00:30 China is still Sunday in Los Angeles: the China date must win.
    expect(dueStatus(NOW + 7.5 * HOUR, NOW)).toEqual({ label: 'Due tomorrow', tone: 'warning' });
    expect(dueStatus(NOW + DAY + 5 * HOUR, NOW)).toEqual({ label: 'Due tomorrow', tone: 'warning' });
  });

  it('gives the China date for anything later', () => {
    expect(dueStatus(NOW + 2 * DAY + 5 * HOUR, NOW)).toEqual({ label: 'Due Tue, Oct 20', tone: 'neutral' });
    expect(dueStatus(NOW + 5 * DAY + 5 * HOUR, NOW)).toEqual({ label: 'Due Fri, Oct 23', tone: 'neutral' });
  });
});

const course = (id: number, name: string): Course => ({ id, name, color: 'Peacock' });
const COURSES = [course(1, 'Chinese I'), course(2, 'Business'), course(3, 'Physics'), course(4, 'Algebra')];

let nextId = 1;
function work(courseId: number, dueOffset: number, extra: Partial<Assignment> = {}): Assignment {
  return {
    id: nextId++,
    title: `item ${nextId}`,
    course: COURSES.find((c) => c.id === courseId)?.name ?? 'Unknown',
    courseId,
    dueAt: NOW + dueOffset,
    assignedAt: NOW - 5 * DAY,
    status: 'To submit',
    estimatedMinutes: null,
    schoolGroup: null,
    ...extra,
  };
}

describe('groupByCourse', () => {
  it('lists courses with work first, ordered by their most urgent item, items most urgent first', () => {
    const late = work(3, -DAY);
    const soon = work(2, 3 * HOUR);
    const later2 = work(2, 4 * DAY);
    const later3 = work(3, 2 * DAY);
    const { withWork } = groupByCourse(COURSES, [later2, soon, later3, late], NOW);
    expect(withWork.map((g) => g.course.id)).toEqual([3, 2]);
    expect(withWork[0].items).toEqual([late, later3]);
    expect(withWork[1].items).toEqual([soon, later2]);
  });

  it('ranks school-flagged Delayed work as overdue, like the priority board', () => {
    const upcoming = work(1, 2 * DAY);
    const delayed = work(4, 3 * DAY, { schoolGroup: 'Delayed' });
    const { withWork } = groupByCourse(COURSES, [upcoming, delayed], NOW);
    expect(withWork.map((g) => g.course.id)).toEqual([4, 1]);
  });

  it('puts every course without work in noWork, in the given course order', () => {
    const { noWork } = groupByCourse(COURSES, [work(2, DAY)], NOW);
    expect(noWork.map((c) => c.id)).toEqual([1, 3, 4]);
  });

  it('ignores submitted work', () => {
    const { withWork, noWork } = groupByCourse(COURSES, [work(1, DAY, { status: 'Submitted', submittedAt: NOW })], NOW);
    expect(withWork).toEqual([]);
    expect(noWork).toHaveLength(4);
  });

  it('keeps work whose course is missing from the list instead of hiding it', () => {
    const orphan = work(99, DAY, { course: 'Robotics' });
    const { withWork } = groupByCourse(COURSES, [orphan], NOW);
    expect(withWork).toHaveLength(1);
    expect(withWork[0].course).toMatchObject({ id: 99, name: 'Robotics' });
    expect(withWork[0].items).toEqual([orphan]);
  });

  it('does not mutate its inputs', () => {
    const items = [work(2, 4 * DAY), work(2, DAY)];
    const before = items.map((a) => a.id);
    groupByCourse(COURSES, items, NOW);
    expect(items.map((a) => a.id)).toEqual(before);
  });
});
