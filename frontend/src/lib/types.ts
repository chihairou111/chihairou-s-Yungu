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
  /** A Yungu online document: its text lives on Yungu, which keeps no file to download, view or open. */
  online?: boolean;
  /** An online document's text: Yungu's Quill delta JSON string, exactly as stored (online documents only). */
  content?: string;
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

/** One rubric criterion's result in a teacher's feedback. */
export interface FeedbackCriterion {
  name: string;
  /** The level reached ("Proficient") or the criterion's own score. */
  result: string;
  /** What that level means, from the rubric. */
  description?: string;
}

/** The teacher's grade and written feedback on the student's work (Yungu's evaluation result). */
export interface Feedback {
  /** "4.5/5" for a numeric grade, the level name ("Extraordinary [5]") for a level grade; "" when there is none. */
  score: string;
  /** The teacher's written feedback; null when they wrote none. */
  comment: string | null;
  criteria: FeedbackCriterion[];
  /** When the grade was last changed (ms); null when Yungu does not say. */
  updatedAt: number | null;
}

export interface AssignmentDetail extends Assignment {
  teacher: string;
  /** Teacher-authored HTML, already sanitised with `sanitizeInstructions`. */
  instructionsHtml: string;
  /** Files the teacher attached. */
  attachments: FileRef[];
  /**
   * The student's draft: the file list as last saved (task.yungu.org's `submitAchievementForDrafts`).
   * After a submit it can be edited without handing anything in.
   */
  myFiles: FileRef[];
  /** Ids of the files handed in at the last submit or update; empty before the first. Only a submit changes it. */
  submittedFileIds: string[];
  submitted: boolean;
  /**
   * The teacher requires at least one file (Yungu's `needEnclosure`). When false, the assignment is not
   * submitted and Your work is empty, it can be marked as submitted with no files (`submit(id, [])`).
   */
  needsFiles: boolean;
  comments: Comment[];
  /** The teacher's grade and feedback; null (or absent) before grading. */
  feedback?: Feedback | null;
}

/** A Yungu notification (站内信), as the bell on task.yungu.org lists them. */
export interface Notification {
  id: string;
  title: string;
  body: string;
  /** When Yungu sent it (ms; Yungu keeps China time to the minute). */
  createdAt: number;
  read: boolean;
  /** The assignment it links to (`#/taskInfo/{taskPublishId}/…`), or null when it links elsewhere or nowhere. */
  taskId: number | null;
}

/** One page of notifications, newest first. */
export interface NotificationPage {
  items: Notification[];
  hasMore: boolean;
}
