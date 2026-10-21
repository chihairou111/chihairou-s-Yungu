// Months and groups for the Behaviour page, in China time (fixed UTC+8, as in ./time).
import { weekStartOf } from './time';
import type { BehaviourRecord } from './types';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const OFFSET = 8 * HOUR;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Yungu's school year starts in September. */
const SCHOOL_YEAR_START = 9;
const MONTH_PARAM = /^(\d{4})-(0[1-9]|1[0-2])$/;

const pad = (n: number) => String(n).padStart(2, '0');
const parts = (month: string) => month.split('-').map(Number) as [number, number];
const format = (year: number, mo: number) => `${year}-${pad(mo)}`;

/** The China month of an instant, as `YYYY-MM`. */
export function chinaMonth(ms: number): string {
  const d = new Date(ms + OFFSET);
  return format(d.getUTCFullYear(), d.getUTCMonth() + 1);
}

/** `month` moved by `by` months (negative = earlier). */
export function shiftMonth(month: string, by: number): string {
  const [y, mo] = parts(month);
  const index = y * 12 + (mo - 1) + by;
  return format(Math.floor(index / 12), (index % 12) + 1);
}

/** The first month the page steps back to: September of the previous school year. */
export function earliestMonth(now: number): string {
  const [y, mo] = parts(chinaMonth(now));
  const schoolYear = mo >= SCHOOL_YEAR_START ? y : y - 1;
  return format(schoolYear - 1, SCHOOL_YEAR_START);
}

/** `?month=YYYY-MM`, kept between the earliest month and this one; anything else is this month. */
export function parseMonthParam(param: string | undefined, now: number): string {
  const current = chinaMonth(now);
  if (!param || !MONTH_PARAM.test(param)) return current;
  if (param > current) return current;
  const earliest = earliestMonth(now);
  return param < earliest ? earliest : param;
}

/** "October". */
export function monthName(month: string): string {
  return MONTHS[parts(month)[1] - 1];
}

/** "October 2026". */
export function monthLabel(month: string): string {
  return `${monthName(month)} ${parts(month)[0]}`;
}

/** 00:00 China time on the 1st of `month`. */
function monthStart(month: string): number {
  const [y, mo] = parts(month);
  return Date.UTC(y, mo - 1, 1) - OFFSET;
}

/** "+2", "−17" (a real minus sign), "0". */
export function formatPoints(points: number): string {
  if (points > 0) return `+${points}`;
  if (points < 0) return `−${-points}`;
  return '0';
}

export interface RecordGroup {
  label: string;
  records: BehaviourRecord[];
}

/** "Sep 28–30" for the days of one week that fall inside the month; one day reads "Feb 1". */
function weekLabel(weekStart: number, month: string): string {
  const first = Math.max(weekStart, monthStart(month));
  const last = Math.min(weekStart + 6 * DAY, monthStart(shiftMonth(month, 1)) - DAY);
  const short = monthName(month).slice(0, 3);
  const day = (ms: number) => new Date(ms + OFFSET).getUTCDate();
  return first === last ? `${short} ${day(first)}` : `${short} ${day(first)}–${day(last)}`;
}

/**
 * The month's records, newest first, in groups: for this month "This week" and "Earlier in October";
 * for a past month one group per week (Monday to Sunday, China time), labelled with its days in the month.
 */
export function groupRecords(records: BehaviourRecord[], month: string, now: number): RecordGroup[] {
  const sorted = [...records].sort((a, b) => b.at - a.at);
  const groups: RecordGroup[] = [];
  const thisMonth = month === chinaMonth(now);
  const thisWeek = weekStartOf(now);
  for (const record of sorted) {
    const label = thisMonth
      ? record.at >= thisWeek
        ? 'This week'
        : `Earlier in ${monthName(month)}`
      : weekLabel(weekStartOf(record.at), month);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.records.push(record);
    else groups.push({ label, records: [record] });
  }
  return groups;
}
