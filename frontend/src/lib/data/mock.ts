import 'server-only';
import { weekStartOf } from '../time';
import type { ClassEvent } from '../types';
import type { YunguData } from './index';
import { TIMETABLE, buildCourses } from './fixtures';
import { BLANK_CREDENTIALS_ERROR } from './messages';
import { getDetail, listSubmitted, listTodo, loadFile, markSubmitted, putComment, removeComment, setFiles, storeFile } from './store';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const MOCK_DISPLAY_NAME = 'Bruce Zheng';

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
    setFiles(id, fileIds, Date.now());
  },
  async submit(id, fileIds) {
    const now = Date.now();
    if (!setFiles(id, fileIds, now)) throw new Error(`Unknown assignment ${id}`);
    markSubmitted(id, now);
    return { submittedAt: now };
  },
  async addComment(id, text) {
    const c = putComment(id, text, Date.now());
    if (!c) throw new Error(`Unknown assignment ${id}`);
    return c;
  },
  async deleteComment(id, commentId) {
    removeComment(id, commentId, Date.now());
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
