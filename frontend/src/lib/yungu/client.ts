import { constants, createHash, createPublicKey, publicEncrypt, randomUUID } from 'node:crypto';
import { CookieJar, YunguError, sessionExpired, type Fetch } from './http';
import { ossPut, type Sts } from './oss';
import { isSuspension, Suspended } from '../data/errors';

export const LOGIN = 'https://login.yungu.org';
export const BASE = 'https://task.yungu.org';
export const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

/** getAllTasks?inCludeTaskStatus= */
export const TODO = 0;
export const SUBMITTED = 2;
export const ACHIEVEMENT_NOT_SUBMITTED = 1;
export const ACHIEVEMENT_SUBMITTED = 4;
/** Stored delta JSON, UTF-8 bytes; one more and Yungu answers HTTP 200 code 1008. */
export const ONLINE_DOC_MAX_BYTES = 65535;

const ROLE_STUDENT = 2;
const BEHAVIOUR_STAGE = 4; // 高中 (high school)
const WEEK_MS = 7 * 86_400_000;
const MAX_HOPS = 5;

export type YunguUser = { userId: number; userName: string; eName?: string; studentNo?: string };

type ApiOpts = {
  params?: Record<string, string | number | boolean>;
  json?: unknown;
  base?: string;
  referer?: string;
  check?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ok?: (b: any) => boolean;
};

