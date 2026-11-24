/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pure mappers from task.yungu.org payloads to the dashboard's shapes (src/lib/types.ts), ported
 * function-for-function from api/mapping.py. The hosted version runs the Python, this one the local app:
 * both must give the same output for the same input, so read mapping.py's header for the field decisions.
 * No network, no clock reads: callers pass `nowMs` and `me`.
 *
 * Python's `or`, `if x` and `.get()` on possibly-empty values are kept as `py()` / `?? null` so that 0, "",
 * null and an absent key behave as they do there.
 */
import type {
  Assignment, AssignmentDetail, Behaviour, BehaviourKind, BehaviourRecord, ClassEvent, Comment, Course,
  CourseColor, Feedback, FeedbackCriterion, FileKind, FileRef, Notification, SchoolGroup,
} from '../types';
import { guessMime } from './mime';

type Raw = Record<string, any>;

const SCHOOL_GROUPS = ['Due today', 'Due recently', 'Delayed'];
export const PALETTE: CourseColor[] = [
  'Tomato', 'Flamingo', 'Tangerine', 'Banana', 'Sage', 'Basil', 'Peacock', 'Blueberry', 'Lavender', 'Grape', 'Graphite',
];
const ACHIEVEMENT_SUBMITTED = 4;
const TO_EDIT_STATUS_ID = 3;
const TO_EDIT_STATUS = 'To edit';
const REVISION_GROUP = 'Due update'; // returned for revision
export const ONLINE_DOCUMENT_TYPE = 'onlineDocument'; // a Yungu online document: its text lives in Yungu, no stored file

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic']);
const VIDEO = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv']);
const AUDIO = new Set(['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac']);
const OFFICE = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'pages', 'numbers', 'key']);
const OFFICE_MIME = /officedocument|msword|ms-excel|ms-powerpoint|opendocument/;
// Python's `$` also matches before a trailing newline.
const TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\n?$/;
// A notification's link to an assignment: '#/taskInfo/{taskPublishId}/…' (or the inner '#/stuTaskInfo/…').
const TASK_LINK = /#\/(?:stu)?[tT]askInfo\/(\d+)(?:[/?]|$)/;

const CST_OFFSET_MS = 8 * 3600_000;

/** Python truthiness (None, False, 0, "", [] and {} are false). */
function py(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (typeof v === 'number' && Number.isNaN(v)) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}
const isDict = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);
/** `d["key"]`: a missing key is an error (a null value is fine). */
function req(d: Raw, key: string): any {
  if (!(key in d) || d[key] === undefined) throw new Error(`missing key ${key}`);
  return d[key];
}
/** Python `str()` of a JSON scalar. */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  return String(v);
}

/** A UTC timestamp for a calendar date and time, or null when it does not exist (Python's datetime would raise). */
function utcParts(y: number, mo: number, d: number, h: number, mi: number, s: number): number | null {
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const t = new Date(0);
  t.setUTCFullYear(y, mo - 1, d);
  if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  t.setUTCHours(h, mi, s, 0);
  return t.getTime();
}

/** '2026-10-19 22:32[:19[.f]]' (China wall-clock) -> epoch ms; null if absent or malformed. */
export function chinaMs(text: unknown): number | null {
  const m = TIME.exec(typeof text === 'string' ? text : '');
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i] ?? 0));
  const frac = Number((m[7] ?? '0').slice(0, 3).padEnd(3, '0'));
  const t = utcParts(y, mo, d, h, mi, s);
  if (t === null) throw new RangeError('day is out of range for month'); // Python: ValueError
  return t - CST_OFFSET_MS + frac;
}

export const NO_DEADLINE_MS = chinaMs('2099-12-31 23:59:59')!;

// ---------------------------------------------------------------- assignments
const status = (submitted: boolean): 'Submitted' | 'To submit' => (submitted ? 'Submitted' : 'To submit');

/** A To-do row the teacher returned for revision (see Assignment.revision). */
export function isRevision(raw: Raw, group: string | null): boolean {
  return raw.doTaskStatusId === TO_EDIT_STATUS_ID || raw.doTaskStatus === TO_EDIT_STATUS || group === REVISION_GROUP;
}

