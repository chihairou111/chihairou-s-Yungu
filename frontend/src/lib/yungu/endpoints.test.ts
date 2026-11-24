import { describe, expect, it } from 'vitest';
import { BASE, ONLINE_DOC_MAX_BYTES, YunguClient } from './client';
import { YunguError, type Fetch } from './http';

type Req = { url: string; init: RequestInit };
type Answer = { status?: number; json?: unknown; headers?: [string, string][] };

function script(...answers: Answer[]) {
  const reqs: Req[] = [];
  const fetch: Fetch = async (url, init) => {
    reqs.push({ url, init });
    const a = answers.shift();
    if (!a) throw new Error(`unexpected request ${init.method} ${url}`);
    const { status = 200, json, headers = [] } = a;
    return new Response(json === undefined ? null : JSON.stringify(json), { status, headers });
  };
  return { reqs, fetch };
}

const ok = (content: unknown = null): Answer => ({ json: { code: 0, content } });
const USER: Answer = ok({ userId: 4242, userName: 'Test Student' });
const hdr = (r: Req) => r.init.headers as Record<string, string>;
const body = (r: Req) => JSON.parse(r.init.body as string);
const q = (r: Req) => Object.fromEntries(new URL(r.url).searchParams);
const path = (r: Req) => new URL(r.url).pathname;
const mk = (...a: Answer[]) => {
  const s = script(...a);
  return { ...s, c: new YunguClient('s1', 'pw', s.fetch, { now: () => 1_764_000_000_000 }) };
};

describe('assignments', () => {
  it('courses', async () => {
    const { c, reqs } = mk(ok({ data: [{ courseId: 1 }] }));
    expect(await c.courses()).toEqual([{ courseId: 1 }]);
    expect(reqs[0].init.method).toBe('GET');
    expect(reqs[0].url).toBe(`${BASE}/api/my/currentCourses`);
  });

  it('listTasks sends sortType only on the to-do tab', async () => {
    const { c, reqs } = mk(ok({ data: [] }), ok({ data: [] }));
    await c.listTasks(0, 2, 10);
    await c.listTasks(2, 1, 10);
    expect(path(reqs[0])).toBe('/api/getAllTasks');
    expect(q(reqs[0])).toEqual({ courseId: '', includeContentLike: '', inCludeTaskStatus: '0', pageNum: '2', pageSize: '10', sortType: '2' });
    expect(q(reqs[1])).toEqual({ courseId: '', includeContentLike: '', inCludeTaskStatus: '2', pageNum: '1', pageSize: '10' });
  });

  it('iterTasks pages until seen >= total and tags group', async () => {
    const t = (n: number) => ({ taskPublishId: n });
    const { c, reqs } = mk(
      ok({ total: 3, data: [{ groupName: 'Due today', taskList: [t(1), t(2)] }] }),
      ok({ total: 3, data: [{ groupName: 'Delayed', taskList: [t(3)] }] }),
    );
    expect(await c.iterTasks(0, 2)).toEqual([
      { taskPublishId: 1, group: 'Due today' },
      { taskPublishId: 2, group: 'Due today' },
      { taskPublishId: 3, group: 'Delayed' },
    ]);
    expect(reqs.map((r) => q(r).pageNum)).toEqual(['1', '2']);
  });

  it('iterTasks stops on an empty page', async () => {
    const { c, reqs } = mk(ok({ total: 5, data: [] }));
    expect(await c.iterTasks(2, 10)).toEqual([]);
    expect(reqs).toHaveLength(1);
  });

  it('taskDetail', async () => {
    const { c, reqs } = mk(ok({ fileList: [] }));
    expect(await c.taskDetail(93)).toEqual({ fileList: [] });
    expect(path(reqs[0])).toBe('/api/getMixedPublishDetail');
    expect(q(reqs[0])).toEqual({ taskPublishId: '93' });
  });

  it('achievement posts the student id and a string publish id', async () => {
    const { c, reqs } = mk(USER, ok({ achievementId: null }));
    expect(await c.achievement(93)).toEqual({ achievementId: null });
    expect(reqs[1].init.method).toBe('POST');
    expect(path(reqs[1])).toBe('/api/student/getAchievementDetail');
    expect(body(reqs[1])).toEqual({ distributionType: 1, ifPc: true, studentId: 4242, taskPublishId: '93', teamId: null });
    expect(hdr(reqs[1])['Content-Type']).toBe('application/json');
  });
});

