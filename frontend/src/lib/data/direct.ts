/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only';
import { cookies, headers } from 'next/headers';
import { chinaMonth } from '../behaviour';
import { docTooLongMessage } from '../limits';
import { sanitizeInstructions } from '../sanitize';
import { SESSION_COOKIE, decodeSession } from '../session-cookie';
import { weekStartOf } from '../time';
import type { Assignment, AssignmentDetail, FileRef } from '../types';
import { LocalAccount, SessionExpired, SignInRefused, WRONG_LOGIN, asServiceError, errorCode, isLoginUrl } from '../yungu/account';
import { connectBridge, type ParentPort } from '../yungu/bridge';
import { ACHIEVEMENT_NOT_SUBMITTED, ACHIEVEMENT_SUBMITTED, SUBMITTED, TODO, type YunguClient } from '../yungu/client';
import { YunguError, type Fetch } from '../yungu/http';
import * as mapping from '../yungu/mapping';
import {
  AssignmentNotFound,
  CommentNotFound,
  DocumentHandedIn,
  DocumentTooLong,
  FILE_STORAGE_UNREACHABLE,
  ServiceError,
  SessionEnded,
  YUNGU_UNAVAILABLE,
  YunguUnavailable,
} from './errors';
import type { SignInResult, StoredFile, YunguData } from './index';
import { NOTIFICATION_PAGE_SIZE } from './messages';
import { REFRESH_COOKIE } from './service';

/**
 * `DATA_SOURCE=direct`: the Next server talks to Yungu itself, for the one local account. Every method
 * ports the matching `Student` method of `api/service/app.py`; toward pages and Route Handlers it behaves
 * as `./service` does (same error classes and messages, same refresh cookie / header, sanitised HTML).
 */

const LIST_PAGE_SIZE = 50;
const BEHAVIOUR_PAGE_SIZE = 50; // allStu/behavior honours 50
const BEHAVIOUR_MAX_PAGES = 40; // 2000 records in one month is far past any real one
const EARLIEST_MONTH = '2000-01';
const KNOWN_FILES_CAP = 5000;
const UNKNOWN_TASK = 1035; // Yungu's answer (HTTP 200, code 1035) for a taskPublishId that does not exist
const DOC_TOO_LONG = 1008; // Yungu's answer (HTTP 200, code 1008) for an online document it refuses
const REFRESH_HEADER = 'x-refresh';
const FILE_URL = /^\/api\/files\/([0-9]+)$/;
const DIGITS = /^[0-9]+$/;

const BAD_REQUEST = 'Bad request.';
const UNKNOWN_FILE = 'Unknown file.';
const ONLINE_DOCUMENT = 'Open this online document on Yungu.';
const NO_TITLE = 'Give the document a title.';
const ADD_A_FILE = 'Add at least one file.';
const NOT_CONFIRMED = "Yungu didn't confirm the hand-in. Check on Yungu.";
const DOC_NOT_SAVED = "Yungu couldn't save the document. Try again.";

type Raw = Record<string, any>;
const isDict = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A Yungu lookup keyed by an assignment id: its "no such task" answer (code 1035) becomes a 404. */
async function known<T>(lookup: () => Promise<T>): Promise<T> {
  try {
    return await lookup();
  } catch (e) {
    if (errorCode(e) === UNKNOWN_TASK) throw new AssignmentNotFound();
    throw e;
  }
}

/** An online-document create/update: code 1008 within the limit is "couldn't save" (502), not "too long". */
async function docWrite<T>(write: () => Promise<T>, content: string): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (errorCode(e) === DOC_TOO_LONG) {
      const tooLong = docTooLongMessage(content);
      throw tooLong ? new DocumentTooLong(tooLong) : new YunguUnavailable(DOC_NOT_SAVED);
    }
    throw e;
  }
}

/** The title to send; refuses a blank title or an over-long delta before any Yungu call. */
function checkedDoc(title: string, content: string): string {
  if (!title.trim()) throw new ServiceError(400, NO_TITLE);
  const tooLong = docTooLongMessage(content);
  if (tooLong) throw new DocumentTooLong(tooLong);
  return title.trim();
}

