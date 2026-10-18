import { describe, expect, it } from 'vitest';
import type { Assignment, ClassEvent } from './types';

describe('shared types', () => {
  it('accepts well-formed Assignment and ClassEvent literals', () => {
    const a: Assignment = {
      id: 1,
      title: 'Essay',
      course: 'English',
      courseId: 7,
      dueAt: 2,
      assignedAt: 1,
      status: 'To submit',
      estimatedMinutes: null,
      schoolGroup: null,
    };
    const e: ClassEvent = { name: 'Math', room: null, start: 0, end: 1, isClass: true, courseId: 7 };
    expect(a.status).toBe('To submit');
    expect(e.isClass).toBe(true);
  });
});