describe('fileRedirect', () => {
  it('returns the absolute Location of the 302 (preview)', async () => {
    const { c, reqs } = mk({ status: 302, headers: [['location', 'https://yungu-common.oss-cn-hangzhou.aliyuncs.com/x?sig=1']] });
    expect(await c.fileRedirect(7, true)).toBe('https://yungu-common.oss-cn-hangzhou.aliyuncs.com/x?sig=1');
    expect(reqs).toHaveLength(1);
    expect(reqs[0].url).toBe(`${BASE}/api/preview_file?id=7`);
    expect(reqs[0].init.redirect).toBe('manual');
    expect(hdr(reqs[0]).Referer).toBe(`${BASE}/umiTask`);
  });

  it('uses new_download_file for downloads and resolves a relative Location', async () => {
    const { c, reqs } = mk({ status: 302, headers: [['location', '/files/a.pdf']] });
    expect(await c.fileRedirect(7, false)).toBe(`${BASE}/files/a.pdf`);
    expect(reqs[0].url).toBe(`${BASE}/api/new_download_file?id=7`);
  });

  it('raises when the answer is not a 302', async () => {
    const { c } = mk({ status: 200 });
    await expect(c.fileRedirect(7, true)).rejects.toMatchObject({ name: 'YunguError', status: 200 });
  });

  it('raises when a 302 has no Location', async () => {
    const { c } = mk({ status: 302 });
    await expect(c.fileRedirect(7, true)).rejects.toBeInstanceOf(YunguError);
  });
});

describe('uploadBytes', () => {
  const STS = {
    accessKeyId: 'AKID',
    accessSecret: 'secret',
    stsToken: 'TOK',
    bucketName: 'yungu-common',
    endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
    ossPath: 'stu/1/',
  };

  it('gets an STS token, PUTs to OSS without cookies, then registers the file', async () => {
    const { c, reqs } = mk(
      { json: { code: 0, content: STS }, headers: [['set-cookie', 'SESSION=abc; Path=/']] },
      {},
      ok({ fileId: 55, fileName: 'a.txt' }),
    );
    const out = await c.uploadBytes('a.txt', 'text/plain', new Uint8Array([104, 105]));
    expect(out).toEqual({ fileId: 55, fileName: 'a.txt', raw: { fileId: 55, fileName: 'a.txt' } });
    expect(reqs.map((r) => `${r.init.method} ${path(r)}`)).toEqual(['GET /api/sts/token', 'PUT /stu/1/1764000000000_a.txt', 'GET /api/upload_file/new']);
    expect(q(reqs[0])).toEqual({ type: '1' });
    expect(reqs[1].url).toBe('https://yungu-common.oss-cn-hangzhou.aliyuncs.com/stu/1/1764000000000_a.txt');
    expect(hdr(reqs[1]).Cookie).toBeUndefined();
    expect(hdr(reqs[1]).Authorization).toMatch(/^OSS AKID:/);
    expect(q(reqs[2])).toEqual({
      fileName: 'a.txt',
      bucketName: 'yungu-common',
      fileSize: '2',
      fileType: 'text/plain',
      fileUrl: 'stu/1/1764000000000_a.txt',
      percent: '100',
      uuid: '1764000000000',
    });
  });

  it('defaults an empty mime to application/octet-stream', async () => {
    const { c, reqs } = mk(ok(STS), {}, ok({ fileId: 1, fileName: 'b' }));
    await c.uploadBytes('b', '', new Uint8Array());
    expect(hdr(reqs[1])['Content-Type']).toBe('application/octet-stream');
    expect(q(reqs[2]).fileType).toBe('application/octet-stream');
  });

  it('fails when OSS refuses', async () => {
    const { c, reqs } = mk(ok(STS), { status: 403 });
    await expect(c.uploadBytes('a.txt', 'text/plain', new Uint8Array([1]))).rejects.toBeInstanceOf(YunguError);
    expect(reqs).toHaveLength(2);
  });
});

