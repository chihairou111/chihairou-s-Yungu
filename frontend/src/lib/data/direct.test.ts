// @vitest-environment node
// directData: the YunguData methods for one local account, against an in-memory Yungu. Ported from the
// single-account cases of api/tests/test_service.py.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSession } from '../session-cookie';
import { SUBMITTED, TODO } from '../yungu/client';
import { LocalAccount } from '../yungu/account';
import { DONE, LOGIN_ID, ME, OPEN, PASSWORD, World, fakeClientFactory, gate, notice } from '../yungu/fake-yungu';
import { YunguError } from '../yungu/http';
import {
  AssignmentNotFound,
  CommentNotFound,
  DocumentHandedIn,
  DocumentTooLong,
  FILE_STORAGE_UNREACHABLE,
  PASSWORD_CHANGED,
  ServiceError,
  SessionEnded,
  YunguUnavailable,
} from './errors';

const request = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined),
  }),
  headers: async () => request.headers,
}));

import { createDirectData } from './direct';

const NOW = 1_792_800_000_000; // Sat 2026-10-24 (China)
const DELTA = '{"ops":[{"insert":"研究计划\\n"}]}';
let dir: string;
let world: World;
let clock: { t: number };
let account: LocalAccount;
let data: ReturnType<typeof createDirectData>;

async function signIn() {
  const result = await data.signIn(LOGIN_ID, PASSWORD);
  if (!result.ok) throw new Error(result.error);
  request.cookies.set('yl_session', encodeSession(result.displayName, result.token));
  return result;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'yl-direct-'));
  world = new World();
  clock = { t: NOW };
  account = new LocalAccount({ fetch: vi.fn(), stateDir: dir, now: () => clock.t, makeClient: fakeClientFactory(world) });
  data = createDirectData(() => account);
  request.cookies = new Map();
  request.headers = new Headers();
  await signIn();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Opens the assignment, so its files become known (as the pop-up does before any file action). */
const open = async (id: number) => (await data.getAssignmentDetail(id))!;

describe('session', () => {
  it('signIn answers the display name and a token', async () => {
    const result = await data.signIn(LOGIN_ID, PASSWORD);
    expect(result).toMatchObject({ ok: true, displayName: 'Ada Example' });
  });

  it('a wrong password is "Wrong student ID or password."', async () => {
    expect(await data.signIn(LOGIN_ID, 'nope')).toEqual({ ok: false, error: 'Wrong student ID or password.' });
  });

  it("Yungu unreachable at sign-in is \"Can't reach Yungu right now. Try again.\"", async () => {
    world.loginFail = new YunguError('POST /cas/loginForLoginId -> fetch failed');
    expect(await data.signIn(LOGIN_ID, PASSWORD)).toEqual({ ok: false, error: "Can't reach Yungu right now. Try again." });
  });

  it('a session cookie with another token is SessionEnded', async () => {
    request.cookies.set('yl_session', encodeSession('Ada Example', 'someone-elses'));
    await expect(data.getTodo()).rejects.toBeInstanceOf(SessionEnded);
    request.cookies.delete('yl_session');
    await expect(data.getCourses()).rejects.toBeInstanceOf(SessionEnded);
    expect(world.count('iterTasks') + world.count('courses')).toBe(0);
  });

  it('signOut with the current token ends the session; an old token changes nothing', async () => {
    const { token } = await signIn();
    await data.signOut('old-token');
    expect(account.token()).toBe(token);
    await data.signOut(token);
    expect(account.token()).toBeNull();
    await expect(data.getTodo()).rejects.toBeInstanceOf(SessionEnded);
  });

  it('a rejected re-login is SessionEnded with the password-changed message', async () => {
    world.accounts[LOGIN_ID].password = 'changed';
    world.expireAll();
    await expect(data.getCourses()).rejects.toMatchObject({ message: PASSWORD_CHANGED });
  });
});

describe('the local account singleton', () => {
  it('importing makes nothing; first use without YUNGU_LOCAL_STATE_DIR throws a clear error', async () => {
    vi.stubEnv('YUNGU_LOCAL_STATE_DIR', '');
    vi.resetModules();
    const fresh = await import('./direct');
    expect(() => fresh.localAccount()).toThrow(/YUNGU_LOCAL_STATE_DIR/);
    await expect(fresh.directData.signIn(LOGIN_ID, PASSWORD)).rejects.toThrow(/YUNGU_LOCAL_STATE_DIR/);
    vi.stubEnv('YUNGU_LOCAL_STATE_DIR', dir);
    expect(fresh.localAccount()).toBe(fresh.localAccount());
    vi.unstubAllEnvs();
  });
});

