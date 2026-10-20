import 'server-only';
import { weekStartOf } from '../time';
import type { ClassEvent } from '../types';
import type { YunguData } from './index';
import { TIMETABLE, buildCourses } from './fixtures';
import { docTooLongMessage } from '../limits';
import { AssignmentNotFound, CommentNotFound, DocumentHandedIn, DocumentTooLong, ServiceError } from './errors';
import { BLANK_CREDENTIALS_ERROR } from './messages';
import {
  findOnlineDoc,
  getDetail,
  listSubmitted,
  listTodo,
  loadFile,
  markSubmitted,
  putComment,
  removeComment,
  replaceOnlineDoc,
  setFiles,
  storeFile,
  storeOnlineDoc,
} from './store';

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

/** The service's checks on an online document, in its order (title, then size), before anything is written. Returns the trimmed title. */
function checkDoc(title: string, content: string): string {
  if (!title.trim()) throw new ServiceError(400, 'Give the document a title.');
  const tooLong = docTooLongMessage(content);
  if (tooLong) throw new DocumentTooLong(tooLong);
  return title.trim();
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
    const detail = known(id, now);
    if (fileIds.length === 0) {
      // Mark as submitted, as the service allows it: no files needed, not yet submitted, nothing in the draft.
      if (detail.needsFiles || detail.submitted || detail.myFiles.length > 0) throw new ServiceError(400, 'Add at least one file.');
      markSubmitted(id, now);
      return { submittedAt: now };
    }
    setFiles(id, fileIds, now);
    markSubmitted(id, now);
    return { submittedAt: now };
  },
  async createOnlineDoc(_id, title, content) {
    // Like the service, the assignment is not looked up: an unknown id only leaves an orphan document.
    return storeOnlineDoc(checkDoc(title, content), content, Date.now());
  },
  async updateOnlineDoc(id, fileId, title, content) {
    const name = checkDoc(title, content);
    const now = Date.now();
    const detail = known(id, now);
    if (!findOnlineDoc(fileId)) throw new AssignmentNotFound();
    if (detail.submittedFileIds.includes(fileId)) throw new DocumentHandedIn();
    return replaceOnlineDoc(fileId, name, content, now);
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
