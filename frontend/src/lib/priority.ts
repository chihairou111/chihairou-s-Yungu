import type { Assignment, Priority } from './types';

export const NEARLY_OVERDUE_MS = 24 * 60 * 60 * 1000;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function priorityOf(a: Assignment, now: number): Priority {
  if (a.dueAt < now || a.schoolGroup === 'Delayed') return 'overdue';
  if (a.dueAt - now <= NEARLY_OVERDUE_MS) return 'nearly';
  return 'upcoming';
}

export function groupTodo(list: Assignment[], now: number): Record<Priority, Assignment[]> {
  const groups: Record<Priority, Assignment[]> = { overdue: [], nearly: [], upcoming: [] };
  for (const a of list) {
    if (a.status === 'Submitted') continue;
    groups[priorityOf(a, now)].push(a);
  }
  for (const key of Object.keys(groups) as Priority[]) {
    groups[key].sort((x, y) => x.dueAt - y.dueAt);
  }
  return groups;
}

export function isSubmittedLate(a: Assignment): boolean {
  return a.submittedAt !== undefined && a.submittedAt > a.dueAt;
}

export function relativeDue(dueAt: number, now: number): string {
  const diff = dueAt - now;
  const abs = Math.abs(diff);
  let text: string;
  if (abs < HOUR) {
    text = `${Math.floor(abs / MIN)} min`;
  } else if (abs < DAY) {
    text = `${Math.floor(abs / HOUR)} h`;
  } else {
    const days = Math.floor(abs / DAY);
    text = `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return diff < 0 ? `${text} late` : `in ${text}`;
}
