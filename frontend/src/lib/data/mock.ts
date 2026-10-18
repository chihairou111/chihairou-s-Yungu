import { weekStartOf } from '../time';
import type { ClassEvent } from '../types';
import type { YunguData } from './index';
import { TIMETABLE, buildSubmitted, buildTodo } from './fixtures';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const BLANK_ERROR = 'Enter your student ID and password.';
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
  async getWeek(weekStart) {
    const monday = weekStartOf(weekStart);
    const events: ClassEvent[] = TIMETABLE.map((slot) => ({
      name: slot.name,
      room: slot.room,
      start: monday + slot.weekday * DAY + clockToMs(slot.start),
      end: monday + slot.weekday * DAY + clockToMs(slot.end),
      isClass: slot.isClass,
    }));
    return events.sort((a, b) => a.start - b.start);
  },
  async signIn(loginId, password) {
    if (!loginId.trim() || !password.trim()) return { ok: false, error: BLANK_ERROR };
    return { ok: true, displayName: MOCK_DISPLAY_NAME };
  },
};
