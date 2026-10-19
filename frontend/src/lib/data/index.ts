import 'server-only';
import type { Assignment, AssignmentDetail, ClassEvent, Comment, Course, FileRef } from '../types';
import { mockData } from './mock';

export { BLANK_CREDENTIALS_ERROR } from './messages';

export type SignInResult = { ok: true; displayName: string; token: string } | { ok: false; error: string };

/**
 * The single data-access seam between the app and the Yungu backend service.
 *
 * `signIn` returns an opaque session token that the session route stores in our own cookie, and
 * `signOut` hands that token back so the service can end its session. The read methods take no
 * token argument on purpose: the later HTTP implementation runs only on the server and reads the
 * session token itself via `cookies()` from `next/headers` (decoding it with `decodeSession`), then
 * sends it to the service, so pages and components never handle credentials or tokens.
 *
 * The service must send `courseId` on every assignment and class (null only for routine items) and
 * a Google Calendar palette name (`CourseColor`) on every course; unknown names render as Graphite.
 */
export interface YunguData {
  getTodo(): Promise<Assignment[]>;
  getSubmitted(): Promise<Assignment[]>;
  getWeek(weekStart: number): Promise<ClassEvent[]>;
  /** Every course the student takes, each with its display color. */
  getCourses(): Promise<Course[]>;
  /** Everything the assignment pop-up shows; null when the id is unknown. */
  getAssignmentDetail(id: number): Promise<AssignmentDetail | null>;
  /** Stores a student's file and returns its reference; the file is not part of any assignment until saved or submitted. */
  uploadFile(name: string, mime: string, bytes: Uint8Array): Promise<FileRef>;
  getFile(id: string): Promise<{ ref: FileRef; bytes: Uint8Array } | null>;
  /** Replaces the student's file list on an assignment without submitting it. */
  saveDraft(id: number, fileIds: string[]): Promise<void>;
  /** Hands the files in (or updates an earlier hand-in); moves the task to Submitted. */
  submit(id: number, fileIds: string[]): Promise<{ submittedAt: number }>;
  addComment(id: number, text: string): Promise<Comment>;
  /** Removes one of the student's own comments; anyone else's is left alone. */
  deleteComment(id: number, commentId: string): Promise<void>;
  signIn(loginId: string, password: string): Promise<SignInResult>;
  signOut(token: string): Promise<void>;
}

// Swap this for the real Yungu-backed implementation in a later phase.
export const data: YunguData = mockData;
