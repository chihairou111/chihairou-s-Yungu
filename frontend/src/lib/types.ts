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

export type FileKind = 'pdf' | 'image' | 'video' | 'audio' | 'office' | 'other';

export interface FileRef {
  id: string;
  name: string;
  kind: FileKind;
  mime: string;
  size: number;
  url: string;
  /** A PDF rendition to show for files the browser cannot open itself (Office documents). */
  previewPdfUrl?: string;
  createdAt: number;
}

export interface Comment {
  id: string;
  author: string;
  /** True for comments the signed-in student wrote, which they may delete. */
  mine: boolean;
  createdAt: number;
  text: string;
}

export interface AssignmentDetail extends Assignment {
  teacher: string;
  /** Teacher-authored HTML, already sanitised with `sanitizeInstructions`. */
  instructionsHtml: string;
  /** Files the teacher attached. */
  attachments: FileRef[];
  /** The student's own files: a draft before submitting, the handed-in files after. */
  myFiles: FileRef[];
  submitted: boolean;
  comments: Comment[];
}
