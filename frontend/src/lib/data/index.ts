import 'server-only';
import type { Assignment, ClassEvent, Course } from '../types';
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
 */
export interface YunguData {
  getTodo(): Promise<Assignment[]>;
  getSubmitted(): Promise<Assignment[]>;
  getWeek(weekStart: number): Promise<ClassEvent[]>;
  /** Every course the student takes, each with its display color. */
  getCourses(): Promise<Course[]>;
  signIn(loginId: string, password: string): Promise<SignInResult>;
  signOut(token: string): Promise<void>;
}

// Swap this for the real Yungu-backed implementation in a later phase.
export const data: YunguData = mockData;