describe('draft and submission', () => {
  it('saveDraft sends the comma-joined ids', async () => {
    const { c, reqs } = mk(ok());
    await c.saveDraft(9, [3, 4]);
    expect(reqs[0].init.method).toBe('GET');
    expect(path(reqs[0])).toBe('/api/student/submitAchievementForDrafts');
    expect(q(reqs[0])).toEqual({ taskUserRelationId: '9', fileIds: '3,4' });
  });

  it('saveDraft with no files sends an empty fileIds', async () => {
    const { c, reqs } = mk(ok());
    await c.saveDraft(9, []);
    expect(q(reqs[0])).toEqual({ taskUserRelationId: '9', fileIds: '' });
  });

  const A = { courseId: 12, taskUserRelationId: 8, textStatus: null };
  it('first submit posts submitAchievementSendMessage', async () => {
    const { c, reqs } = mk(USER, ok({ ...A, achievementId: null }), ok());
    await c.submit(93, [3, 4]);
    expect(path(reqs[2])).toBe('/api/submitAchievementSendMessage');
    expect(reqs[2].init.method).toBe('POST');
    expect(body(reqs[2])).toEqual({
      courseId: 12,
      fileList: [3, 4],
      studentIds: [4242],
      teamList: null,
      taskPublishId: 93,
      taskUserRelationId: 8,
      textStatus: 0,
    });
  });

  it('re-submit posts updateAchievementAndSendMessage with the achievementId first', async () => {
    const { c, reqs } = mk(USER, ok({ ...A, achievementId: 77, textStatus: 2 }), ok());
    await c.submit(93, [3]);
    expect(path(reqs[2])).toBe('/api/updateAchievementAndSendMessage');
    const b = body(reqs[2]);
    expect(Object.keys(b)[0]).toBe('achievementId');
    expect(b).toMatchObject({ achievementId: 77, taskPublishId: 93, textStatus: 2, fileList: [3] });
  });
});

describe('online documents', () => {
  const delta = '{"ops":[{"insert":"héllo 你好\\n"}]}';
  const b64 = Buffer.from(delta, 'utf8').toString('base64');

  it('createOnlineDoc sends base64 of the UTF-8 delta', async () => {
    const { c, reqs } = mk(ok({ fileId: 5 }));
    expect(await c.createOnlineDoc('Notes', delta)).toEqual({ fileId: 5 });
    expect(path(reqs[0])).toBe('/api/upload_onlineDocument');
    expect(body(reqs[0])).toEqual({ title: 'Notes', description: b64, base64Convert: true });
  });

  it('updateOnlineDoc sends fileId and achievementId', async () => {
    const { c, reqs } = mk(ok({ fileId: 5 }), ok({ fileId: 5 }));
    await c.updateOnlineDoc(5, 'Notes', delta, 77);
    await c.updateOnlineDoc(5, 'Notes', delta, null);
    expect(path(reqs[0])).toBe('/api/update_onlineDocument');
    expect(body(reqs[0])).toEqual({ title: 'Notes', description: b64, fileId: 5, achievementId: 77, base64Convert: true });
    expect(body(reqs[1]).achievementId).toBeNull();
  });

  it('exports the size limit the callers check', () => {
    expect(ONLINE_DOC_MAX_BYTES).toBe(65535);
  });

  it('markSubmitted posts status 4 for the task id', async () => {
    const { c, reqs } = mk(USER, ok(null));
    expect(await c.markSubmitted(31)).toBeNull();
    expect(path(reqs[1])).toBe('/api/users/taskPublish/status');
    expect(body(reqs[1])).toEqual({ status: 4, userIds: [4242], teamIds: null, taskId: 31 });
  });
});

describe('comments', () => {
  it('comments posts the achievement query and returns [] for null', async () => {
    const { c, reqs } = mk(USER, ok([{ feedbackId: 1 }]), ok(null));
    expect(await c.comments(93)).toEqual([{ feedbackId: 1 }]);
    expect(path(reqs[1])).toBe('/api/student/getAchievementDetail/comment');
    expect(body(reqs[1])).toEqual({ distributionType: 1, ifPc: true, studentId: 4242, teamId: null, taskPublishId: '93' });
    expect(await c.comments(93)).toEqual([]);
  });

  it('addComment looks up the achievement then posts saveCommentary', async () => {
    const { c, reqs } = mk(USER, ok({ taskUserRelationId: 8, taskId: 31 }), ok());
    await c.addComment(93, 'hi');
    expect(path(reqs[1])).toBe('/api/student/getAchievementDetail');
    expect(path(reqs[2])).toBe('/api/saveCommentary');
    expect(body(reqs[2])).toEqual({
      commentaryUserId: 4242,
      taskUserRelationIds: [8],
      distributioType: 1,
      taskId: 31,
      content: 'hi',
      status: '1',
    });
  });

  it('deleteComment', async () => {
    const { c, reqs } = mk(ok());
    await c.deleteComment(6);
    expect(reqs[0].init.method).toBe('GET');
    expect(path(reqs[0])).toBe('/api/deletedCommentary');
    expect(q(reqs[0])).toEqual({ feedbackId: '6' });
  });
});