/** One getAllTasks task item -> Assignment. `group` is the item's groupName. */
export function assignment(raw: Raw, group: string | null, nowMs: number): Assignment {
  const submitted = raw.doTaskStatus === 'Submitted' || raw.doTaskStatusId === ACHIEVEMENT_SUBMITTED;
  const rawDue: number | null = raw.deadlineTimeMillis ?? null;
  let due: number = rawDue as number;
  let handedIn: number | null = null;
  if (submitted) handedIn = chinaMs(raw.modifiedTime) || Math.min(rawDue !== null ? rawDue : nowMs, nowMs);
  if (rawDue === null) due = (submitted ? handedIn : NO_DEADLINE_MS) as number;
  const minutes = raw.expectFinishTime;
  const out: Assignment = {
    id: req(raw, 'taskPublishId'),
    title: req(raw, 'title'),
    course: req(raw, 'courseName'),
    courseId: req(raw, 'courseId'),
    dueAt: due,
    assignedAt: raw.publishTimeMillis || due,
    status: status(submitted),
    estimatedMinutes: py(minutes) && minutes > 0 ? minutes : null,
    schoolGroup: (group !== null && SCHOOL_GROUPS.includes(group) ? group : null) as SchoolGroup,
    revision: !submitted && isRevision(raw, group),
  };
  if (submitted) {
    let at = handedIn as number;
    // modifiedTime also moves on later comments, so `ifTimeout` (Yungu's own late flag) decides which side of
    // the deadline the hand-in time sits on: the UI shows "late" iff submittedAt > dueAt.
    if (rawDue === null) {
      // no deadline to be on either side of: dueAt is the hand-in time
    } else if (raw.ifTimeout === false && at > due) at = due;
    else if (raw.ifTimeout === true && at <= due) at = due + 1;
    out.submittedAt = at;
  }
  return out;
}

// ------------------------------------------------------------------- calendar
/** One calendar item -> ClassEvent. Classes carry a courseId; routine items (meals, wake-up) do not. */
export function classEvent(raw: Raw): ClassEvent {
  const courseId = raw.courseId || null;
  return {
    name: raw.eName || raw.name || '',
    room: raw.playground || null,
    start: req(raw, 'startTime'),
    end: req(raw, 'endTime'),
    isClass: courseId !== null,
    courseId,
  };
}

// -------------------------------------------------------------------- courses
/** currentCourses -> Course[]. Colour = palette[position % 11] in (sortNo, courseId) order, so it does not
 *  depend on the order the API happens to return. */
export function courses(rawList: Raw[]): Course[] {
  const sortNo = (c: Raw) => (c.sortNo !== null && c.sortNo !== undefined ? c.sortNo : 10 ** 9);
  const ordered = [...rawList].sort((a, b) => sortNo(a) - sortNo(b) || req(a, 'courseId') - req(b, 'courseId'));
  return ordered.map((c, i) => ({
    id: c.courseId,
    name: c.courseName || c.courseEnName || '',
    color: PALETTE[i % PALETTE.length],
  }));
}

// ---------------------------------------------------------------------- files
const extension = (name: string): string => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

function kindOf(mime: string, ext: string, yunguType: string | null): FileKind {
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (OFFICE.has(ext) || OFFICE_MIME.test(mime)) return 'office';
  if (mime.startsWith('image/') || IMAGE.has(ext)) return 'image';
  if (mime.startsWith('video/') || VIDEO.has(ext)) return 'video';
  if (mime.startsWith('audio/') || AUDIO.has(ext)) return 'audio';
  return yunguType === 'pdf' || yunguType === 'image' || yunguType === 'video' || yunguType === 'audio' ? yunguType : 'other';
}

/** A fileModelList / fileList entry -> FileRef. All bytes go through /api/files/<fileId>. */
export function fileRef(raw: Raw): FileRef {
  const name: string = raw.fileName || '';
  const fid = pyStr(req(raw, 'fileId'));
  const mime = guessMime(name) || 'application/octet-stream';
  const kind = kindOf(mime, extension(name), raw.type ?? null);
  const out: FileRef = {
    id: fid,
    name,
    kind,
    mime,
    size: raw.fileSizeByte || 0,
    url: `/api/files/${fid}`,
    createdAt: chinaMs(raw.fileCreateTime) || 0,
  };
  if (kind === 'office') out.previewPdfUrl = `/api/files/${fid}?preview=1`;
  if (raw.type === ONLINE_DOCUMENT_TYPE) {
    out.online = true;
    out.content = raw.storeMeta || raw.url || ''; // the Quill delta JSON string
  }
  return out;
}

