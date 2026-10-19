import 'server-only';
import { weekStartOf } from '../time';
import type { ClassEvent } from '../types';
import type { YunguData } from './index';
import { TIMETABLE, buildCourses } from './fixtures';
import { AssignmentNotFound, CommentNotFound } from './errors';
import { BLANK_CREDENTIALS_ERROR } from './messages';
import { getDetail, listSubmitted, listTodo, loadFile, markSubmitted, putComment, removeComment, setFiles, storeFile } from './store';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const MOCK_DISPLAY_NAME = 'Bruce Zheng';

/** Writes on an id the fixtures do not hold fail as the service's do (its 404 becomes AssignmentNotFound). */
function known(id: number, now: number) {
  const detail = getDetail(id, now);
  if (!detail) throw new AssignmentNotFound();
  return detail;
}

/** "HH:MM" China wall-clock to ms since midnight. */
function clockToMs(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * HOUR + m * MIN;
}

export const mockData: YunguData = {
  async getTodo() {
    return listTodo(Date.now());
  },
  async getSubmitted() {
    return listSubmitted(Date.now());
  },
  async getCourses() {
    return buildCourses();
  },
  async getWeek(weekStart) {
    const monday = weekStartOf(weekStart);
    const events: ClassEvent[] = TIMETABLE.map((slot) => ({
      name: slot.name,
      room: slot.room,
      start: monday + slot.weekday * DAY + clockToMs(slot.start),
      end: monday + slot.weekday * DAY + clockToMs(slot.end),
      isClass: slot.isClass,
      courseId: slot.courseId,
    }));
    return events.sort((a, b) => a.start - b.start);
  },
  async getAssignmentDetail(id) {
    return getDetail(id, Date.now());
  },
  async uploadFile(name, mime, bytes) {
    return storeFile(name, mime, bytes, Date.now());
  },
  async getFile(id) {
    // The mock keeps bytes, which serve both downloading and viewing, so `preview` changes nothing.
    return loadFile(id);
  },
  async saveDraft(id, fileIds) {
    const now = Date.now();
    known(id, now);
    setFiles(id, fileIds, now);
  },
  async submit(id, fileIds) {
    const now = Date.now();
    known(id, now);
    setFiles(id, fileIds, now);
    markSubmitted(id, now);
    return { submittedAt: now };
  },
  async addComment(id, text) {
    const now = Date.now();
    known(id, now);
    return putComment(id, text, now)!;
  },
  async deleteComment(id, commentId) {
    const now = Date.now();
    if (!known(id, now).comments.some((c) => c.id === commentId && c.mine)) throw new CommentNotFound();
    removeComment(id, commentId, now);
  },
  async refresh() {
    // Nothing is cached: every read is already fresh.
  },
  async signIn(loginId, password) {
    if (!loginId.trim() || !password.trim()) return { ok: false, error: BLANK_CREDENTIALS_ERROR };
    return { ok: true, displayName: MOCK_DISPLAY_NAME, token: crypto.randomUUID() };
  },
  async signOut() {
    // The mock keeps no server-side sessions, so there is nothing to revoke.
  },
};
