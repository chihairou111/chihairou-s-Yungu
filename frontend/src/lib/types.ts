export type AssignmentStatus = 'To submit' | 'Submitted';
export type SchoolGroup = 'Due today' | 'Due recently' | 'Delayed' | null;

export interface Assignment {
  id: number;
  title: string;
  /** Course name as the school shows it on the assignment. */
  course: string;
  courseId: number;
  dueAt: number;
  assignedAt: number;
  status: AssignmentStatus;
  estimatedMinutes: number | null;
  schoolGroup: SchoolGroup;
  submittedAt?: number;
}

export interface ClassEvent {
  name: string;
  room: string | null;
  start: number;
  end: number;
  isClass: boolean;
  /** The course a class belongs to; null for routine items (meals, wake-up). */
  courseId: number | null;
}

export type Priority = 'overdue' | 'nearly' | 'upcoming';

export type CourseColor =
  | 'Tomato'
  | 'Flamingo'
  | 'Tangerine'
  | 'Banana'
  | 'Sage'
  | 'Basil'
  | 'Peacock'
  | 'Blueberry'
  | 'Lavender'
  | 'Grape'
  | 'Graphite';

export interface Course {
  id: number;
  name: string;
  color: CourseColor;
}