/** The ids of every FileRef (url /api/files/<id>) in a mapped answer, never the kept hand-in record's. */
function* shownFiles(value: unknown): Generator<string> {
  if (Array.isArray(value)) {
    for (const item of value) yield* shownFiles(item);
  } else if (isDict(value)) {
    const match = typeof value.url === 'string' ? FILE_URL.exec(value.url) : null;
    if (match && String(value.id) === match[1]) yield match[1];
    for (const [key, item] of Object.entries(value)) if (key !== 'submittedFileIds') yield* shownFiles(item);
  }
}

/** A signed file link; a redirect to the login page is expiry, an empty 200 a file with no bytes (422). */
async function redirect(c: YunguClient, fileId: number, preview: boolean): Promise<string> {
  let url: string;
  try {
    url = await c.fileRedirect(fileId, preview);
  } catch (e) {
    if (e instanceof YunguError && e.status === 200) throw new ServiceError(422, ONLINE_DOCUMENT);
    throw e;
  }
  if (isLoginUrl(url)) throw new SessionExpired();
  return url;
}

async function relation(c: YunguClient, aid: number): Promise<number> {
  const achievement = await known(() => c.achievement(aid));
  if (!isDict(achievement) || !achievement.taskUserRelationId) throw new AssignmentNotFound();
  return achievement.taskUserRelationId;
}

function fileIds(ids: string[]): number[] {
  if (!ids.every((i) => typeof i === 'string' && DIGITS.test(i))) throw new ServiceError(400, UNKNOWN_FILE);
  return ids.map(Number);
}

/** Behaviour records of one month, every page up to the ceiling. */
async function behaviourRecords(c: YunguClient, start: string, end: string): Promise<Raw[]> {
  const rows: Raw[] = [];
  for (let page = 1; page <= BEHAVIOUR_MAX_PAGES; page++) {
    const content = (await c.behaviourRecords(start, end, page, BEHAVIOUR_PAGE_SIZE)) || {};
    const data = (Array.isArray(content.data) ? content.data : []).filter(isDict);
    rows.push(...data);
    const total = Number.isInteger(content.total) ? content.total : 0;
    if (!data.length || page * BEHAVIOUR_PAGE_SIZE >= total) return rows;
  }
  console.warn(`Behaviour: stopped at the ${BEHAVIOUR_MAX_PAGES}-page ceiling; later records left out`);
  return rows;
}

/** One Mark-as-submitted at a time per account. */
const marking = new WeakMap<LocalAccount, Promise<unknown>>();
async function exclusive<T>(account: LocalAccount, run: () => Promise<T>): Promise<T> {
  const before = marking.get(account) ?? Promise.resolve();
  const mine = before.then(run, run);
  marking.set(account, mine.catch(() => undefined));
  return mine;
}