// ------------------------------------------------------------------- comments
/** A getAchievementDetail/comment row -> Comment. `mine` is by userId: Yungu's deletePermission is false even
 *  on the student's own comments. */
export function comment(raw: Raw, me: number): Comment {
  return {
    id: pyStr(req(raw, 'feedbackId')),
    author: `${raw.userName || ''} ${raw.eName || ''}`.trim(),
    mine: raw.userId === me,
    createdAt: chinaMs(raw.feedbackTime) || 0,
    text: raw.descript || '',
  };
}

// -------------------------------------------------------------- notifications
/** Yungu's client counts true, 1, "1" and "true" as read. */
function truthy(value: unknown): boolean {
  return value === true || value === 1 || (typeof value === 'string' && ['1', 'true'].includes(value.trim().toLowerCase()));
}

// Behaviour records (messageType 11): a new record, or a tier penalty from one. Yungu links them to
// #/studentTemplate or nowhere; messageType 11 also carries 校内安排, so the template code decides.
const BEHAVIOUR_TEMPLATES = ['BEHAVIOR_RECORD', 'BEHAVIOR_TIER'];

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A messageCenter v2/page item -> Notification. English text first (title -> titleEn -> senderName in Yungu's own
 *  fallback order, English moved to the front); `taskId` only from a link to an assignment; `target` "behaviour"
 *  for a behaviour record (the Behaviour page), else null. */
export function notification(raw: Raw): Notification {
  const link = typeof raw.messageUrl === 'string' ? TASK_LINK.exec(raw.messageUrl) : null;
  return {
    id: pyStr(req(raw, 'messageId')),
    title: text(raw.titleEn) || text(raw.title) || text(raw.senderName) || '',
    body: text(raw.contentEn) || text(raw.content) || '',
    createdAt: chinaMs(raw.messageSendTime) || 0,
    read: truthy(raw.ifRead) || truthy(raw.read),
    taskId: link ? Number(link[1]) : null,
    target: BEHAVIOUR_TEMPLATES.includes(raw.templateCode) ? 'behaviour' : null,
  };
}

// --------------------------------------------------------------------- detail
/** The student's status on the task: the achievement's, else the task-level one (null if neither). */
export function achievementStatus(mixed: Raw, achievement: Raw): number | null {
  const statusId = achievement.achievementStatus ?? null;
  return statusId === null ? (mixed.doTaskStatusId ?? null) : statusId;
}

export function isSubmitted(mixed: Raw, achievement: Raw): boolean {
  return achievementStatus(mixed, achievement) === ACHIEVEMENT_SUBMITTED;
}

const fileIds = (achievement: Raw): string[] => (achievement.fileModelList || []).map((f: Raw) => pyStr(req(f, 'fileId')));

/** What the teacher has, when Yungu's own read says so: once submitted and with no draft open (`ifEditStatus`
 *  false), `fileModelList` IS the hand-in. null while a draft differs from it (`ifEditStatus` true or unknown) or
 *  before a hand-in. */
export function handInOnYungu(mixed: Raw, achievement: Raw): string[] | null {
  if (!isSubmitted(mixed, achievement) || achievement.ifEditStatus !== false) return null;
  return fileIds(achievement);
}

/** File ids with the teacher: none before a hand-in; Yungu's list when no draft is open; else the kept list (the
 *  last hand-in the service saw), or, unknown, every current file (when unsure, a file counts as handed in). */
export function handedInIds(mixed: Raw, achievement: Raw, kept: string[] | null): string[] {
  if (!isSubmitted(mixed, achievement)) return [];
  const shown = handInOnYungu(mixed, achievement);
  if (shown !== null) return shown;
  if (kept === null) return fileIds(achievement);
  return [...kept];
}

/** 'Attachment required' (needEnclosure): the achievement's flag, else the task's. Missing or null = true, so we
 *  never offer a hand-in Yungu might refuse. */
