import 'server-only';
import { weekStartOf } from '../time';
import type { ClassEvent } from '../types';
import type { YunguData } from './index';
import { TIMETABLE, buildCourses, buildSubmitted, buildTodo } from './fixtures';
import { BLANK_CREDENTIALS_ERROR } from './messages';

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
    return buildTodo(Date.now());
  },
  async getSubmitted() {
    return buildSubmitted(Date.now());
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
  async signIn(loginId, password) {
    if (!loginId.trim() || !password.trim()) return { ok: false, error: BLANK_CREDENTIALS_ERROR };
    return { ok: true, displayName: MOCK_DISPLAY_NAME, token: crypto.randomUUID() };
  },
  async signOut() {
    // The mock keeps no server-side sessions, so there is nothing to revoke.
  },
};
