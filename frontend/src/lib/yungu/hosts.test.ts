// @vitest-environment node
// The network rule: every directData method, run through the real YunguClient against a scripted fake
// `fetch`, contacts only the hosts the app is allowed to reach (login.yungu.org, task.yungu.org, Yungu's
// two OSS buckets, and the bucket host an STS answer names). Everything is made up or anonymised.
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSession } from '../session-cookie';
import { LocalAccount } from './account';
import { DONE, LOGIN_ID, OPEN, PASSWORD, load } from './fake-yungu';
import type { Fetch } from './http';

const request = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined),
  }),
  headers: async () => request.headers,
}));

import { createDirectData } from '../data/direct';

const NOW = 1_792_800_000_000; // Sat 2026-10-24 (China)
const ALLOWED = new Set([
  'login.yungu.org',
  'task.yungu.org',
  'yungu-common.oss-cn-hangzhou.aliyuncs.com',
  'yungu-public.oss-cn-hangzhou.aliyuncs.com',
]);
const STS = {
  accessKeyId: 'AKID',
  accessSecret: 'secret',
  stsToken: 'TOK',
  bucketName: 'yungu-common',
  endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
  ossPath: 'stu/1/',
};
const ok = (content: unknown) => Response.json({ code: 0, content });
const DELTA = '{"ops":[{"insert":"plan\\n"}]}';

const publicKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