/** The YunguData methods for the account `get` returns (the module singleton, or a test's). */
export function createDirectData(get: () => LocalAccount): YunguData {
  /** The account of the page's session: our `yl_session` token must be the account's current one. */
  async function me(): Promise<LocalAccount> {
    const account = get();
    const session = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
    const token = account.token();
    if (!session || token === null || session.token !== token) throw new SessionEnded();
    return account;
  }

  async function wantsRefresh(): Promise<boolean> {
    return (await cookies()).get(REFRESH_COOKIE)?.value === '1' || (await headers()).get(REFRESH_HEADER) === '1';
  }

  /** A cached read; anything but one of our errors while computing it becomes YunguUnavailable. */
  async function read<T>(a: LocalAccount, key: unknown[], compute: () => Promise<T>, refresh?: boolean): Promise<T> {
    const fresh = refresh ?? (await wantsRefresh());
    return a.cache.get(
      JSON.stringify(key),
      async () => {
        try {
          return await compute();
        } catch (e) {
          throw asServiceError(e);
        }
      },
      fresh,
    );
  }

  /** A write: the cache is cleared whatever happens. */
  async function write<T>(a: LocalAccount, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      throw asServiceError(e);
    } finally {
      a.cache.clear();
    }
  }

  function remember(a: LocalAccount, ids: Iterable<string>) {
    for (const id of ids) {
      a.knownFiles.delete(id);
      a.knownFiles.add(id);
    }
    for (const oldest of a.knownFiles) {
      if (a.knownFiles.size <= KNOWN_FILES_CAP) break;
      a.knownFiles.delete(oldest);
    }
  }

  function requireKnown(a: LocalAccount, ids: Iterable<string | number>, error: () => ServiceError) {
    for (const id of ids) if (!a.knownFiles.has(String(id))) throw error();
  }

  async function assignments(a: LocalAccount, status: number): Promise<Assignment[]> {
    const rows = await a.call((c) => c.iterTasks(status, LIST_PAGE_SIZE));
    const now = a.now();
    const seen = new Set<unknown>();
    const out: Assignment[] = [];
    for (const raw of rows) {
      // items can shift between pages: keep the first of each id
      if (seen.has(raw.taskPublishId)) continue;
      seen.add(raw.taskPublishId);
      out.push(mapping.assignment(raw, raw.group ?? null, now));
    }
    return out;
  }

  const todo = (a: LocalAccount, refresh?: boolean) => read(a, ['todo'], () => assignments(a, TODO), refresh);
  const submittedList = (a: LocalAccount, refresh?: boolean) =>
    read(
      a,
      ['submitted'],
      async () => (await assignments(a, SUBMITTED)).sort((x, y) => (y.submittedAt ?? y.dueAt) - (x.submittedAt ?? x.dueAt)),
      refresh,
    );

  /** The task's list row, which alone carries schoolGroup (To-do) and submittedAt (Submitted). */
  async function listed(a: LocalAccount, aid: number, submitted: boolean): Promise<Assignment | null> {
    const rows = submitted ? await submittedList(a, false) : await todo(a, false);
    return rows.find((r) => r.id === aid) ?? null;
  }

  /** Keep Yungu's hand-in whenever a read shows it (submitted, no draft open), also one made on Yungu's website. */
  function noteHandIn(a: LocalAccount, aid: number, mixed: Raw, achievement: Raw) {
    const shown = mapping.handInOnYungu(mixed, achievement);
    const kept = a.state.handIn(aid);
    if (shown !== null && JSON.stringify(kept) !== JSON.stringify(shown)) a.state.setHandIn(aid, shown);
  }

  async function detail(a: LocalAccount, aid: number): Promise<AssignmentDetail> {
    const mixed = await a.call((c) => known(() => c.taskDetail(aid)));
    if (!isDict(mixed) || !mixed.taskPublishId) throw new AssignmentNotFound();
    const achievement = await a.call((c) => known(() => c.achievement(aid)));
    if (!isDict(achievement)) throw new AssignmentNotFound();
    const comments = await a.call((c) => c.comments(aid));
    const myId = await a.call((c) => c.userId());
    const row = await listed(a, aid, achievement.achievementStatus === ACHIEVEMENT_SUBMITTED);
    noteHandIn(a, aid, mixed, achievement);
    return mapping.detail(mixed, achievement, comments, myId, a.state.handIn(aid), row);
  }

  /** (mixed, achievement) straight from Yungu, never the cache: they decide a write. */
  async function fresh(a: LocalAccount, aid: number): Promise<[Raw, Raw]> {
    const achievement = await a.call((c) => known(() => c.achievement(aid)));
    if (!isDict(achievement)) throw new AssignmentNotFound();
    const mixed = await a.call((c) => known(() => c.taskDetail(aid)));
    if (!isDict(mixed) || !mixed.taskPublishId) throw new AssignmentNotFound();
    noteHandIn(a, aid, mixed, achievement);
    return [mixed, achievement];
  }

  /** Handed in with no files and none required: Yungu shows an empty hand-in, or the record says we marked it. */
  function alreadyMarked(a: LocalAccount, aid: number, mixed: Raw, achievement: Raw): boolean {
    if (mapping.needsFiles(mixed, achievement) || achievement.fileModelList?.length || !mapping.isSubmitted(mixed, achievement)) {
      return false;
    }
    const shown = mapping.handInOnYungu(mixed, achievement);
    const kept = a.state.handIn(aid);
    return (shown !== null && shown.length === 0) || (kept !== null && kept.length === 0);
  }

  async function mark(a: LocalAccount, aid: number, mixed: Raw, achievement: Raw): Promise<void> {
    // Only "not yet submitted" (status 1): an unknown or any other status is never marked.
    if (
      mapping.needsFiles(mixed, achievement) ||
      achievement.fileModelList?.length ||
      mapping.achievementStatus(mixed, achievement) !== ACHIEVEMENT_NOT_SUBMITTED
    ) {
      throw new ServiceError(400, ADD_A_FILE);
    }
    const taskId = achievement.taskId || mixed.taskId;
    if (!taskId) throw new YunguUnavailable();
    // Kept before sending: should Yungu apply the mark but its answer be lost, the next press knows.
    a.state.setHandIn(aid, []);
    await a.call((c) => c.markSubmitted(taskId));
    let after: unknown;
    try {
      after = await a.call((c) => c.achievement(aid));
    } catch (e) {
      if (e instanceof ServiceError) throw new YunguUnavailable(NOT_CONFIRMED);
      throw e;
    }
    if (!isDict(after) || !mapping.isSubmitted(mixed, after)) throw new YunguUnavailable(NOT_CONFIRMED);
  }

  async function handInTime(a: LocalAccount, aid: number): Promise<number> {
    let row: Assignment | null = null;
    try {
      row = await listed(a, aid, true);
    } catch (e) {
      if (!(e instanceof ServiceError)) throw e;
    }
    return typeof row?.submittedAt === 'number' ? row.submittedAt : a.now();
  }

  async function markSubmitted(a: LocalAccount, aid: number): Promise<{ submittedAt: number }> {
    const already = await exclusive(a, () =>
      write(a, async () => {
        const [mixed, achievement] = await fresh(a, aid);
        // An earlier press reached Yungu but its answer (or the re-read) was lost: no second mark.
        const done = alreadyMarked(a, aid, mixed, achievement);
        if (!done) await mark(a, aid, mixed, achievement);
        return done;
      }),
    );
    return { submittedAt: already ? await handInTime(a, aid) : a.now() };
  }

  function docRef(a: LocalAccount, content: unknown, title: string, delta: string, fileId?: number): FileRef {
    const raw: Raw = { ...(isDict(content) ? content : {}), type: mapping.ONLINE_DOCUMENT_TYPE };
    if (!('fileName' in raw)) raw.fileName = title;
    if (fileId !== undefined && !raw.fileId) raw.fileId = fileId;
    const ref = mapping.fileRef(raw);
    ref.content = delta; // what we sent is what Yungu stores
    if (!ref.createdAt) ref.createdAt = a.now();
    remember(a, [ref.id]);
    return ref;
  }

  return {
    async getTodo() {
      return todo(await me());
    },
    async getSubmitted() {
      return submittedList(await me());
    },
    async getWeek(weekStart) {
      const a = await me();
      if (!Number.isFinite(weekStart) || Number.isNaN(new Date(weekStart).getTime())) throw new ServiceError(400, BAD_REQUEST);
      const monday = weekStartOf(weekStart);
      return read(a, ['week', monday], async () => {
        const days = await a.call((c) => c.calendarWeek(monday));
        const events = (days || []).flatMap((day: any) => (day || []).map(mapping.classEvent));
        return events.sort((x, y) => x.start - y.start);
      });
    },
    async getCourses() {
      const a = await me();
      return read(a, ['courses'], async () => mapping.courses(await a.call((c) => c.courses())));
    },
    async getBehaviour(month) {
      const a = await me();
      let window: [string, string];
      try {
        window = mapping.monthWindow(month);
      } catch {
        throw new ServiceError(400, BAD_REQUEST);
      }
      if (!(EARLIEST_MONTH <= month && month <= chinaMonth(a.now()))) throw new ServiceError(400, BAD_REQUEST);
      const [start, end] = window;
      return read(a, ['behaviour', month], async () => {
        const total = await a.call((c) => c.behaviourTotal(start, end));
        const rows = await a.call((c) => behaviourRecords(c, start, end));
        return mapping.behaviour(month, total, rows); // throws without a score: a 502
      });
    },
    async getAssignmentDetail(id) {
      const a = await me();
      let shown: AssignmentDetail;
      try {
        shown = await read(a, ['detail', id], () => detail(a, id));
      } catch (e) {
        if (e instanceof AssignmentNotFound) return null;
        throw e;
      }
      remember(a, shownFiles(shown)); // also from the cache: the files are on screen again
      // Yungu's own HTML is sanitised here, before it reaches a page.
      return { ...shown, instructionsHtml: sanitizeInstructions(shown.instructionsHtml ?? '') };
    },
    async uploadFile(name, mime, bytes) {
      const a = await me();
      // No cache clear: an upload attaches the file to nothing, so no read changes until a draft save.
      const up = await a.call(async (c) => {
        try {
          return await c.uploadBytes(name, mime, bytes);
        } catch (e) {
          if (e instanceof YunguError && e.message.startsWith('OSS PUT') && e.status === undefined) {
            throw new YunguUnavailable(FILE_STORAGE_UNREACHABLE);
          }
          throw e;
        }
      });
      const ref = mapping.fileRef({ ...(up.raw || {}), fileId: up.fileId, fileName: name, fileSizeByte: bytes.length });
      if (!ref.createdAt) ref.createdAt = a.now();
      remember(a, [ref.id]);
      return ref;
    },
    async getFile(id, opts) {
      const a = await me();
      if (!DIGITS.test(id) || !a.knownFiles.has(id)) return null;
      const preview = opts?.preview === true;
      const url = await read(a, ['file', id, preview], () => a.call((c) => redirect(c, Number(id), preview)));
      return { redirect: url } satisfies StoredFile;
    },
    async saveDraft(id, ids) {
      const a = await me();
      const numbers = fileIds(ids);
      requireKnown(a, ids, () => new ServiceError(400, UNKNOWN_FILE));
      await write(a, () => a.call(async (c) => c.saveDraft(await relation(c, id), numbers)));
    },
    async submit(id, ids) {
      const a = await me();
      if (ids.length === 0) return markSubmitted(a, id);
      const numbers = fileIds(ids);
      requireKnown(a, ids, () => new ServiceError(400, UNKNOWN_FILE));
      await write(a, () =>
        a.call(async (c) => {
          await c.saveDraft(await relation(c, id), numbers); // the web UI saves the list, then submits it
          await c.submit(id, numbers); // first submit vs update, by achievementId
        }),
      );
      a.state.setHandIn(id, numbers.map(String));
      return { submittedAt: a.now() };
    },
    async createOnlineDoc(_id, title, content) {
      const a = await me();
      const checked = checkedDoc(title, content);
      const made = await write(a, () => a.call((c) => docWrite(() => c.createOnlineDoc(checked, content), content)));
      return docRef(a, made, checked, content);
    },
    async updateOnlineDoc(id, fileId, title, content) {
      const a = await me();
      const checked = checkedDoc(title, content);
      // Only a document this account was shown or made.
      if (!DIGITS.test(fileId)) throw new AssignmentNotFound();
      requireKnown(a, [fileId], () => new AssignmentNotFound());
      const made = await write(a, async () => {
        const [mixed, achievement] = await fresh(a, id);
        if (mapping.handedInIds(mixed, achievement, a.state.handIn(id)).includes(fileId)) throw new DocumentHandedIn();
        const achievementId = achievement.achievementId ?? null;
        return a.call((c) => docWrite(() => c.updateOnlineDoc(Number(fileId), checked, content, achievementId), content));
      });
      return docRef(a, made, checked, content, Number(fileId));
    },
    async addComment(id, text) {
      const a = await me();
      const [rows, myId] = await write(a, async () => {
        await a.call((c) => known(() => c.addComment(id, text))); // looks up the id first
        return [await a.call((c) => c.comments(id)), await a.call((c) => c.userId())] as const;
      });
      // saveCommentary returns nothing: the new comment is my newest one with this text (or my newest one).
      const mine = (rows || []).filter((r: Raw) => r.userId === myId);
      const same = mine.filter((r: Raw) => r.descript === text);
      if (!mine.length) throw new YunguUnavailable();
      const newest = (same.length ? same : mine).reduce((x: Raw, y: Raw) => (y.feedbackId > x.feedbackId ? y : x));
      return mapping.comment(newest, myId);
    },
    async deleteComment(id, commentId) {
      const a = await me();
      await write(a, async () => {
        const rows = await a.call((c) => known(() => c.comments(id)));
        const myId = await a.call((c) => c.userId());
        if (!(rows || []).some((r: Raw) => String(r.feedbackId) === commentId && r.userId === myId)) throw new CommentNotFound();
        await a.call((c) => c.deleteComment(Number(commentId)));
      });
    },
    async getUnreadCount() {
      const a = await me();
      return read(a, ['notifications', 'count'], () => a.call((c) => c.unreadCount()));
    },
    async getNotifications(isRead, page) {
      const a = await me();
      const size = NOTIFICATION_PAGE_SIZE;
      return read(a, ['notifications', isRead, page, size], async () => {
        const content = (await a.call((c) => c.notifications(isRead, page, size))) || {};
        const rows = (Array.isArray(content.data) ? content.data : []).filter(
          (r: unknown) => isDict(r) && r.messageId !== null && r.messageId !== undefined,
        );
        const total = Number.isInteger(content.total) ? content.total : 0;
        return { items: rows.map(mapping.notification), hasMore: rows.length > 0 && (page - 1) * size + rows.length < total };
      });
    },
    async markNotificationRead(id) {
      const a = await me();
      if (!DIGITS.test(id)) throw new ServiceError(404, 'Not found.');
      await write(a, () => a.call((c) => c.markNotificationRead(Number(id))));
    },
    async refresh() {
      (await me()).cache.clear();
    },
    async signIn(loginId, password): Promise<SignInResult> {
      const account = get(); // a missing state dir is a startup error, not a sign-in message
      try {
        const { name, token } = await account.signIn(loginId, password);
        return { ok: true, displayName: name, token };
      } catch (e) {
        if (e instanceof SignInRefused) return { ok: false, error: WRONG_LOGIN };
        return { ok: false, error: e instanceof ServiceError ? e.message : YUNGU_UNAVAILABLE };
      }
    },
    async signOut(token) {
      const account = get();
      if (token === account.token()) account.signOut(); // an old token has nothing left to end
    },
  };
}