describe('notifications', () => {
  it('unreadCount reads unreadTotal, 0 when absent', async () => {
    const { c, reqs } = mk(ok({ unreadTotal: 3 }), ok(null), ok({ unreadTotal: '2' }));
    expect(await c.unreadCount()).toBe(3);
    expect(path(reqs[0])).toBe('/api/messageCenter/count');
    expect(await c.unreadCount()).toBe(0);
    expect(await c.unreadCount()).toBe(2);
  });

  it('notifications posts to the message service and accepts status:true code:1001', async () => {
    const page = { pageNum: 1, total: 1, data: [{ messageId: 1 }] };
    const { c, reqs } = mk({ json: { status: true, code: 1001, content: page } });
    expect(await c.notifications(false, 1, 20)).toEqual(page);
    expect(path(reqs[0])).toBe('/message/api/messageCenter/v2/page');
    expect(body(reqs[0])).toEqual({ pageNo: 1, pageSize: 20, read: false });
  });

  it('notifications also accepts code 0 and a bare status:true', async () => {
    const { c } = mk(ok({ a: 1 }), { json: { status: true, content: { b: 2 } } }, { json: { code: 0, content: null } });
    expect(await c.notifications(true, 1, 20)).toEqual({ a: 1 });
    expect(await c.notifications(true, 1, 20)).toEqual({ b: 2 });
    expect(await c.notifications(true, 1, 20)).toEqual({});
  });

  it('notifications rejects an expired session, a failed code and status:false', async () => {
    for (const json of [
      { status: true, code: 1001, unauthorized: true },
      { code: 1000, ifLogin: false },
      { code: 500, status: true },
      { code: 1001, status: false },
      { message: 'x' },
    ]) {
      const { c } = mk({ json });
      await expect(c.notifications(false, 1, 20)).rejects.toBeInstanceOf(YunguError);
    }
  });

  it('markNotificationRead posts the id and returns the envelope', async () => {
    const env = { status: true, code: 1001 };
    const { c, reqs } = mk({ json: env });
    expect(await c.markNotificationRead(12)).toEqual(env);
    expect(path(reqs[0])).toBe('/api/messageCenter/read');
    expect(body(reqs[0])).toEqual({ ids: [12] });
  });
});

describe('behaviour and calendar', () => {
  it('behaviourTotal returns the first row, with the own id and referer', async () => {
    const { c, reqs } = mk(USER, ok([{ score: 10 }]));
    expect(await c.behaviourTotal('2026-09-01', '2026-11-24')).toEqual({ score: 10 });
    expect(path(reqs[1])).toBe('/calendar/api/statistics/stu/detail');
    expect(q(reqs[1])).toEqual({ queryType: '2', startTime: '2026-09-01', endTime: '2026-11-24', stuId: '4242' });
    expect(hdr(reqs[1]).Referer).toBe(`${BASE}/`);
  });

  it('behaviourTotal raises when there is no row', async () => {
    for (const content of [[], null, ['x']]) {
      const { c } = mk(USER, ok(content));
      await expect(c.behaviourTotal('a', 'b')).rejects.toBeInstanceOf(YunguError);
    }
  });

  it('behaviourRecords posts the full filter body', async () => {
    const { c, reqs } = mk(USER, ok({ total: 1, data: [{ id: 1 }] }), ok(null));
    expect(await c.behaviourRecords('2026-09-01', '2026-11-24', 2, 50)).toEqual({ total: 1, data: [{ id: 1 }] });
    expect(path(reqs[1])).toBe('/calendar/api/statistics/allStu/behavior');
    expect(body(reqs[1])).toEqual({
      pageNum: 2,
      pageSize: 50,
      startDay: '2026-09-01',
      endDay: '2026-11-24',
      stage: 4,
      stuId: 4242,
      calculationBehaviorId: '',
      onlyViewUserRecords: false,
      onlyRevoke: false,
      behaviorTypeIds: [],
      punishmentIdList: [],
      earlyWarningIdList: [],
      tierList: [],
    });
    expect(hdr(reqs[1]).Referer).toBe(`${BASE}/`);
    expect(await c.behaviourRecords('a', 'b', 1, 50)).toEqual({ total: 0, data: [] });
  });

  it('calendarWeek queries the week window', async () => {
    const s = 1_763_913_600_000;
    const { c, reqs } = mk(ok([[], [], [], [], [], [], []]));
    expect(await c.calendarWeek(s)).toHaveLength(7);
    expect(path(reqs[0])).toBe('/calendar/api/personal/schdedule/templateForPc');
    expect(q(reqs[0])).toEqual({ weekNumber: '1', queryStartTime: String(s), queryEndTime: String(s + 604799999) });
    expect(hdr(reqs[0]).Referer).toBe(`${BASE}/newSchoolCalendar/`);
  });
});