export function needsFiles(mixed: Raw, achievement: Raw): boolean {
  for (const source of [achievement, mixed]) {
    const value = source.needEnclosure ?? null;
    if (value !== null) return py(value);
  }
  return true;
}

const eq = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** One itemIndicatorResultModelList row -> {name, result, description?}, the rubric's wording first. */
function criterion(raw: Raw, rubrics: Raw[]): FeedbackCriterion {
  const rubric = rubrics.find((r) => eq(r.id, raw.indicatorId)) ?? {};
  const level: Raw = (rubric.list || []).find((i: Raw) => eq(i.id, raw.evaluationCriterionItemId)) ?? {};
  const out: FeedbackCriterion = {
    name: text(raw.indicatorEname) || text(rubric.ename) || text(raw.indicatorName) || text(rubric.name) || '',
    result: text(level.ename) || text(level.name) || text(raw.levelName) || text(raw.score) || '',
  };
  const description = text(level.descriptionEn) || text(level.description) || text(raw.description);
  if (description) out.description = description;
  return out;
}

/** The teacher's grade and written feedback -> AssignmentDetail.feedback; null before grading (or when there is
 *  nothing to show: no score, no comment, no criteria). */
export function feedback(mixed: Raw, achievement: Raw): Feedback | null {
  const evaluation: Raw = achievement.evaluationItemResultResponse || {};
  const results: any[] = evaluation.itemResultResponses || [];
  const result: Raw | null = results.length && isDict(results[0]) ? results[0] : null;
  if (result === null || (result.status !== null && result.status !== undefined && result.status !== 1)) return null; // Yungu shows a result only at status 1
  let score: string;
  if (result.scoreType === 2) {
    const level: Raw = result.criterionItemResponse || {};
    score = text(level.levelEName) || text(level.levelName) || '';
  } else {
    const points = result.score !== null && result.score !== undefined ? text(pyStr(result.score)) : null;
    const total = text(pyStr(evaluation.totalScore || mixed.totalScore || ''));
    score = points && total ? `${points}/${total}` : points || '';
  }
  const rubrics = (mixed.evaluationItemRubricsResponses || []).filter(isDict);
  const criteria = (result.itemIndicatorResultModelList || []).filter(isDict).map((c: Raw) => criterion(c, rubrics));
  const commentText = text(result.feedback);
  if (!score && !commentText && !criteria.length) return null;
  return {
    score,
    comment: commentText,
    criteria,
    updatedAt: chinaMs(result.modifyTime) || chinaMs(result.createTime),
  };
}

/** getMixedPublishDetail + getAchievementDetail + comments -> AssignmentDetail.
 *
 *  `kept`: the kept hand-in list (the last hand-in the service saw), or null when unknown; Yungu's own list wins
 *  whenever no draft is open (see handedInIds). `listed`: the mapped list Assignment for the same task, if the
 *  caller has it, which supplies schoolGroup, revision and submittedAt (the detail endpoints carry none of them).
 *  `instructionsHtml` is raw: the caller sanitises it. */
export function detail(
  mixed: Raw,
  achievement: Raw,
  comments: Raw[] | null,
  me: number,
  kept: string[] | null,
  listed: Partial<Assignment> | null = null,
): AssignmentDetail {
  const submitted = isSubmitted(mixed, achievement);
  const myFiles = (achievement.fileModelList || []).map(fileRef);
  const handedIn = handedInIds(mixed, achievement, kept);
  const minutes = mixed.useTime;
  const due: number = chinaMs(mixed.endTime) || listed?.dueAt || NO_DEADLINE_MS;
  const out: AssignmentDetail = {
    id: req(mixed, 'taskPublishId'),
    title: req(mixed, 'taskTitle'),
    course: req(mixed, 'courseName'),
    courseId: req(mixed, 'courseId'),
    dueAt: due,
    assignedAt: chinaMs(mixed.sendTime) || due,
    status: status(submitted),
    estimatedMinutes: py(minutes) && minutes > 0 ? minutes : null,
    schoolGroup: listed?.schoolGroup ?? null,
    revision: !submitted && listed?.revision === true,
    teacher: (mixed.mainTeachers || [])
      .filter((t: Raw) => py(t.userName))
      .map((t: Raw) => t.userName)
      .join(', '),
    instructionsHtml: mixed.taskContent || mixed.taskDescription || '',
    // type 'link' entries are embedded players (an <iframe> in `url`), not files /api/files can serve.
    attachments: (mixed.fileList || []).filter((f: Raw) => f.type !== 'link').map(fileRef),
    myFiles,
    submittedFileIds: handedIn,
    submitted,
    needsFiles: needsFiles(mixed, achievement),
    comments: (comments || [])
      .map((c) => comment(c, me))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    feedback: feedback(mixed, achievement),
  };
  if (py(listed) && listed!.submittedAt !== null && listed!.submittedAt !== undefined && submitted) {
    out.submittedAt = listed!.submittedAt;
  }
  return out;
}

