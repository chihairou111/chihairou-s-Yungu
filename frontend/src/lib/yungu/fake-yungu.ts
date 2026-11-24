/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Test-only: an in-memory Yungu for `LocalAccount` and `directData` tests (port of the `World` /
 * `FakeClient` pair in api/tests/test_service.py). Never imported by the app. Every value is made up or
 * comes from the anonymised fixtures.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { YunguClient } from './client';
import { SUBMITTED, TODO } from './client';
import { YunguError } from './http';

export const ME = 342; // the fixture student's userId (comments_sample, behaviour rows)
export const LOGIN_ID = 'S0001';
export const PASSWORD = 'pw-correct-1';

const FIXTURES = join(__dirname, 'fixtures');
export const load = (name: string): any => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

export const expiredError = () =>
  new YunguError('GET /api/x -> code=1000 message=not logged in', { status: 200, body: { code: 1000, ifLogin: false } });
export const rejectedLogin = () =>
  new YunguError('login failed: wrong', { status: 200, body: { success: false, msg: 'wrong', code: 1 } });
export const unknownTask = () => new YunguError('GET /api/x -> code=1035', { status: 200, body: { code: 1035 } });

const flat = (page: any) => page.data.flatMap((g: any) => g.taskList.map((t: any) => ({ ...t, group: g.groupName })));

/** Assignment ids of the fake: one handed in, one still to do. */
export const DONE = 60417;
export const OPEN = 94929;

export class World {
  accounts: Record<string, { password: string; user: any }> = {
    [LOGIN_ID]: { password: PASSWORD, user: { userId: ME, userName: '学生甲', eName: 'Ada Example' } },
  };
  logins: string[] = [];
  sessions = 0; // serial of the latest successful login
  validFrom = 0; // sessions below this serial are expired
  calls: [string, unknown[]][] = [];
  fail: unknown = null; // every data call throws this
  loginFail: unknown = null; // every login throws this
  loginGate: Promise<void> | null = null; // logins wait on it
  expiredGate: Promise<void> | null = null; // expired calls wait on it before failing
  redirect = 'https://yungu-common.oss-cn-hangzhou.aliyuncs.com/taskFile/a.pdf?Signature=x';
  lists: Record<number, any[]> = { [TODO]: flat(load('todo_page.json')), [SUBMITTED]: flat(load('submitted_page1.json')) };
  courses = load('courses.json');
  week = load('week.json');
  mixed: Record<number, any> = {
    [DONE]: { ...load('mixed_submitted.json'), taskPublishId: DONE },
    [OPEN]: { ...load('mixed_todo.json'), taskPublishId: OPEN },
  };
  ach: Record<number, any> = { [DONE]: load('achievement_submitted.json'), [OPEN]: load('achievement_todo.json') };
  comments: Record<number, any[]> = { [DONE]: load('comments_sample.json'), [OPEN]: [] };
  nextFeedback = 400000;
  nextDoc = 11130500;
  docError: unknown = null;
  redirectError: unknown = null; // fileRedirect throws this
  recordsEndless = false; // behaviourRecords answers every page full, with a huge total
  markConfirms = true;
  afterMark: (() => Promise<void> | void) | null = null;
  unread = 1;
  messages = Array.from({ length: 45 }, (_, i) => notice(7790000 - i, i > 0));
  behaviourRows: any[] = [];
  behaviourTotal: any = { score: 100.0, baseScore: 100.0, positiveScore: 0.0, negativeScore: 0.0 };

  expireAll() {
    this.validFrom = this.sessions + 1;
  }

  count(name: string) {
    return this.calls.filter((c) => c[0] === name).length;
  }

  args(name: string) {
    return this.calls.filter((c) => c[0] === name).map((c) => c[1]);
  }
}

export function notice(messageId: number, read: boolean) {
  return {
    messageId,
    messageSendTime: '2026-10-20 16:08',
    ifRead: read,
    title: `标题 ${messageId}`,
    titleEn: `Title ${messageId}`,
    content: '内容',
    contentEn: 'Body',
    messageUrl: `https://task.yungu.org/#/taskInfo/${messageId}/1/1`,
    messageType: 24,
  };
}

export class FakeClient {
  serial = -1;
  user: any = null;

  constructor(
    private w: World,
    private loginId: string,
    private password: string,
  ) {}

  async login() {
    this.w.logins.push(this.loginId);
    if (this.w.loginGate) await this.w.loginGate;
    if (this.w.loginFail) throw this.w.loginFail;
    const acct = this.w.accounts[this.loginId];
    if (!acct || acct.password !== this.password) throw rejectedLogin();
    this.serial = ++this.w.sessions;
    this.user = { ...acct.user };
    return this.user;
  }

  async userId() {
    return this.user.userId;
  }

