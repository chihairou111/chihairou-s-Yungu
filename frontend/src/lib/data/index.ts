import 'server-only';
import type { Assignment, AssignmentDetail, ClassEvent, Comment, Course, FileRef } from '../types';
import { mockData } from './mock';
import { serviceData } from './service';

export { BLANK_CREDENTIALS_ERROR } from './messages';
export { AssignmentNotFound, ServiceError, SessionEnded, YunguUnavailable } from './errors';

export type SignInResult = { ok: true; displayName: string; token: string } | { ok: false; error: string };

/**
 * A stored file as `GET /api/files/<id>` serves it: the bytes themselves (the mock), or a short-lived
 * link to fetch them from (the real service: task.yungu.org's `preview_file` / `new_download_file` answer
 * with a 302 to a signed OSS URL valid for about two hours), which the route passes on as its own 302.
 */
export type StoredFile = { ref: FileRef; bytes: Uint8Array } | { redirect: string };

/**
 * The single data-access seam between the app and the Yungu backend service.
 *
 * `signIn` returns an opaque session token that the session route stores in our own cookie, and
 * `signOut` hands that token back so the service can end its session. The read methods take no
 * token argument on purpose: the HTTP implementation (`./service`) runs only on the server and reads the
 * session token itself via `cookies()` from `next/headers` (decoding it with `decodeSession`), then
 * sends it to the service, so pages and components never handle credentials or tokens.
 *
 * The service must send `courseId` on every assignment and class (null only for routine items) and
 * a Google Calendar palette name (`CourseColor`) on every course; unknown names render as Graphite.
 *
 * Files: in the real implementation every `FileRef.url` — the teacher's attachments included, not only
 * the student's uploads — must be `/api/files/<id>`. The browser never talks to task.yungu.org or OSS
 * directly: the service holds the yungu `SESSION` cookie and resolves each file to a signed OSS URL
 * server-side (`getFile` → `{ redirect }`). Fixtures may keep `/mock/*` URLs during the mock phase.
 *
 * Ownership is the real backend's job: `getFile` must only resolve files the signed-in student may see
 * (their own uploads and the attachments of their assignments), and `deleteComment` must only remove the
 * student's own comments. The mock trusts its in-memory store; the Route Handlers check only the session.
 *
 * Errors (the service implementation; the mock does not fail): a 401 throws `SessionEnded` carrying the
 * service's message, a 502 or an unreachable service `YunguUnavailable`, other statuses `ServiceError`
 * (e.g. 413 "Files up to 50 MB."), a 404 on a write `AssignmentNotFound`. Pages turn `SessionEnded` into
 * the login page and `YunguUnavailable` into a message; Route Handlers answer with the status
 * (`withServiceErrors` in `../api-auth`).
 *
 * Comments: the comment endpoints of task.yungu.org have not been captured yet (see `../api/NOTES.md`,
 * "Open items for the service phase"). Reading comments is folded into `getAssignmentDetail`
 * (`AssignmentDetail.comments`) instead of a separate `getComments`; the shapes of `addComment` and
 * `deleteComment` below are assumptions to be checked against the real requests.
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
  /**
   * A stored file by id, as bytes or a signed link to redirect to; null when unknown (or not the student's
   * to see). `preview` asks for the inline-viewing link (Yungu's `preview_file`) instead of the download.
   */
  getFile(id: string, opts?: { preview?: boolean }): Promise<StoredFile | null>;
  /** Replaces the student's file list on an assignment without submitting it. */
  saveDraft(id: number, fileIds: string[]): Promise<void>;
  /** Hands the files in (or updates an earlier hand-in); moves the task to Submitted. */
  submit(id: number, fileIds: string[]): Promise<{ submittedAt: number }>;
  /** Posts a comment as the student (assumed shape; endpoint not captured yet). */
  addComment(id: number, text: string): Promise<Comment>;
  /** Removes one of the student's own comments; anyone else's is left alone. */
  deleteComment(id: number, commentId: string): Promise<void>;
  /** Drops every cached read, so the next ones come fresh from Yungu (the refresh button). */
  refresh(): Promise<void>;
  signIn(loginId: string, password: string): Promise<SignInResult>;
  signOut(token: string): Promise<void>;
}

/** `DATA_SOURCE=service` (the default) talks to the Yungu service; Vitest and Playwright set `mock`. */
function selectData(source = process.env.DATA_SOURCE ?? 'service'): YunguData {
  if (source === 'service') return serviceData;
  if (source === 'mock') return mockData;
  throw new Error(`DATA_SOURCE must be "service" or "mock", not ${JSON.stringify(source)}`);
}

export const data: YunguData = selectData();