// ------------------------------------------------------------------ behaviour
// 凌云积分 (Lingyun points) for one China calendar month; Yungu's requests and fields in NOTES.md section 11.
const MONTH = /^([0-9]{4})-(0[1-9]|1[0-2])$/;
const TIER_ID_PREFIX = 'tier-'; // tier rows number apart from records: their ids may coincide

/** '2026-10' -> ['2026-10-01', '2026-10-31']: the month's first and last China dates, as Yungu takes them.
 *  Throws for anything but YYYY-MM. */
export function monthWindow(month: unknown): [string, string] {
  const m = typeof month === 'string' ? MONTH.exec(month) : null;
  if (!m) throw new Error('month must be YYYY-MM');
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mon - 1];
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return [`${p(year, 4)}-${p(mon)}-01`, `${p(year, 4)}-${p(mon)}-${p(days)}`];
}

/** Python `float(str)`: whitespace, sign, digits with underscores, exponent, inf and nan. NaN when it is not one. */
function pyFloat(s: string): number {
  const t = s.trim();
  if (/^[+-]?(inf|infinity)$/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  const digits = '\\d+(?:_\\d+)*';
  if (!new RegExp(`^[+-]?(?:${digits}(?:\\.(?:${digits})?)?|\\.${digits})(?:[eE][+-]?${digits})?$`).test(t)) return NaN;
  return Number(t.replace(/_/g, ''));
}

/** Yungu's signed score ('+2', '-5', '-2.0', 8.0) -> 2 / -5 / -2 / 8; null if absent. */
function points(value: unknown): number | null {
  if (typeof value === 'boolean') return null;
  let v: unknown = value;
  if (typeof v === 'string') {
    v = pyFloat(v);
    if (Number.isNaN(v)) return null; // Python: float() raises, or yields nan
  }
  if (!isNum(v) || !Number.isFinite(v)) return null;
  return v === 0 ? 0 : v; // no negative zero
}

function total(t: unknown, key: string, required = false): number | null {
  const value = isDict(t) ? t[key] : null;
  if (typeof value === 'boolean' || !isNum(value)) {
    if (required) throw new Error(`stu/detail has no number for ${key}`);
    return 0;
  }
  return points(value);
}

/** '2026-10-20T06:58:22.000+00:00' (an instant; no offset = UTC) -> epoch ms. Python's `datetime.fromisoformat`
 *  (3.12: any single character may separate date and time; the compact and week-date forms are not handled). */
function utcMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[\s\S](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2}(?:\.\d+)?)?)?)?)?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i] ?? 0));
  const micro = Number((m[7] ?? '0').slice(0, 6).padEnd(6, '0'));
  const t = utcParts(y, mo, d, h, mi, s);
  if (t === null) return null;
  let offsetSec = 0;
  const z = m[8];
  if (z && z !== 'Z') {
    const parts = /^([+-])(\d{2}):?(\d{2})?:?(\d{2})?(?:\.(\d+))?$/.exec(z)!;
    const hh = Number(parts[2]);
    const mm = Number(parts[3] ?? 0);
    const ss = Number(parts[4] ?? 0);
    if (hh > 23 || mm > 59 || ss > 59) return null;
    offsetSec = (parts[1] === '-' ? -1 : 1) * (hh * 3600 + mm * 60 + ss);
  }
  const micros = (t / 1000 - offsetSec) * 1e6 + micro;
  return Math.trunc((micros / 1e6) * 1000); // Python: int(timestamp() * 1000)
}