/** Raw task row of getAllTasks, plus the `group` iterTasks adds. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawTask = Record<string, any> & { group: string };

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

/** Success in either envelope the message endpoints use: `code: 0`, or the message service's `status: true` (code 1001). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function messageOk(j: any): boolean {
  if (typeof j !== 'object' || j === null || sessionExpired(j)) return false;
  if (j.code !== undefined && j.code !== null) return (j.code === 0 || j.code === 1001) && j.status !== false;
  return j.status === true;
}

export class YunguClient {
  private jar = new CookieJar();
  private user: YunguUser | null = null;
  private timeoutMs: number;
  private now: () => number;

  constructor(
    private loginId: string,
    private password: string,
    private fetch: Fetch,
    opts: { timeoutMs?: number; now?: () => number } = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  /** One request, cookies in and out, never following redirects. */
  private async send(method: string, url: string, headers: Record<string, string>, body?: string): Promise<Response> {
    const h: Record<string, string> = { 'User-Agent': UA, ...headers };
    const cookie = this.jar.header(url);
    if (cookie) h.Cookie = cookie;
    let res: Response;
    try {
      res = await this.fetch(url, {
        method,
        headers: h,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      if (isSuspension(e)) throw new Suspended();
      throw new YunguError(`${method} ${new URL(url).pathname} -> ${e instanceof Error ? e.message : String(e)}`);
    }
    this.jar.store(url, res);
    return res;
  }

  /** The absolute URL a redirect points at, or undefined without a (valid) Location header. */
  private location(res: Response, from: string): string | undefined {
    const loc = res.headers.get('location');
    if (!loc) return undefined;
    try {
      return new URL(loc, from).toString();
    } catch {
      return undefined;
    }
  }

  /** GET that follows redirects like Python's `requests` (up to 5 hops), storing cookies at each hop. */
  private async get(url: string, headers: Record<string, string> = {}): Promise<Response> {
    let res = await this.send('GET', url, headers);
    for (let hop = 0; hop < MAX_HOPS && res.status >= 300 && res.status < 400; hop++) {
      const loc = res.headers.get('location');
      if (!loc) break;
      url = new URL(loc, url).toString();
      res = await this.send('GET', url, headers);
    }
    return res;
  }

  /** CAS login. Password is RSA(PKCS1 v1.5, server public key) of {password: md5, timestamp, nonce}. */
  async login(): Promise<YunguUser> {
    this.jar.clear();
    this.user = null;
    const ref = `${LOGIN}/cas/login?service=${encodeURIComponent(BASE + '/')}`;
    await this.get(ref);
    const h = { Referer: ref, Accept: 'application/json' };
    await this.get(`${LOGIN}/api/getStudentLoginId?name=${encodeURIComponent(this.loginId)}`, h);
    const kr = await this.get(`${LOGIN}/cas/getPublicKey`, h);
    let key: { content?: string };
    try {
      key = await kr.json();
    } catch {
      throw new YunguError(`login: HTTP ${kr.status}, no public key`, { status: kr.status });
    }
    if (!key.content) throw new YunguError('login: no public key', { status: kr.status, body: key });
    const plain = JSON.stringify({
      password: createHash('md5').update(this.password).digest('hex'),
      timestamp: this.now(),
      nonce: randomUUID(),
    });
    const enc = publicEncrypt(
      {
        key: createPublicKey({ key: Buffer.from(key.content, 'base64'), format: 'der', type: 'spki' }),
        padding: constants.RSA_PKCS1_PADDING,
      },
      Buffer.from(plain),
    ).toString('base64');
    const res = await this.send(
      'POST',
      `${LOGIN}/cas/loginForLoginId`,
      { ...h, 'Content-Type': 'application/json; charset=utf-8' },
      JSON.stringify({
        loginId: this.loginId,
        password: enc,
        type: 'mobile',
        language: 'zhCN',
        role: ROLE_STUDENT,
        eduGroupCompanyId: 1,
        schoolId: 1,
      }),
    );
    let j: { success?: boolean; msg?: string; redirectUrl?: string };
    try {
      j = await res.json();
    } catch {
      throw new YunguError(`login: HTTP ${res.status}, non-JSON response`, { status: res.status });
    }
    if (!j.success || !j.redirectUrl) throw new YunguError(`login failed: ${j.msg || JSON.stringify(j)}`, { status: res.status, body: j });
    const r2 = await this.get(j.redirectUrl);
    if (r2.status !== 200) throw new YunguError(`ticket exchange failed HTTP ${r2.status}`, { status: r2.status });
    this.user = (await this.api('GET', '/api/currentUser')).content as YunguUser;
    return this.user;
  }

  async userId(): Promise<number> {
    if (!this.user) this.user = (await this.api('GET', '/api/currentUser')).content as YunguUser;
    return this.user.userId;
  }

  /**
   * One JSON call. `check` raises YunguError unless the envelope succeeded: `code === 0`, or `ok(body)` when
   * given (the message service answers `status: true, code: 1001`).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async api(method: 'GET' | 'POST', path: string, opts: ApiOpts = {}): Promise<any> {
    const { params, json, base = BASE, referer = BASE + '/umiTask', check = true, ok } = opts;
    let url = base + path;
    if (params) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) q.set(k, String(v));
      url += (path.includes('?') ? '&' : '?') + q.toString();
    }
    const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*', Referer: referer };
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.send(method, url, headers, json === undefined ? undefined : JSON.stringify(json));
    if (res.status !== 200) {
      const redirect = res.status >= 300 && res.status < 400 ? this.location(res, url) : undefined;
      let errBody: unknown;
      if (redirect === undefined && !(res.status >= 300 && res.status < 400)) {
        try {
          errBody = await res.json(); // best effort: a 401/403/5xx may still say `ifLogin: false`
        } catch {
          errBody = undefined;
        }
      }
      throw new YunguError(`${method} ${path} -> HTTP ${res.status}`, { status: res.status, body: errBody, redirect });
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new YunguError(`${method} ${path} -> non-JSON response`, { status: res.status });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = body as any;
    if (check && !(ok ? ok(b) : typeof b === 'object' && b !== null && b.code === 0)) {
      const d = typeof b === 'object' && b !== null ? b : {};
      throw new YunguError(`${method} ${path} -> code=${d.code} message=${d.message}`, { status: res.status, body });
    }
    return body;
  }

  // ----------------------------------------------------------- assignments
  // Everything below ports api/yungu_task.py one-for-one; payloads stay raw (`any`).

  /* eslint-disable @typescript-eslint/no-explicit-any */
  async courses(): Promise<any[]> {
    return (await this.api('GET', '/api/my/currentCourses')).content.data;
  }

  /** Raw getAllTasks content: {pageSize, pageNum, total, data: [{groupName, count, taskList}]}. */
  async listTasks(status: number, page: number, pageSize: number): Promise<any> {
    const params: Record<string, string | number> = {
      courseId: '',
      includeContentLike: '',
      inCludeTaskStatus: status,
      pageNum: page,
      pageSize,
    };
    if (status === TODO) params.sortType = 2; // the UI sends it on the To-do tab only
    return (await this.api('GET', '/api/getAllTasks', { params })).content;
  }

  /** Every task of a tab, flattened, each tagged with its group name. */
  async iterTasks(status: number, pageSize: number): Promise<RawTask[]> {
    const out: RawTask[] = [];
    for (let page = 1; ; page++) {
      const c = await this.listTasks(status, page, pageSize);
      for (const g of c.data ?? []) for (const t of g.taskList ?? []) out.push({ ...t, group: g.groupName });
      if (!c.data?.length || out.length >= c.total) return out;
    }
  }

  async taskDetail(publishId: number): Promise<any> {
    return (await this.api('GET', '/api/getMixedPublishDetail', { params: { taskPublishId: publishId } })).content;
  }

  private async achievementBody(publishId: number) {
    return {
      distributionType: 1,
      ifPc: true,
      studentId: await this.userId(),
      taskPublishId: String(publishId),
      teamId: null,
    };
  }

  /** My submission state: taskUserRelationId, achievementId, achievementStatus, fileModelList, courseId, ... */
  async achievement(publishId: number): Promise<any> {
    return (await this.api('POST', '/api/student/getAchievementDetail', { json: await this.achievementBody(publishId) })).content;
  }

  /** Signed OSS URL: the Location of the 302 from preview_file (preview) or new_download_file. */
  async fileRedirect(fileId: number, preview: boolean): Promise<string> {
    const path = preview ? '/api/preview_file' : '/api/new_download_file';
    const url = `${BASE}${path}?id=${fileId}`;
    const res = await this.send('GET', url, { Referer: BASE + '/umiTask' });
    if (res.status !== 302) throw new YunguError(`${path}?id=${fileId} -> HTTP ${res.status}`, { status: res.status });
    const loc = this.location(res, url);
    if (!loc) throw new YunguError(`${path}?id=${fileId} -> 302 without Location`, { status: 302 });
    return loc;
  }

  // ---------------------------------------------------------------- upload
  /** 1) STS token 2) PUT to OSS 3) register with /api/upload_file/new. Does not attach the file to a task. */
  async uploadBytes(name: string, mime: string, bytes: Uint8Array): Promise<{ fileId: number; fileName: string; raw: any }> {
    const ctype = mime || 'application/octet-stream';
    const sts = (await this.api('GET', '/api/sts/token', { params: { type: 1 } })).content as Sts;
    const ts = this.now();
    const key = `${sts.ossPath}${ts}_${name}`;
    await ossPut(this.fetch, sts, key, bytes, ctype, undefined, Math.max(this.timeoutMs, 300_000));
    const c = (
      await this.api('GET', '/api/upload_file/new', {
        params: {
          fileName: name,
          bucketName: sts.bucketName,
          fileSize: bytes.length,
          fileType: ctype,
          fileUrl: key,
          percent: 100,
          uuid: ts,
        },
      })
    ).content;
    return { fileId: c.fileId, fileName: c.fileName, raw: c };
  }

  // ------------------------------------------------------ draft / submission
  /** Overwrite the draft file list (empty list = delete everything). */
  async saveDraft(relationId: number, fileIds: number[]): Promise<any> {
    return this.api('GET', '/api/student/submitAchievementForDrafts', {
      params: { taskUserRelationId: relationId, fileIds: fileIds.join(',') },
    });
  }

  /** First submit, or re-submit after Edit when an achievementId exists. */
  async submit(publishId: number, fileIds: number[]): Promise<any> {
    const a = await this.achievement(publishId);
    const body = {
      courseId: a.courseId,
      fileList: [...fileIds],
      studentIds: [await this.userId()],
      teamList: null,
      taskPublishId: publishId,
      taskUserRelationId: a.taskUserRelationId,
      textStatus: a.textStatus || 0,
    };
    if (a.achievementId) {
      return this.api('POST', '/api/updateAchievementAndSendMessage', { json: { achievementId: a.achievementId, ...body } });
    }
    return this.api('POST', '/api/submitAchievementSendMessage', { json: body });
  }

  // ------------------------------------------------------- online documents
  /** The delta is Quill JSON, sent as base64 of its UTF-8 bytes. Returns Yungu's `content`. */
  async createOnlineDoc(title: string, deltaJson: string): Promise<any> {
    return (await this.api('POST', '/api/upload_onlineDocument', { json: { title, description: b64(deltaJson), base64Convert: true } })).content;
  }

  async updateOnlineDoc(fileId: number, title: string, deltaJson: string, achievementId: number | null): Promise<any> {
    return (
      await this.api('POST', '/api/update_onlineDocument', {
        json: { title, description: b64(deltaJson), fileId, achievementId, base64Convert: true },
      })
    ).content;
  }

  /** "Mark as submitted": hand in with no files. `taskId` is the task's id, not taskPublishId. */
  async markSubmitted(taskId: number): Promise<any> {
    return (
      await this.api('POST', '/api/users/taskPublish/status', {
        json: { status: ACHIEVEMENT_SUBMITTED, userIds: [await this.userId()], teamIds: null, taskId },
      })
    ).content;
  }

  // -------------------------------------------------------------- comments
  /** Comments on my work for this task, newest first. */
  async comments(publishId: number): Promise<any[]> {
    return (await this.api('POST', '/api/student/getAchievementDetail/comment', { json: await this.achievementBody(publishId) })).content ?? [];
  }

  async addComment(publishId: number, text: string): Promise<void> {
    const a = await this.achievement(publishId);
    await this.api('POST', '/api/saveCommentary', {
      json: {
        commentaryUserId: await this.userId(),
        taskUserRelationIds: [a.taskUserRelationId],
        distributioType: 1, // spelt that way by Yungu
        taskId: a.taskId,
        content: text,
        status: '1',
      },
    });
  }

  async deleteComment(feedbackId: number): Promise<void> {
    await this.api('GET', '/api/deletedCommentary', { params: { feedbackId } });
  }

  // --------------------------------------------------------- notifications
  async unreadCount(): Promise<number> {
    const c = (await this.api('GET', '/api/messageCenter/count')).content ?? {};
    return Number(c.unreadTotal || 0);
  }

  /** One page, newest first: {pageNum, pageSize, total, data: [item]}. Listing marks nothing read. */
  async notifications(read: boolean, page: number, size: number): Promise<any> {
    const j = await this.api('POST', '/message/api/messageCenter/v2/page', {
      json: { pageNo: page, pageSize: size, read },
      ok: messageOk,
    });
    return j.content ?? {};
  }

  /** Any non-error envelope counts; returns it whole. */
  async markNotificationRead(messageId: number): Promise<any> {
    return this.api('POST', '/api/messageCenter/read', { json: { ids: [messageId] }, ok: messageOk });
  }

  // ------------------------------------------------------ behaviour points
  /** The 凌云积分 card for the window (China dates, inclusive): stu/detail's first row. */
  async behaviourTotal(start: string, end: string): Promise<any> {
    const content = (
      await this.api('GET', '/calendar/api/statistics/stu/detail', {
        params: { queryType: 2, startTime: start, endTime: end, stuId: await this.userId() },
        referer: BASE + '/',
      })
    ).content;
    if (!Array.isArray(content) || content.length === 0 || typeof content[0] !== 'object' || content[0] === null) {
      throw new YunguError('GET /calendar/api/statistics/stu/detail -> no row');
    }
    return content[0];
  }

  /** One page of 记录明细, newest first: {total, data: [row]}. */
  async behaviourRecords(start: string, end: string, page: number, size: number): Promise<any> {
    const content = (
      await this.api('POST', '/calendar/api/statistics/allStu/behavior', {
        json: {
          pageNum: page,
          pageSize: size,
          startDay: start,
          endDay: end,
          stage: BEHAVIOUR_STAGE,
          stuId: await this.userId(),
          calculationBehaviorId: '',
          onlyViewUserRecords: false,
          onlyRevoke: false,
          behaviorTypeIds: [],
          punishmentIdList: [],
          earlyWarningIdList: [],
          tierList: [],
        },
        referer: BASE + '/',
      })
    ).content;
    return typeof content === 'object' && content !== null && !Array.isArray(content) ? content : { total: 0, data: [] };
  }

  // -------------------------------------------------------------- calendar
  /** Seven lists (Mon..Sun) for the week starting at `startMs` (Monday 00:00 UTC+8, ms). */
  async calendarWeek(startMs: number): Promise<any[][]> {
    return (
      await this.api('GET', '/calendar/api/personal/schdedule/templateForPc', {
        params: { weekNumber: 1, queryStartTime: startMs, queryEndTime: startMs + WEEK_MS - 1 },
        referer: BASE + '/newSchoolCalendar/',
      })
    ).content;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