// On globalThis: Next may evaluate this module once for instrumentation and again per route bundle,
// and there is only one account (and one bridge).
const SINGLETON = Symbol.for('yungu.localAccount');
type Holder = { [SINGLETON]?: LocalAccount };

/**
 * The local account, made on first use (importing this module touches nothing). Its fetch is the one
 * Electron installs (`__yunguFetch`, its `net.fetch`) or Node's own; its state lives in
 * `YUNGU_LOCAL_STATE_DIR`, which `direct` mode requires. Under Electron it is connected to the desktop
 * shell's credentials bridge (`process.parentPort`).
 */
export function localAccount(): LocalAccount {
  const holder = globalThis as Holder;
  if (holder[SINGLETON]) return holder[SINGLETON];
  const stateDir = process.env.YUNGU_LOCAL_STATE_DIR;
  if (!stateDir) throw new Error('DATA_SOURCE=direct needs YUNGU_LOCAL_STATE_DIR (the folder for the local hand-in record).');
  const f: Fetch = (globalThis as { __yunguFetch?: Fetch }).__yunguFetch ?? ((url, init) => fetch(url, init));
  const account = new LocalAccount({ fetch: f, stateDir });
  connectBridge((process as unknown as { parentPort?: ParentPort }).parentPort, account);
  holder[SINGLETON] = account;
  return account;
}

export const directData: YunguData = createDirectData(localAccount);
