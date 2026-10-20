// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSession } from '../session-cookie';
import { AssignmentNotFound, CommentNotFound, DocumentHandedIn, DocumentTooLong, ServiceError, SessionEnded, YunguUnavailable } from './errors';

const request = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined),
  }),
  headers: async () => request.headers,
}));

import { READ_TIMEOUT_MS, REFRESH_COOKIE, UPLOAD_TIMEOUT_MS, WRITE_TIMEOUT_MS, serviceData as data } from './service';

const PASSWORD_CHANGED = 'Sign in again — your Yungu password may have changed.';
const UNAVAILABLE = "Can't reach Yungu right now. Try again.";
const fetchMock = vi.fn<typeof fetch>();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const empty = (status = 204) => new Response(null, { status });
const reply = (res: Response) => fetchMock.mockResolvedValueOnce(res);

/** The nth fetch call as [url, method, headers, init]. */
function call(n = 0) {
  const [url, init = {}] = fetchMock.mock.calls[n];
  return { url: String(url), method: init.method ?? 'GET', headers: new Headers(init.headers), init };
}
const bodyOf = (n = 0) => JSON.parse(String(call(n).init.body));

beforeEach(() => {
  request.cookies = new Map([['yl_session', encodeSession('Ada', 'tok-123')]]);
  request.headers = new Headers();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('serviceData reads', () => {
  it.each([
    ['getTodo', () => data.getTodo(), '/todo'],
    ['getSubmitted', () => data.getSubmitted(), '/submitted'],
    ['getCourses', () => data.getCourses(), '/courses'],
    ['getWeek', () => data.getWeek(1760889600000), '/week?start=1760889600000'],
  ])('%s GETs %s with the session token and returns the body', async (_name, run, path) => {
    reply(json(200, [{ id: 1 }]));
    expect(await run()).toEqual([{ id: 1 }]);
    const { url, method, headers } = call();
    expect(url).toBe(`http://127.0.0.1:8100${path}`);
    expect(method).toBe('GET');
    expect(headers.get('authorization')).toBe('Bearer tok-123');
    expect(headers.get('x-refresh')).toBeNull();
    expect(call().init.cache).toBe('no-store');
  });

  it('uses YUNGU_API_URL when set', async () => {
    vi.stubEnv('YUNGU_API_URL', 'http://10.0.0.5:9000/');
    reply(json(200, []));
    await data.getTodo();
    expect(call().url).toBe('http://10.0.0.5:9000/todo');
  });

  it('forwards X-Refresh: 1 when the request carries the yl_refresh cookie', async () => {
    expect(REFRESH_COOKIE).toBe('yl_refresh');
    request.cookies.set('yl_refresh', '1');
    reply(json(200, []));
    await data.getTodo();
    expect(call().headers.get('x-refresh')).toBe('1');
  });

  it('forwards X-Refresh: 1 when the request carries the X-Refresh header', async () => {
    request.headers = new Headers({ 'x-refresh': '1' });
    reply(json(200, []));
    await data.getCourses();
    expect(call().headers.get('x-refresh')).toBe('1');
  });

  it('throws SessionEnded without calling the service when there is no session cookie', async () => {
    request.cookies = new Map();
    await expect(data.getTodo()).rejects.toEqual(new SessionEnded('Sign in again.'));
    request.cookies.set('yl_session', 'garbage');
    await expect(data.getTodo()).rejects.toBeInstanceOf(SessionEnded);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('serviceData errors', () => {
  it('maps a 401 to SessionEnded carrying the service message', async () => {
    reply(json(401, { error: 'Sign in again.' }));
    const plain = await data.getTodo().catch((e: unknown) => e);
    expect(plain).toBeInstanceOf(SessionEnded);
    expect(plain).toMatchObject({ status: 401, message: 'Sign in again.' });

    reply(json(401, { error: PASSWORD_CHANGED }));
    await expect(data.getSubmitted()).rejects.toMatchObject({ name: 'SessionEnded', message: PASSWORD_CHANGED });
  });

  it('maps a 502 to YunguUnavailable carrying the service message', async () => {
    reply(json(502, { error: UNAVAILABLE }));
    const error = await data.getWeek(0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(YunguUnavailable);
    expect(error).toMatchObject({ status: 502, message: UNAVAILABLE });
  });

  it('treats an unreachable service, another 5xx or a non-JSON body as YunguUnavailable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(data.getTodo()).rejects.toEqual(new YunguUnavailable(UNAVAILABLE));
    reply(new Response('<html>Bad gateway</html>', { status: 500 }));
    await expect(data.getTodo()).rejects.toEqual(new YunguUnavailable(UNAVAILABLE));
    reply(new Response('not json', { status: 200 }));
    await expect(data.getTodo()).rejects.toEqual(new YunguUnavailable(UNAVAILABLE));
  });

  it('passes other statuses through as ServiceError with the service message', async () => {
    reply(json(400, { error: 'Bad request.' }));
    const error = await data.getWeek(-1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).not.toBeInstanceOf(YunguUnavailable);
    expect(error).toMatchObject({ status: 400, message: 'Bad request.' });
  });
});

describe('serviceData timeouts: a stalled Yungu or a hung service is "Can\'t reach Yungu", not minutes of waiting', () => {
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  let asked: number[];
  let spy: { mockRestore(): void };
  beforeEach(() => {
    asked = [];
    // Every budget is shortened to 5 ms; `asked` keeps the budget each call really set.
    spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      asked.push(ms);
      return realTimeout(5);
    });
  });
  afterEach(() => spy.mockRestore());

  /** A service that never answers but gives up when the request is aborted, as fetch does. */
  const hang = () =>
    fetchMock.mockImplementation(
      (_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))),
    );

  it('the budgets: 45 s to read, 90 s to write, 5 min to upload', () => {
    expect([READ_TIMEOUT_MS, WRITE_TIMEOUT_MS, UPLOAD_TIMEOUT_MS]).toEqual([45_000, 90_000, 300_000]);
  });

  it.each([
    ['getTodo', () => data.getTodo()],
    ['getSubmitted', () => data.getSubmitted()],
    ['getWeek', () => data.getWeek(0)],
    ['getCourses', () => data.getCourses()],
    ['getAssignmentDetail', () => data.getAssignmentDetail(93251)],
    ['getFile', () => data.getFile('1')],
  ])('%s gives up after the read budget with YunguUnavailable', async (_name, run) => {
    hang();
    await expect(run()).rejects.toEqual(new YunguUnavailable(UNAVAILABLE));
    expect(asked).toEqual([READ_TIMEOUT_MS]);
    expect(call().init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['saveDraft', () => data.saveDraft(93251, ['1'])],
    ['submit', () => data.submit(93251, ['1'])],
    ['addComment', () => data.addComment(93251, 'x')],
    ['deleteComment', () => data.deleteComment(93251, '2')],
    ['createOnlineDoc', () => data.createOnlineDoc(93251, 'T', '{"ops":[]}')],
    ['updateOnlineDoc', () => data.updateOnlineDoc(93251, '11138501', 'T', '{"ops":[]}')],
    ['refresh', () => data.refresh()],
    ['signOut', () => data.signOut('tok')],
  ])('%s gives up after the longer write budget with YunguUnavailable', async (_name, run) => {
    hang();
    await expect(run()).rejects.toEqual(new YunguUnavailable(UNAVAILABLE));
    expect(asked).toEqual([WRITE_TIMEOUT_MS]);
  });

  it('signIn gives up after the write budget with the sign-in form\'s "Can\'t reach Yungu"', async () => {
    hang();
    expect(await data.signIn('S1', 'pw')).toEqual({ ok: false, error: UNAVAILABLE });
    expect(asked).toEqual([WRITE_TIMEOUT_MS]);
  });

  it('uploadFile gives up after the upload budget', async () => {
    hang();
    await expect(data.uploadFile('a.pdf', 'application/pdf', new Uint8Array([1]))).rejects.toEqual(new YunguUnavailable(UNAVAILABLE));
    expect(asked).toEqual([UPLOAD_TIMEOUT_MS]);
  });

  it('a body that stops arriving times out too', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const stalled = new ReadableStream({ start: (c) => init?.signal?.addEventListener('abort', () => c.error(init.signal!.reason)) });
      return new Response(stalled, { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await expect(data.getTodo()).rejects.toEqual(new YunguUnavailable(UNAVAILABLE));
  });
});

describe('serviceData.getAssignmentDetail', () => {
  const detail = { id: 93251, title: 'T', instructionsHtml: '<p>Read <b>this</b></p>', comments: [] };

  it('GETs /assignments/<id> and returns the detail', async () => {
    reply(json(200, detail));
    expect(await data.getAssignmentDetail(93251)).toEqual(detail);
    expect(call().url).toBe('http://127.0.0.1:8100/assignments/93251');
    expect(call().headers.get('authorization')).toBe('Bearer tok-123');
  });

  it('sanitizes the raw Yungu instructions HTML', async () => {
    reply(json(200, { ...detail, instructionsHtml: '<p onclick="x()">Hi</p><script>alert(1)</script><img src="https://a/b.png" onerror="alert(2)">' }));
    const got = await data.getAssignmentDetail(93251);
    expect(got?.instructionsHtml).toBe('<p>Hi</p><img src="https://a/b.png" />');
    expect(got?.instructionsHtml).not.toMatch(/script|onerror|onclick/);
  });

  it('returns null on a 404 (unknown id)', async () => {
    reply(json(404, { error: 'Not found.' }));
    expect(await data.getAssignmentDetail(999999999)).toBeNull();
  });

  it('still throws on 401 and 502', async () => {
    reply(json(401, { error: 'Sign in again.' }));
    await expect(data.getAssignmentDetail(1)).rejects.toBeInstanceOf(SessionEnded);
    reply(json(502, { error: UNAVAILABLE }));
    await expect(data.getAssignmentDetail(1)).rejects.toBeInstanceOf(YunguUnavailable);
  });
});

describe('serviceData files', () => {
  const ref = { id: '777', name: '作业 一（终稿）.pdf', mime: 'application/pdf', size: 3, kind: 'pdf', url: '/api/files/777', createdAt: 1 };

  it('uploads as multipart with the name, type and bytes verbatim', async () => {
    reply(json(200, ref));
    const got = await data.uploadFile('作业 一（终稿）.pdf', 'application/pdf', new Uint8Array([1, 2, 3]));
    expect(got).toEqual(ref);
    const { url, method, headers, init } = call();
    expect(url).toBe('http://127.0.0.1:8100/files');
    expect(method).toBe('POST');
    expect(headers.get('authorization')).toBe('Bearer tok-123');
    expect(init.body).toBeInstanceOf(FormData);
    // Serialise the body as fetch would, then parse it back as the service does.
    const wire = new Request('http://x/', { method: 'POST', body: init.body as FormData });
    expect(await wire.clone().text()).toContain('filename="作业 一（终稿）.pdf"');
    const file = (await wire.formData()).get('file') as File;
    expect(file.name).toBe('作业 一（终稿）.pdf');
    expect(file.type).toBe('application/pdf');
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('passes the service 413 through', async () => {
    reply(json(413, { error: 'Files up to 50 MB.' }));
    const error = await data.uploadFile('big.bin', 'application/octet-stream', new Uint8Array(1)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 413, message: 'Files up to 50 MB.' });
  });

  it('getFile asks for the download link by default and the preview link on request', async () => {
    reply(json(200, { redirect: 'https://oss.example/a?sig=1' }));
    expect(await data.getFile('777')).toEqual({ redirect: 'https://oss.example/a?sig=1' });
    expect(call(0).url).toBe('http://127.0.0.1:8100/files/777?preview=0');
    reply(json(200, { redirect: 'https://oss.example/p' }));
    expect(await data.getFile('777', { preview: true })).toEqual({ redirect: 'https://oss.example/p' });
    expect(call(1).url).toBe('http://127.0.0.1:8100/files/777?preview=1');
    expect(call(1).headers.get('authorization')).toBe('Bearer tok-123');
  });

  it("getFile passes the service's 422 for an online document through with its message", async () => {
    reply(json(422, { error: 'Open this online document on Yungu.' }));
    const error = await data.getFile('11117133').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).not.toBeInstanceOf(YunguUnavailable);
    expect(error).toMatchObject({ status: 422, message: 'Open this online document on Yungu.' });
  });

  it('getFile encodes the id and returns null on a 404', async () => {
    reply(json(404, { error: 'Not found.' }));
    expect(await data.getFile('a/b?c')).toBeNull();
    expect(call().url).toBe('http://127.0.0.1:8100/files/a%2Fb%3Fc?preview=0');
  });
});

describe('serviceData writes', () => {
  it('saveDraft PUTs the file ids', async () => {
    reply(empty());
    await data.saveDraft(93251, ['1', '2']);
    expect(call()).toMatchObject({ url: 'http://127.0.0.1:8100/assignments/93251/draft', method: 'PUT' });
    expect(call().headers.get('content-type')).toBe('application/json');
    expect(call().headers.get('authorization')).toBe('Bearer tok-123');
    expect(bodyOf()).toEqual({ fileIds: ['1', '2'] });
  });

  it('submit POSTs the file ids and returns submittedAt', async () => {
    reply(json(200, { submittedAt: 1760900000000 }));
    expect(await data.submit(93251, ['1'])).toEqual({ submittedAt: 1760900000000 });
    expect(call()).toMatchObject({ url: 'http://127.0.0.1:8100/assignments/93251/submit', method: 'POST' });
    expect(bodyOf()).toEqual({ fileIds: ['1'] });
  });

  it('addComment POSTs the text and returns the comment', async () => {
    const comment = { id: '55', author: 'Ada', text: '你好', at: 1, mine: true };
    reply(json(200, comment));
    expect(await data.addComment(93251, '你好')).toEqual(comment);
    expect(call()).toMatchObject({ url: 'http://127.0.0.1:8100/assignments/93251/comments', method: 'POST' });
    expect(bodyOf()).toEqual({ text: '你好' });
  });

  it('deleteComment DELETEs the encoded comment id', async () => {
    reply(empty());
    await data.deleteComment(93251, '55/x');
    expect(call()).toMatchObject({ url: 'http://127.0.0.1:8100/assignments/93251/comments/55%2Fx', method: 'DELETE' });
  });

  it.each([
    ['saveDraft', () => data.saveDraft(1, [])],
    ['submit', () => data.submit(1, ['1'])],
    ['addComment', () => data.addComment(1, 'x')],
    ['deleteComment', () => data.deleteComment(1, '2')],
  ])('%s turns a 404 (unknown assignment) into AssignmentNotFound', async (_name, run) => {
    reply(json(404, { error: 'Not found.' }));
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AssignmentNotFound);
    expect(error).toMatchObject({ status: 404 });
  });

  it("deleteComment turns the service's 404 for a comment that is not mine into CommentNotFound", async () => {
    reply(json(404, { error: 'Comment not found.' }));
    const error = await data.deleteComment(93251, '327995').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommentNotFound);
    expect(error).toMatchObject({ status: 404, message: 'Comment not found' });
  });

  it('writes never send X-Refresh', async () => {
    request.cookies.set('yl_refresh', '1');
    reply(empty());
    await data.saveDraft(1, []);
    expect(call().headers.get('x-refresh')).toBeNull();
  });

  it('refresh POSTs /refresh with the session token', async () => {
    reply(empty());
    await data.refresh();
    expect(call()).toMatchObject({ url: 'http://127.0.0.1:8100/refresh', method: 'POST' });
    expect(call().headers.get('authorization')).toBe('Bearer tok-123');
  });
});

describe('serviceData online documents and Mark as submitted', () => {
  const DELTA = '{"ops":[{"insert":"研究 \\"quoted\\"\\n"}]}';
  const doc = { id: '11138501', name: '研究测试', kind: 'other', mime: 'application/octet-stream', size: 0, url: '/api/files/11138501', createdAt: 5, online: true, content: DELTA };

  it('createOnlineDoc POSTs the title and content verbatim and returns the FileRef', async () => {
    reply(json(200, doc));
    expect(await data.createOnlineDoc(93251, '研究测试', DELTA)).toEqual(doc);
    expect(call()).toMatchObject({ url: 'http://127.0.0.1:8100/assignments/93251/online-docs', method: 'POST' });
    expect(call().headers.get('content-type')).toBe('application/json');
    expect(call().headers.get('authorization')).toBe('Bearer tok-123');
    expect(call().headers.get('x-refresh')).toBeNull();
    expect(bodyOf()).toEqual({ title: '研究测试', content: DELTA });
  });

  it('updateOnlineDoc PUTs to the encoded document id and returns the FileRef', async () => {
    reply(json(200, doc));
    expect(await data.updateOnlineDoc(93251, '11138501', '研究测试', DELTA)).toEqual(doc);
    expect(call()).toMatchObject({ url: 'http://127.0.0.1:8100/assignments/93251/online-docs/11138501', method: 'PUT' });
    expect(bodyOf()).toEqual({ title: '研究测试', content: DELTA });
    reply(json(200, doc));
    await data.updateOnlineDoc(93251, 'a/b?c', 'x', DELTA);
    expect(call(1).url).toBe('http://127.0.0.1:8100/assignments/93251/online-docs/a%2Fb%3Fc');
  });

  it.each([
    ['createOnlineDoc', () => data.createOnlineDoc(93251, 'T', DELTA)],
    ['updateOnlineDoc', () => data.updateOnlineDoc(93251, '1', 'T', DELTA)],
  ])("%s passes the service's 400, 413 and 502 through with their messages", async (_name, run) => {
    reply(json(400, { error: 'Give the document a title.' }));
    const blank = await run().catch((e: unknown) => e);
    expect(blank).toBeInstanceOf(ServiceError);
    expect(blank).toMatchObject({ status: 400, message: 'Give the document a title.' });

    reply(json(413, { error: 'Too long for Yungu — cut about 155 characters.' }));
    const long = await run().catch((e: unknown) => e);
    expect(long).toBeInstanceOf(DocumentTooLong);
    expect(long).toMatchObject({ status: 413, message: 'Too long for Yungu — cut about 155 characters.' });

    reply(json(502, { error: "Yungu couldn't save the document. Try again." }));
    const refused = await run().catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(YunguUnavailable);
    expect(refused).toMatchObject({ status: 502, message: "Yungu couldn't save the document. Try again." });

    reply(json(404, { error: 'Not found.' }));
    expect(await run().catch((e: unknown) => e)).toBeInstanceOf(AssignmentNotFound);
  });

  it("updateOnlineDoc turns the service's 409 for a handed-in document into DocumentHandedIn with its message", async () => {
    reply(json(409, { error: 'This document was handed in — save it as a new one.' }));
    const error = await data.updateOnlineDoc(93251, '11138501', 'T', DELTA).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocumentHandedIn);
    expect(error).toMatchObject({ status: 409, message: 'This document was handed in — save it as a new one.' });
  });

  it('submit sends an empty list as is (Mark as submitted) and returns submittedAt', async () => {
    reply(json(200, { submittedAt: 1760900000000 }));
    expect(await data.submit(95257, [])).toEqual({ submittedAt: 1760900000000 });
    expect(call()).toMatchObject({ url: 'http://127.0.0.1:8100/assignments/95257/submit', method: 'POST' });
    expect(bodyOf()).toEqual({ fileIds: [] });
  });

  it("submit passes the service's 400 and unconfirmed 502 through with their messages", async () => {
    reply(json(400, { error: 'Add at least one file.' }));
    await expect(data.submit(95257, [])).rejects.toMatchObject({ name: 'ServiceError', status: 400, message: 'Add at least one file.' });
    reply(json(502, { error: "Yungu didn't confirm the hand-in. Check on Yungu." }));
    const error = await data.submit(95257, []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(YunguUnavailable);
    expect(error).toMatchObject({ status: 502, message: "Yungu didn't confirm the hand-in. Check on Yungu." });
  });
});

describe('serviceData sessions', () => {
  it('signIn POSTs the credentials without a token and returns the new token', async () => {
    request.cookies = new Map();
    reply(json(200, { ok: true, displayName: 'Bruce Zheng', token: 'new-tok' }));
    expect(await data.signIn('170104022', 'pw')).toEqual({ ok: true, displayName: 'Bruce Zheng', token: 'new-tok' });
    expect(call()).toMatchObject({ url: 'http://127.0.0.1:8100/session', method: 'POST' });
    expect(call().headers.get('authorization')).toBeNull();
    expect(bodyOf()).toEqual({ loginId: '170104022', password: 'pw' });
  });

  it("signIn returns Yungu's refusal as a sign-in error", async () => {
    reply(json(200, { ok: false, error: '用户名或密码错误' }));
    expect(await data.signIn('170104022', 'bad')).toEqual({ ok: false, error: '用户名或密码错误' });
  });

  it('signIn shows "Can\'t reach Yungu" as a sign-in error on a 502 or an unreachable service', async () => {
    reply(json(502, { ok: false, error: UNAVAILABLE }));
    expect(await data.signIn('170104022', 'pw')).toEqual({ ok: false, error: UNAVAILABLE });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await data.signIn('170104022', 'pw')).toEqual({ ok: false, error: UNAVAILABLE });
  });

  it('signOut DELETEs /session with the given token', async () => {
    reply(empty());
    await data.signOut('old-tok');
    expect(call()).toMatchObject({ url: 'http://127.0.0.1:8100/session', method: 'DELETE' });
    expect(call().headers.get('authorization')).toBe('Bearer old-tok');
  });

  it('signOut treats a 401 (session already gone) as done, but a 502 as a failure', async () => {
    reply(json(401, { error: 'Sign in again.' }));
    await expect(data.signOut('old-tok')).resolves.toBeUndefined();
    reply(json(502, { error: UNAVAILABLE }));
    await expect(data.signOut('old-tok')).rejects.toBeInstanceOf(YunguUnavailable);
  });
});

describe('DATA_SOURCE', () => {
  const load = async () => {
    vi.resetModules();
    const [{ data: selected }, { mockData }, { serviceData }] = await Promise.all([
      import('./index'),
      import('./mock'),
      import('./service'),
    ]);
    return { selected, mockData, serviceData };
  };

  it('is forced to mock in the test run', async () => {
    expect(process.env.DATA_SOURCE).toBe('mock');
    const { selected, mockData } = await load();
    expect(selected).toBe(mockData);
  });

  it('selects the service for "service" and by default', async () => {
    vi.stubEnv('DATA_SOURCE', 'service');
    let got = await load();
    expect(got.selected).toBe(got.serviceData);
    vi.stubEnv('DATA_SOURCE', undefined);
    got = await load();
    expect(got.selected).toBe(got.serviceData);
  });

  it('refuses an unknown value', async () => {
    vi.stubEnv('DATA_SOURCE', 'Mock ');
    await expect(load()).rejects.toThrow(/DATA_SOURCE/);
  });
});