  private async hit(name: string, ...args: unknown[]) {
    this.w.calls.push([name, args]);
    if (this.w.fail) throw this.w.fail;
    if (this.serial < this.w.validFrom) {
      if (this.w.expiredGate) await this.w.expiredGate;
      throw expiredError();
    }
  }

  async courses() {
    await this.hit('courses');
    return this.w.courses;
  }
  async iterTasks(status: number, pageSize: number) {
    await this.hit('iterTasks', status, pageSize);
    return this.w.lists[status].map((t) => ({ ...t }));
  }
  async calendarWeek(startMs: number) {
    await this.hit('calendarWeek', startMs);
    return this.w.week;
  }
  async taskDetail(id: number) {
    await this.hit('taskDetail', id);
    if (!(id in this.w.mixed)) throw unknownTask();
    return this.w.mixed[id];
  }
  async achievement(id: number) {
    await this.hit('achievement', id);
    if (!(id in this.w.ach)) throw unknownTask();
    return structuredClone(this.w.ach[id]);
  }
  async comments(id: number) {
    await this.hit('comments', id);
    return [...(this.w.comments[id] ?? [])].sort((a, b) => b.feedbackId - a.feedbackId);
  }
  async uploadBytes(name: string, mime: string, bytes: Uint8Array) {
    await this.hit('uploadBytes', name, mime, bytes.length);
    return { fileId: 11130001, fileName: name, raw: { fileId: 11130001, fileName: name } };
  }
  async fileRedirect(fileId: number, preview: boolean) {
    await this.hit('fileRedirect', fileId, preview);
    if (this.w.redirectError) throw this.w.redirectError;
    return this.w.redirect;
  }
  async saveDraft(relationId: number, fileIds: number[]) {
    await this.hit('saveDraft', relationId, [...fileIds]);
    return { code: 0 };
  }
  async submit(id: number, fileIds: number[]) {
    await this.hit('submit', id, [...fileIds]);
    return { code: 0 };
  }
  async addComment(id: number, text: string) {
    await this.hit('addComment', id, text);
    if (!(id in this.w.ach)) throw unknownTask();
    (this.w.comments[id] ??= []).push({
      feedbackId: ++this.w.nextFeedback,
      parentId: null,
      userId: this.user.userId,
      userName: '学生甲',
      eName: 'Ada Example',
      descript: text,
      feedbackTime: '2026-10-19 23:00:00',
      deletePermission: false,
    });
  }
  async deleteComment(feedbackId: number) {
    await this.hit('deleteComment', feedbackId);
  }
  private doc(fileId: number, title: string, delta: string) {
    if (this.w.docError) throw this.w.docError;
    return { fileId, fileName: title, type: 'onlineDocument', storeMeta: delta, previewImage: '/api/file/preview?previewId=9', url: null };
  }
  async createOnlineDoc(title: string, delta: string) {
    await this.hit('createOnlineDoc', title, delta);
    return this.doc(++this.w.nextDoc, title, delta);
  }
  async updateOnlineDoc(fileId: number, title: string, delta: string, achievementId: number | null) {
    await this.hit('updateOnlineDoc', fileId, title, delta, achievementId);
    return this.doc(fileId, title, delta);
  }
  async markSubmitted(taskId: number) {
    await this.hit('markSubmitted', taskId);
    if (this.w.afterMark) await this.w.afterMark();
    if (this.w.markConfirms) {
      for (const a of Object.values(this.w.ach)) if (a.taskId === taskId) a.achievementStatus = 4;
    }
    return null;
  }
  async unreadCount() {
    await this.hit('unreadCount');
    return this.w.unread;
  }
  async notifications(read: boolean, page: number, size: number) {
    await this.hit('notifications', read, page, size);
    const rows = this.w.messages.filter((m) => m.ifRead === read);
    return { pageNum: page, pageSize: size, total: rows.length, data: rows.slice((page - 1) * size, page * size) };
  }
  async markNotificationRead(id: number) {
    await this.hit('markNotificationRead', id);
    return { code: 0, status: true, content: null };
  }
  async behaviourTotal(start: string, end: string) {
    await this.hit('behaviourTotal', start, end);
    return { ...this.w.behaviourTotal };
  }
  async behaviourRecords(start: string, end: string, page: number, size: number) {
    await this.hit('behaviourRecords', start, end, page, size);
    const rows = this.w.behaviourRows;
    if (this.w.recordsEndless) return { pageNum: page, pageSize: size, total: 1_000_000, data: rows.map((r) => ({ ...r })) };
    return { pageNum: page, pageSize: size, total: rows.length, data: rows.slice((page - 1) * size, page * size) };
  }
}

export const fakeClientFactory = (w: World) => (id: string, pw: string) => new FakeClient(w, id, pw) as unknown as YunguClient;

/** A promise and the function that settles it. */
export function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}