/** A T1–T3 disciplinary tier row: a level and no points. */
function isTier(raw: Raw): boolean {
  return (raw.level ?? null) !== null && points(raw.score) === null;
}

function record(raw: Raw, at: number, revoked: boolean, pts: number | null): BehaviourRecord {
  const tier = isTier(raw);
  let kind: BehaviourKind;
  if (tier) kind = 'tier';
  else if (raw.type === 0) kind = 'bonus';
  else if (raw.type === 2) kind = 'deduction';
  else kind = (pts || 0) >= 0 ? 'bonus' : 'deduction';
  let subject: string | null = null;
  if (raw.subjectId !== -1 && raw.subjectId !== '-1') subject = text(raw.subjectEnName) || text(raw.subjectName);
  const level = raw.level;
  return {
    id: (tier ? TIER_ID_PREFIX : '') + pyStr(req(raw, 'id')),
    name: text(raw.behaviorTypeName) || text(raw.behaviorTypeEnName) || '',
    points: tier ? null : pts,
    level: tier && Number.isInteger(level) ? level : null,
    kind,
    at,
    subject,
    recorder: text(raw.creatorEnName) || text(raw.creatorName) || text(raw.recordActorEnName) || text(raw.recordActorName),
    remark: text(raw.desc),
    revoked,
  };
}

/** The China calendar date (YYYY-MM-DD) of an instant. */
function chinaDay(at: number): string {
  const d = new Date(at + CST_OFFSET_MS);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** stu/detail's row + every allStu/behavior row of the month -> Behaviour.
 *
 *  The number and the chip totals are Yungu's (`score`, `positiveScore`, `negativeScore`), never a sum of rows.
 *  Rows: each id once (pages can repeat rows); a revoked record is one row, `revoked`, at the original's time with
 *  the original's points (Yungu lists the original plus a revocation row with the same id, `revoke: true`, the
 *  opposite sign and the revocation's time; either half may fall in another month, and an original whose
 *  revocation is elsewhere still carries `revokeIcon: true`). Times come from `recordTime` (UTC); a row whose
 *  China date is outside the month is dropped. Counts: records per side that count (not revoked, not tiers).
 *  Newest first; ties keep Yungu's order. */
export function behaviour(month: string, totals: Raw, rows: any[] | null): Behaviour {
  const [first, last] = monthWindow(month);
  const score = total(totals, 'score', true) as number;
  const originals = new Map<string, [Raw, number]>();
  const revocations = new Map<string, [Raw, number]>();
  const order = new Set<string>(); // first sighting of each key
  for (const raw of rows || []) {
    if (!isDict(raw) || raw.id === null || raw.id === undefined) continue;
    const at = utcMs(raw.recordTime) || utcMs(raw.sortTime) || utcMs(raw.createDate);
    if (at === null) continue;
    const day = chinaDay(at);
    if (!(first <= day && day <= last)) continue;
    const kind = isTier(raw) ? 'tier' : 'record';
    const key = `${kind}\u0000${pyStr(raw.id)}`;
    const bucket = raw.revoke === true && kind === 'record' ? revocations : originals;
    if (bucket.has(key)) continue;
    bucket.set(key, [raw, at]);
    order.add(key);
  }
  const records: BehaviourRecord[] = [];
  for (const key of order) {
    if (originals.has(key)) {
      const [raw, at] = originals.get(key)!;
      const revoked = revocations.has(key) || raw.revokeIcon === true || raw.revoke === true;
      records.push(record(raw, at, revoked, points(raw.score)));
    } else {
      const [raw, at] = revocations.get(key)!;
      const p = points(raw.score);
      records.push(record(raw, at, true, p !== null ? 0 - p : null));
    }
  }
  records.sort((a, b) => b.at - a.at);
  const counted = records.filter((r) => !r.revoked);
  return {
    month,
    score,
    bonus: total(totals, 'positiveScore') as number,
    deduction: total(totals, 'negativeScore') as number,
    bonusCount: counted.filter((r) => r.kind === 'bonus').length,
    deductionCount: counted.filter((r) => r.kind === 'deduction').length,
    records,
  };
}