describe('reads', () => {
  it("todo maps every item in Yungu's order without duplicates, 50 to a page", async () => {
    world.lists[TODO] = [...world.lists[TODO], { ...world.lists[TODO][0] }];
    const todo = await data.getTodo();
    expect(todo.map((a) => a.id)).toEqual([44157]);
    expect(todo[0]).toMatchObject({ status: 'To submit', schoolGroup: 'Due recently' });
    expect(world.args('iterTasks')).toEqual([[TODO, 50]]);
  });

  it('submitted is deduped and newest hand-in first', async () => {
    world.lists[SUBMITTED] = [...world.lists[SUBMITTED], { ...world.lists[SUBMITTED][3] }];
    const items = await data.getSubmitted();
    expect(new Set(items.map((a) => a.id)).size).toBe(items.length);
    expect(items).toHaveLength(10);
    const times = items.map((a) => a.submittedAt ?? a.dueAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('week uses the China Monday, flattened and sorted by start', async () => {
    // Sun 2026-10-25 23:30 China is still the week of Mon 2026-10-19.
    const sunday = Date.UTC(2026, 9, 25, 23 - 8, 30);
    const events = await data.getWeek(sunday);
    expect(world.args('calendarWeek')).toEqual([[Date.UTC(2026, 9, 19, -8)]]);
    expect(events.length).toBe(world.week.flat().length);
    const starts = events.map((e) => e.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('week without a valid start is a 400', async () => {
    await expect(data.getWeek(Number.NaN)).rejects.toMatchObject({ status: 400 });
  });

  it('courses are mapped', async () => {
    const courses = await data.getCourses();
    expect(courses.length).toBe(world.courses.length);
    expect(courses[0]).toHaveProperty('color');
  });

  it('detail combines listing, detail, achievement and comments, sanitised', async () => {
    world.mixed[OPEN].taskContent = '<p>Read</p><script>alert(1)</script>';
    const detail = await open(OPEN);
    expect(detail.id).toBe(OPEN);
    expect(detail.instructionsHtml).toBe('<p>Read</p>');
    expect(detail.submitted).toBe(false);
    const done = await open(DONE);
    expect(done.submitted).toBe(true);
    expect(done.comments.map((c) => c.mine)).toContain(true);
    expect(done.myFiles.map((f) => f.id)).toEqual(['36355566']);
  });

  it('detail 404 → null', async () => {
    expect(await data.getAssignmentDetail(1)).toBeNull();
  });

  it('a read showing a hand-in (submitted, no draft open) is recorded', async () => {
    await open(DONE);
    expect(account.state.handIn(DONE)).toEqual(['36355566']);
  });

  it('reads are cached for 60 seconds; the refresh cookie and header bypass', async () => {
    await data.getCourses();
    await data.getCourses();
    expect(world.count('courses')).toBe(1);
    request.cookies.set('yl_refresh', '1');
    await data.getCourses();
    expect(world.count('courses')).toBe(2);
    request.cookies.delete('yl_refresh');
    request.headers.set('x-refresh', '1');
    await data.getCourses();
    expect(world.count('courses')).toBe(3);
    request.headers.delete('x-refresh');
    clock.t += 60_000;
    await data.getCourses();
    expect(world.count('courses')).toBe(4);
  });

  it('refresh clears the cache', async () => {
    await data.getCourses();
    await data.refresh();
    await data.getCourses();
    expect(world.count('courses')).toBe(2);
  });

  it('unread count', async () => {
    expect(await data.getUnreadCount()).toBe(1);
  });

  it('notifications pages map items and say whether more remain', async () => {
    const first = await data.getNotifications(true, 1);
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    const last = await data.getNotifications(true, 3);
    expect(last.items).toHaveLength(4);
    expect(last.hasMore).toBe(false);
    expect(world.args('notifications')[0]).toEqual([true, 1, 20]);
  });

  it('an empty page never claims more', async () => {
    world.messages = [notice(1, false)];
    expect(await data.getNotifications(false, 5)).toEqual({ items: [], hasMore: false });
  });

  it('mark read sends the id and clears the cache; a malformed id is a 404 without a call', async () => {
    await data.getUnreadCount();
    await data.markNotificationRead('7790000');
    expect(world.args('markNotificationRead')).toEqual([[7790000]]);
    await data.getUnreadCount();
    expect(world.count('unreadCount')).toBe(2);
    await expect(data.markNotificationRead('x1')).rejects.toMatchObject({ status: 404 });
  });

  it('behaviour fetches every page of the month', async () => {
    world.behaviourRows = Array.from({ length: 120 }, (_, i) => ({
      id: i + 1, type: 0, score: '+1', recordTime: new Date(Date.UTC(2026, 9, 10) + i * 1000).toISOString(),
    }));
    const b = await data.getBehaviour('2026-10');
    expect(world.args('behaviourRecords').map((a) => a[2])).toEqual([1, 2, 3]);
    expect(b.records).toHaveLength(120);
    expect(world.args('behaviourTotal')).toEqual([['2026-10-01', '2026-10-31']]);
  });

  it('behaviour paging stops at its ceiling', async () => {
    world.recordsEndless = true;
    world.behaviourRows = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, type: 0, score: '+1', recordTime: '2026-10-10T06:00:00.000+00:00' }));
    await data.getBehaviour('2026-10');
    expect(world.count('behaviourRecords')).toBe(40);
  });

  it('a malformed or future month is a 400', async () => {
    await expect(data.getBehaviour('2026-13')).rejects.toMatchObject({ status: 400 });
    await expect(data.getBehaviour('2026-11')).rejects.toMatchObject({ status: 400 });
    await expect(data.getBehaviour('1999-12')).rejects.toMatchObject({ status: 400 });
  });

  it('a total without a score is a 502', async () => {
    world.behaviourTotal = { positiveScore: 0 };
    await expect(data.getBehaviour('2026-10')).rejects.toBeInstanceOf(YunguUnavailable);
  });
});

describe('files', () => {
  it('unknown id → null without calling Yungu', async () => {
    expect(await data.getFile('36355566')).toBeNull();
    expect(await data.getFile('../x')).toBeNull();
    expect(world.count('fileRedirect')).toBe(0);
  });

  it('a file shown by a detail read resolves to its signed link', async () => {
    await open(DONE);
    expect(await data.getFile('36355566', { preview: true })).toEqual({ redirect: world.redirect });
    expect(world.args('fileRedirect')).toEqual([[36355566, true]]);
  });

  it('a redirect to the login page counts as expiry', async () => {
    await open(DONE);
    let n = 0;
    const real = 'https://yungu-common.oss-cn-hangzhou.aliyuncs.com/taskFile/a.pdf?Signature=y';
    const login = 'https://login.yungu.org/cas/login?service=x';
    // the first answer is the login page, the one after the re-login the real link
    Object.defineProperty(world, 'redirect', { get: () => (n++ === 0 ? login : real), configurable: true });
    expect(await data.getFile('36355566')).toEqual({ redirect: real });
    expect(world.logins).toHaveLength(2);
  });

  it('a file Yungu keeps no bytes for is a 422', async () => {
    await open(DONE);
    world.redirectError = new YunguError('/api/new_download_file?id=36355566 -> HTTP 200', { status: 200 });
    await expect(data.getFile('36355566')).rejects.toMatchObject({ status: 422, message: 'Open this online document on Yungu.' });
  });

  it('upload adds the id to known files and keeps the cache', async () => {
    await data.getCourses();
    const ref = await data.uploadFile('研究.pdf', 'application/pdf', new Uint8Array(10));
    expect(ref).toMatchObject({ id: '11130001', name: '研究.pdf', size: 10, url: '/api/files/11130001' });
    expect(ref.createdAt).toBe(NOW);
    expect(account.knownFiles.has('11130001')).toBe(true);
    await data.getCourses();
    expect(world.count('courses')).toBe(1);
  });

  it("an OSS network failure on upload says Yungu's file storage can't be reached", async () => {
    world.fail = new YunguError('OSS PUT taskFile/1_a.pdf -> fetch failed');
    const error = await data.uploadFile('a.pdf', 'application/pdf', new Uint8Array(1)).catch((e) => e);
    expect(error).toBeInstanceOf(YunguUnavailable);
    expect(error.message).toBe(FILE_STORAGE_UNREACHABLE);
  });
});

describe('writes', () => {
  it('saveDraft with an unknown file id → ServiceError(400) without a write', async () => {
    const error = await data.saveDraft(OPEN, ['99']).catch((e) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.status).toBe(400);
    await expect(data.saveDraft(OPEN, ['abc'])).rejects.toMatchObject({ status: 400 });
    expect(world.count('saveDraft')).toBe(0);
  });

  it('saveDraft saves the list against the task-user relation', async () => {
    await data.uploadFile('a.pdf', 'application/pdf', new Uint8Array(1));
    await data.saveDraft(OPEN, ['11130001']);
    expect(world.args('saveDraft')).toEqual([[world.ach[OPEN].taskUserRelationId, [11130001]]]);
  });

  it('a draft on an unknown assignment is AssignmentNotFound', async () => {
    await data.uploadFile('a.pdf', 'application/pdf', new Uint8Array(1));
    await expect(data.saveDraft(1, ['11130001'])).rejects.toBeInstanceOf(AssignmentNotFound);
  });

  it('submit saves the draft then submits and records the hand-in', async () => {
    await data.uploadFile('a.pdf', 'application/pdf', new Uint8Array(1));
    const result = await data.submit(OPEN, ['11130001']);
    expect(result).toEqual({ submittedAt: NOW });
    expect(world.calls.map((c) => c[0]).filter((n) => n === 'saveDraft' || n === 'submit')).toEqual(['saveDraft', 'submit']);
    expect(world.args('submit')).toEqual([[OPEN, [11130001]]]);
    expect(account.state.handIn(OPEN)).toEqual(['11130001']);
  });

  it('writes are retried once after a re-login', async () => {
    await data.uploadFile('a.pdf', 'application/pdf', new Uint8Array(1));
    world.expireAll();
    await data.saveDraft(OPEN, ['11130001']);
    expect(world.logins).toHaveLength(2);
    expect(world.count('saveDraft')).toBe(1);
  });

  describe('submit([]) is Mark as submitted', () => {
    it('hands in with no files when none are needed', async () => {
      const result = await data.submit(OPEN, []);
      expect(result).toEqual({ submittedAt: NOW });
      expect(world.args('markSubmitted')).toEqual([[world.ach[OPEN].taskId]]);
      expect(account.state.handIn(OPEN)).toEqual([]);
    });

    it.each([
      ['files are needed', (w: World) => (w.ach[OPEN].needEnclosure = true)],
      ['the draft has files', (w: World) => (w.ach[OPEN].fileModelList = [{ fileId: 5, fileName: 'a.txt' }])],
      ['it is not "not submitted"', (w: World) => (w.ach[OPEN].achievementStatus = 3)],
    ])('refused with "Add at least one file." when %s', async (_name, change) => {
      change(world);
      await expect(data.submit(OPEN, [])).rejects.toMatchObject({ status: 400, message: 'Add at least one file.' });
      expect(world.count('markSubmitted')).toBe(0);
    });

    it('two concurrent presses → one markSubmitted call', async () => {
      const held = gate();
      world.afterMark = () => held.promise;
      const first = data.submit(OPEN, []);
      await new Promise((r) => setTimeout(r, 0));
      const second = data.submit(OPEN, []);
      await new Promise((r) => setTimeout(r, 0));
      held.open();
      const results = await Promise.all([first, second]);
      expect(results.every((r) => typeof r.submittedAt === 'number')).toBe(true);
      expect(world.count('markSubmitted')).toBe(1);
    });

    it('already marked → success, no write', async () => {
      world.ach[OPEN].achievementStatus = 4;
      account.state.setHandIn(OPEN, []);
      expect(await data.submit(OPEN, [])).toEqual({ submittedAt: NOW });
      expect(world.count('markSubmitted')).toBe(0);
    });

    it('a mark Yungu does not confirm is a 502', async () => {
      world.markConfirms = false;
      await expect(data.submit(OPEN, [])).rejects.toMatchObject({ status: 502, message: "Yungu didn't confirm the hand-in. Check on Yungu." });
    });

    it('is sent once even when the session expires after it', async () => {
      world.afterMark = () => world.expireAll();
      await data.submit(OPEN, []);
      expect(world.count('markSubmitted')).toBe(1);
    });

    it('on an unknown assignment is AssignmentNotFound', async () => {
      await expect(data.submit(1, [])).rejects.toBeInstanceOf(AssignmentNotFound);
    });
  });

  describe('online documents', () => {
    it('create returns its online FileRef with the delta sent', async () => {
      const ref = await data.createOnlineDoc(OPEN, '  Plan  ', DELTA);
      expect(ref).toMatchObject({ id: '11130501', name: 'Plan', online: true, content: DELTA, createdAt: NOW });
      expect(world.args('createOnlineDoc')).toEqual([['Plan', DELTA]]);
      expect(account.knownFiles.has('11130501')).toBe(true);
    });

    it('needs a title', async () => {
      await expect(data.createOnlineDoc(OPEN, '  ', DELTA)).rejects.toMatchObject({ status: 400 });
    });

    it('over 65 535 bytes is DocumentTooLong (413) before any call', async () => {
      const content = 'a'.repeat(65_536);
      const error = await data.createOnlineDoc(OPEN, 'T', content).catch((e) => e);
      expect(error).toBeInstanceOf(DocumentTooLong);
      expect(error.status).toBe(413);
      expect(error.message).toBe('Too long for Yungu — cut about 1 character.');
      await expect(data.createOnlineDoc(OPEN, 'T', 'a'.repeat(65_535))).resolves.toBeTruthy();
      expect(world.count('createOnlineDoc')).toBe(1);
    });

    it("Yungu's code 1008 under the limit is a 502", async () => {
      world.docError = new YunguError('POST /api/upload_onlineDocument -> code=1008', { status: 200, body: { code: 1008 } });
      await expect(data.createOnlineDoc(OPEN, 'T', DELTA)).rejects.toMatchObject({ status: 502 });
    });

    it('update keeps its id and sends the achievement id', async () => {
      const made = await data.createOnlineDoc(OPEN, 'T', DELTA);
      const ref = await data.updateOnlineDoc(OPEN, made.id, 'T2', DELTA);
      expect(ref.id).toBe(made.id);
      expect(world.args('updateOnlineDoc')).toEqual([[Number(made.id), 'T2', DELTA, null]]);
    });

    it('a handed-in document is DocumentHandedIn (409)', async () => {
      world.ach[DONE].fileModelList = [{ fileId: 36355566, fileName: 'Doc', type: 'onlineDocument', storeMeta: DELTA }];
      await open(DONE);
      const error = await data.updateOnlineDoc(DONE, '36355566', 'T', DELTA).catch((e) => e);
      expect(error).toBeInstanceOf(DocumentHandedIn);
      expect(error.status).toBe(409);
      expect(world.count('updateOnlineDoc')).toBe(0);
    });

    it('a document this account was not shown is a 404 without a write', async () => {
      await expect(data.updateOnlineDoc(OPEN, '424242', 'T', DELTA)).rejects.toMatchObject({ status: 404 });
      expect(world.count('updateOnlineDoc')).toBe(0);
    });
  });

  describe('comments', () => {
    it('add returns the newest own comment', async () => {
      const c = await data.addComment(DONE, 'Thanks!');
      expect(c).toMatchObject({ id: '400001', mine: true, text: 'Thanks!' });
      expect(world.args('addComment')).toEqual([[DONE, 'Thanks!']]);
    });

    it('add on an unknown assignment is AssignmentNotFound', async () => {
      await expect(data.addComment(1, 'x')).rejects.toBeInstanceOf(AssignmentNotFound);
    });

    it('delete own comment calls deleteComment', async () => {
      const mine = world.comments[DONE].find((c) => c.userId === ME)!;
      await data.deleteComment(DONE, String(mine.feedbackId));
      expect(world.args('deleteComment')).toEqual([[mine.feedbackId]]);
    });

    it("delete someone else's → CommentNotFound", async () => {
      const theirs = world.comments[DONE].find((c) => c.userId !== ME)!;
      await expect(data.deleteComment(DONE, String(theirs.feedbackId))).rejects.toBeInstanceOf(CommentNotFound);
      await expect(data.deleteComment(DONE, 'nope')).rejects.toBeInstanceOf(CommentNotFound);
      expect(world.count('deleteComment')).toBe(0);
    });
  });

  it.each([
    ['saveDraft', async () => data.saveDraft(OPEN, ['11130001'])],
    ['submit', async () => data.submit(OPEN, ['11130001'])],
    ['submit([])', async () => data.submit(OPEN, [])],
    ['createOnlineDoc', async () => data.createOnlineDoc(OPEN, 'T', DELTA)],
    ['addComment', async () => data.addComment(DONE, 'x')],
    ['deleteComment', async () => data.deleteComment(DONE, '340558')],
    ['markNotificationRead', async () => data.markNotificationRead('7790000')],
    ['a failed write', async () => data.addComment(1, 'x').catch(() => undefined)],
  ])('every write clears the cache: %s', async (_name, write) => {
    await data.uploadFile('a.pdf', 'application/pdf', new Uint8Array(1));
    await data.getCourses();
    await write();
    await data.getCourses();
    expect(world.count('courses')).toBe(2);
  });

  it('a Yungu failure on a write is YunguUnavailable', async () => {
    world.fail = new YunguError('GET /x -> HTTP 500', { status: 500 });
    await expect(data.addComment(DONE, 'x')).rejects.toBeInstanceOf(YunguUnavailable);
  });
});
