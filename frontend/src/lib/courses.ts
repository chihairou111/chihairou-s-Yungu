import { priorityOf, relativeDue } from './priority';
import { chinaDayNumber, chinaShortDate } from './time';
import type { Assignment, Course, Priority } from './types';

const RANK: Record<Priority, number> = { overdue: 0, nearly: 1, upcoming: 2 };

export type DueTone = 'error' | 'warning' | 'neutral';

/**
 * Classroom-style due line for a to-do item, by China calendar date:
 * "2 days late" / "Due today" (red), "Due tomorrow" (amber), else "Due Fri, Oct 23".
 */
export function dueStatus(dueAt: number, now: number): { label: string; tone: DueTone } {
  if (dueAt < now) return { label: relativeDue(dueAt, now), tone: 'error' };
  const days = chinaDayNumber(dueAt) - chinaDayNumber(now);
  if (days === 0) return { label: 'Due today', tone: 'error' };
  if (days === 1) return { label: 'Due tomorrow', tone: 'warning' };
  return { label: `Due ${chinaShortDate(dueAt)}`, tone: 'neutral' };
}

export interface CourseWork {
  course: Course;
  /** Unsubmitted work, most urgent first. */
  items: Assignment[];
}

/**
 * Splits courses into those with unsubmitted work (ordered by their most urgent item) and the
 * rest (in the given order). Work for a course missing from `courses` still shows, under its own name.
 */
export function groupByCourse(courses: Course[], todo: Assignment[], now: number): { withWork: CourseWork[]; noWork: Course[] } {
  const byId = new Map<number, CourseWork>();
  // Most urgent first: priority (as on the board), then due time.
  const pending = todo
    .filter((a) => a.status !== 'Submitted')
    .sort((a, b) => RANK[priorityOf(a, now)] - RANK[priorityOf(b, now)] || a.dueAt - b.dueAt);
  for (const a of pending) {
    let group = byId.get(a.courseId);
    if (!group) {
      const course = courses.find((c) => c.id === a.courseId) ?? { id: a.courseId, name: a.course, color: 'Graphite' };
      group = { course, items: [] };
      byId.set(a.courseId, group);
    }
    group.items.push(a);
  }
  // Map insertion order follows the sorted items, so groups are already most-urgent first.
  return { withWork: [...byId.values()], noWork: courses.filter((c) => !byId.has(c.id)) };
}