/** A scripted Yungu at the HTTP level, wrapped in a recorder of the hosts it was asked for. */
function recordingFetch() {
  const hosts = new Set<string>();
  const fetch: Fetch = async (url, init) => {
    const u = new URL(url);
    hosts.add(u.hostname);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    switch (u.pathname) {
      case '/cas/login':
      case '/api/getStudentLoginId':
        return new Response('{}', { status: 200 });
      case '/cas/getPublicKey':
        return Response.json({ content: publicKey });
      case '/cas/loginForLoginId':
        return Response.json({ success: true, redirectUrl: 'https://task.yungu.org/?ticket=t' });
      case '/api/currentUser':
        return ok({ userId: 342, userName: 'Test Student', eName: 'Ada Example' });
      case '/api/my/currentCourses':
        return ok({ data: load('courses.json') });
      case '/api/getAllTasks':
        return ok(u.searchParams.get('inCludeTaskStatus') === '0' ? load('todo_page.json') : load('submitted_page1.json'));
      case '/api/getMixedPublishDetail':
        return ok(u.searchParams.get('taskPublishId') === String(DONE) ? { ...load('mixed_submitted.json'), taskPublishId: DONE } : { ...load('mixed_todo.json'), taskPublishId: OPEN });
      case '/api/student/getAchievementDetail':
        return ok(body.taskPublishId === String(DONE) ? load('achievement_submitted.json') : load('achievement_todo.json'));
      case '/api/student/getAchievementDetail/comment':
        return ok(load('comments_sample.json'));
      case '/api/sts/token':
        return ok(STS);
      case '/api/upload_file/new':
        return ok({ fileId: 11130001, fileName: u.searchParams.get('fileName') });
      case '/api/preview_file':
      case '/api/new_download_file':
        return new Response(null, { status: 302, headers: { location: 'https://yungu-common.oss-cn-hangzhou.aliyuncs.com/taskFile/a.pdf?Signature=x' } });
      case '/api/upload_onlineDocument':
      case '/api/update_onlineDocument':
        return ok({ fileId: body.fileId ?? 11130500, fileName: body.title, type: 'onlineDocument' });
      case '/api/messageCenter/count':
        return ok({ unreadTotal: 2 });
      case '/message/api/messageCenter/v2/page':
        return Response.json({ code: 0, status: true, content: { total: 0, data: [] } });
      case '/api/messageCenter/read':
        return Response.json({ code: 0, status: true, content: null });
      case '/calendar/api/personal/schdedule/templateForPc':
        return ok(load('week.json'));
      case '/calendar/api/statistics/stu/detail':
        return ok([load('behaviour_detail.json')['2026-10']]);
      case '/calendar/api/statistics/allStu/behavior':
        return ok(load('behaviour_records.json')['2026-10']);
      default:
        if (u.hostname.endsWith('.aliyuncs.com') && init.method === 'PUT') return new Response(null, { status: 200 });
        return ok(null); // saveDraft, submit, saveCommentary, deletedCommentary, taskPublish/status
    }
  };
  return { fetch: vi.fn(fetch), hosts };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yl-hosts-'));
  request.cookies = new Map();
  request.headers = new Headers();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A write may be refused by the fixtures' state; the host rule only cares where it went. */
const attempt = (run: () => Promise<unknown>) => run().catch(() => undefined);

describe('the network rule', () => {
  it('every directData method reaches only the allowed hosts', async () => {
    const { fetch, hosts } = recordingFetch();
    const account = new LocalAccount({ fetch, stateDir: dir, now: () => NOW });
    const data = createDirectData(() => account);

    const signedIn = await data.signIn(LOGIN_ID, PASSWORD);
    if (!signedIn.ok) throw new Error(signedIn.error);
    request.cookies.set('yl_session', encodeSession(signedIn.displayName, signedIn.token));

    // Reads: each must really answer.
    expect((await data.getTodo()).length).toBeGreaterThan(0);
    expect((await data.getSubmitted()).length).toBeGreaterThan(0);
    expect((await data.getCourses()).length).toBeGreaterThan(0);
    expect((await data.getWeek(NOW)).length).toBeGreaterThan(0);
    expect((await data.getBehaviour('2026-10')).month).toBe('2026-10');
    expect(await data.getUnreadCount()).toBe(2);
    expect((await data.getNotifications(false, 1)).items).toEqual([]);
    const done = await data.getAssignmentDetail(DONE);
    expect(done).not.toBeNull();
    await data.getAssignmentDetail(OPEN);

    // Files: upload (STS, OSS PUT, registration), then a preview link for a file the page showed.
    const up = await data.uploadFile('note.txt', 'text/plain', new TextEncoder().encode('hello'));
    await attempt(() => data.getFile(up.id, { preview: true }));
    await attempt(() => data.getFile(up.id));

    // Writes.
    await attempt(() => data.saveDraft(OPEN, [up.id]));
    await attempt(() => data.submit(OPEN, [up.id]));
    await attempt(() => data.submit(OPEN, []));
    const doc = await data.createOnlineDoc(OPEN, 'Plan', DELTA);
    await attempt(() => data.updateOnlineDoc(OPEN, doc.id, 'Plan', DELTA));
    await attempt(() => data.addComment(DONE, 'thanks'));
    await attempt(() => data.deleteComment(DONE, '340558'));
    await attempt(() => data.markNotificationRead('7790000'));
    await data.refresh();
    await data.signOut(signedIn.token);

    const urls = fetch.mock.calls.map(([url]) => new URL(url).pathname);
    for (const path of ['/api/sts/token', '/api/upload_file/new', '/api/preview_file', '/api/new_download_file', '/api/student/submitAchievementForDrafts', '/api/upload_onlineDocument', '/api/update_onlineDocument', '/api/saveCommentary', '/api/deletedCommentary', '/api/messageCenter/read']) {
      expect(urls, `${path} was requested`).toContain(path);
    }
    expect(fetch.mock.calls.some(([url, init]) => init.method === 'PUT' && new URL(url).hostname === 'yungu-common.oss-cn-hangzhou.aliyuncs.com')).toBe(true);
    expect([...hosts].filter((h) => !ALLOWED.has(h))).toEqual([]);
  });

  it('the bucket host an STS answer names is the only other host an upload may reach', async () => {
    const { fetch, hosts } = recordingFetch();
    const account = new LocalAccount({ fetch, stateDir: dir, now: () => NOW });
    await account.signIn(LOGIN_ID, PASSWORD);
    await account.call((c) => c.uploadBytes('a.txt', 'text/plain', new Uint8Array([1])));
    const bucketHost = `${STS.bucketName}.${new URL(STS.endpoint).hostname}`;
    expect(hosts).toContain(bucketHost);
    expect([...hosts].filter((h) => !ALLOWED.has(h) && h !== bucketHost)).toEqual([]);
  });
});
