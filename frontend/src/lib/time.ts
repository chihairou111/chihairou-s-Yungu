// All helpers use a fixed UTC+8 offset (China has no DST); the host time zone is never consulted.
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const OFFSET = 8 * HOUR;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A Date whose UTC fields are the China wall-clock fields of `ms`. */
function chinaFields(ms: number): Date {
  return new Date(ms + OFFSET);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function chinaClock(ms: number): string {
  const d = chinaFields(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function chinaDateLabel(ms: number): string {
  const d = chinaFields(ms);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** "Oct 16, 22:00" in China time. */
export function chinaDueLabel(ms: number): string {
  const d = chinaFields(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${chinaClock(ms)}`;
}

/** "Fri, Oct 23" in China time. */
export function chinaShortDate(ms: number): string {
  const d = chinaFields(ms);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** China calendar day number (days since the epoch on the China wall clock); differences count date changes. */
export function chinaDayNumber(ms: number): number {
  return Math.floor((ms + OFFSET) / DAY);
}

/** Monday 00:00 China time of the week containing `ms`. */
export function weekStartOf(ms: number): number {
  const shifted = ms + OFFSET;
  const dayStart = Math.floor(shifted / DAY) * DAY;
  const sinceMonday = (new Date(dayStart).getUTCDay() + 6) % 7;
  return dayStart - sinceMonday * DAY - OFFSET;
}

export function shiftWeek(weekStart: number, weeks: number): number {
  return weekStart + weeks * 7 * DAY;
}

export function parseWeekParam(param: string | undefined, now: number): number {
  const m = param ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(param) : null;
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const utc = new Date(Date.UTC(y, mo - 1, d));
    if (utc.getUTCFullYear() === y && utc.getUTCMonth() === mo - 1 && utc.getUTCDate() === d) {
      return weekStartOf(utc.getTime() - OFFSET);
    }
  }
  return weekStartOf(now);
}

export function formatWeekParam(weekStart: number): string {
  const d = chinaFields(weekStart);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** "Oct 19 – 23, 2026" for the first `days` days of the week (7 = the whole week). */
export function weekRangeLabel(weekStart: number, days = 7): string {
  const s = chinaFields(weekStart);
  const e = chinaFields(weekStart + (days - 1) * DAY);
  const sy = s.getUTCFullYear();
  const ey = e.getUTCFullYear();
  const sm = MONTHS[s.getUTCMonth()];
  const em = MONTHS[e.getUTCMonth()];
  if (sy !== ey) return `${sm} ${s.getUTCDate()}, ${sy} – ${em} ${e.getUTCDate()}, ${ey}`;
  if (s.getUTCMonth() !== e.getUTCMonth()) return `${sm} ${s.getUTCDate()} – ${em} ${e.getUTCDate()}, ${ey}`;
  return `${sm} ${s.getUTCDate()} – ${e.getUTCDate()}, ${ey}`;
}

/** 0 = Monday ... 6 = Sunday, in China time relative to `weekStart`. */
export function dayIndex(ms: number, weekStart: number): number {
  return Math.floor((ms - weekStart) / DAY);
}

/** Compact range for narrow screens: "Oct 19–25", "Oct 26–Nov 1", "Dec 28–Jan 3". */
export function weekRangeShortLabel(weekStart: number, days = 7): string {
  const s = chinaFields(weekStart);
  const e = chinaFields(weekStart + (days - 1) * DAY);
  const sm = MONTHS[s.getUTCMonth()];
  const em = MONTHS[e.getUTCMonth()];
  return sm === em ? `${sm} ${s.getUTCDate()}–${e.getUTCDate()}` : `${sm} ${s.getUTCDate()}–${em} ${e.getUTCDate()}`;
}

/** "Oct 16" in China time. */
export function chinaMonthDay(ms: number): string {
  const d = chinaFields(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "2026-10-19 14.03.09" in China time, for file names (dots, not colons, which some systems refuse). */
export function chinaFileStamp(ms: number): string {
  const d = chinaFields(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `${date} ${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())}.${pad(d.getUTCSeconds())}`;
}

/** How long ago `ms` was, in China time: "just now", "5 min ago", "Today 14:05", "Yesterday 21:30", "Oct 16, 22:00". */
export function chinaRelativeTime(ms: number, now: number): string {
  const diff = now - ms;
  if (diff < 60_000) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / 60_000)} min ago`;
  const days = chinaDayNumber(now) - chinaDayNumber(ms);
  if (days <= 0) return `Today ${chinaClock(ms)}`;
  if (days === 1) return `Yesterday ${chinaClock(ms)}`;
  return chinaDueLabel(ms);
}
