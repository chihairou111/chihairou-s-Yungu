import type { Assignment } from '@/lib/types';

export const NOW = Date.UTC(2026, 9, 18, 9, 0); // Sun Oct 18 17:00 China
export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

let nextId = 1;

/** A to-do assignment due `offsetMs` from NOW. */
export function todo(title: string, offsetMs: number, extra: Partial<Assignment> = {}): Assignment {
  return {
    id: nextId++,
    title,
    course: 'Product Design I',
    courseId: 10,
    dueAt: NOW + offsetMs,
    assignedAt: NOW - 7 * DAY,
    status: 'To submit',
    estimatedMinutes: 30,
    schoolGroup: null,
    ...extra,
  };
}

/** A submitted assignment due `offsetMs` from NOW, handed in `submittedOffsetMs` after its due time. */
export function submitted(title: string, offsetMs: number, submittedOffsetMs = -HOUR): Assignment {
  return todo(title, offsetMs, { status: 'Submitted', submittedAt: NOW + offsetMs + submittedOffsetMs });
}
