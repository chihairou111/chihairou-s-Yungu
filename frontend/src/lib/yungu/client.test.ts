import { constants, createHash, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BASE, LOGIN, UA, YunguClient } from './client';
import { Suspended, YunguUnavailable } from '../data/errors';
import { CookieJar, YunguError, sessionExpired, type Fetch } from './http';

type Req = { url: string; init: RequestInit };
type Answer = { status?: number; json?: unknown; headers?: [string, string][] };

/** A scripted Fetch: records each request and answers from a queue. */
function script(...answers: (Answer | ((r: Req) => Answer))[]) {
  const reqs: Req[] = [];
  const fetch: Fetch = async (url, init) => {
    const r = { url, init };
    reqs.push(r);
    const a = answers.shift();
    if (!a) throw new Error(`unexpected request ${init.method} ${url}`);
    const { status = 200, json, headers = [] } = typeof a === 'function' ? a(r) : a;
    return new Response(json === undefined ? null : JSON.stringify(json), {
      status,
      headers: [...headers, ...(json === undefined ? [] : ([['content-type', 'application/json']] as [string, string][]))],
    });
  };
  return { reqs, fetch };
}

const USER = { userId: 4242, userName: 'Test Student', eName: 'Tess', studentNo: '000001' };
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const spki = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const TICKET = `${BASE}/?ticket=ST-1`;

const loginScript = (over: { cas?: Answer; post?: Answer | ((r: Req) => Answer); redirect?: Answer } = {}) => [
  over.cas ?? {},
  { json: { success: true } },
  { json: { content: spki } },
  over.post ?? { json: { success: true, redirectUrl: TICKET } },
  over.redirect ?? {},
  { json: { code: 0, content: USER } },
];

describe('login', () => {
  it('sends the CAS sequence in order', async () => {
    const { reqs, fetch } = script(...loginScript());
    const user = await new YunguClient('s1', 'pw', fetch).login();
    expect(user).toEqual(USER);
    expect(reqs.map((r) => `${r.init.method} ${r.url}`)).toEqual([
      `GET ${LOGIN}/cas/login?service=https%3A%2F%2Ftask.yungu.org%2F`,
      `GET ${LOGIN}/api/getStudentLoginId?name=s1`,
      `GET ${LOGIN}/cas/getPublicKey`,
      `POST ${LOGIN}/cas/loginForLoginId`,
      `GET ${TICKET}`,
      `GET ${BASE}/api/currentUser`,
    ]);
    for (const r of reqs) {
      expect(r.init.redirect).toBe('manual');
      expect((r.init.headers as Record<string, string>)['User-Agent']).toBe(UA);
    }
  });

  it('encrypts {password: md5, timestamp, nonce} with the server key', async () => {
    const { reqs, fetch } = script(...loginScript());
    await new YunguClient('s1', 'pw', fetch, { now: () => 1_700_000_000_123 }).login();
    const body = JSON.parse(reqs[3].init.body as string);
    expect(body).toMatchObject({ loginId: 's1', type: 'mobile', language: 'zhCN', role: 2, eduGroupCompanyId: 1, schoolId: 1 });
    const plain = JSON.parse(
      privateDecrypt({ key: keys.privateKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(body.password, 'base64')).toString(),
    );
    expect(plain.password).toBe(createHash('md5').update('pw').digest('hex'));
    expect(plain.timestamp).toBe(1_700_000_000_123);
    expect(plain.nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((reqs[3].init.headers as Record<string, string>)['Content-Type']).toBe('application/json; charset=utf-8');
  });

  it('carries cookies from the ticket exchange to task.yungu.org', async () => {
    const { reqs, fetch } = script(...loginScript({ redirect: { headers: [['set-cookie', 'SESSION=abc; Path=/']] } }));
    await new YunguClient('s1', 'pw', fetch).login();
    expect((reqs[5].init.headers as Record<string, string>).Cookie).toBe('SESSION=abc');
    expect((reqs[4].init.headers as Record<string, string>).Cookie).toBeUndefined();
  });

  it('follows redirects by hand, storing cookies at each hop', async () => {
    const { reqs, fetch } = script(
      { status: 302, headers: [['location', '/cas/login2'], ['set-cookie', 'JSESSIONID=j1; Path=/cas']] },
      {},
      { json: { success: true } },
      { json: { content: spki } },
      { json: { success: true, redirectUrl: TICKET } },
      { status: 302, headers: [['location', '/umiTask'], ['set-cookie', 'SESSION=s; Path=/']] },
      {},
      { json: { code: 0, content: USER } },
    );
    await new YunguClient('s1', 'pw', fetch).login();
    expect(reqs[1].url).toBe(`${LOGIN}/cas/login2`);
    expect((reqs[1].init.headers as Record<string, string>).Cookie).toBe('JSESSIONID=j1');
    expect(reqs[6].url).toBe(`${BASE}/umiTask`);
    expect((reqs[6].init.headers as Record<string, string>).Cookie).toBe('SESSION=s');
  });

  it('fails with the CAS message', async () => {
    const { fetch } = script(...loginScript({ post: { json: { success: false, msg: '用户名或密码错误' } } }).slice(0, 4));
    const err = await new YunguClient('s1', 'bad', fetch).login().catch((e) => e);
    expect(err).toBeInstanceOf(YunguError);
    expect(err.message).toContain('用户名或密码错误');
  });

  it('fails when the ticket exchange is not 200', async () => {
    const { fetch } = script(...loginScript({ redirect: { status: 500 } }).slice(0, 5));
    await expect(new YunguClient('s1', 'pw', fetch).login()).rejects.toThrow(/ticket exchange failed HTTP 500/);
  });

  it('userId() logs nothing extra once the user is known', async () => {
    const { reqs, fetch } = script(...loginScript());
    const c = new YunguClient('s1', 'pw', fetch);
    await c.login();
    expect(await c.userId()).toBe(4242);
    expect(reqs).toHaveLength(6);
  });
});

describe('api', () => {
  it('raises on a non-zero code and on non-200', async () => {
    const { fetch } = script({ json: { code: 5, message: 'nope' } }, { status: 500 });
    const c = new YunguClient('s1', 'pw', fetch);
    const e1 = await c.api('GET', '/api/x').catch((e) => e);
    expect(e1).toBeInstanceOf(YunguError);
    expect(e1.message).toContain('code=5 message=nope');
    expect(e1.body).toEqual({ code: 5, message: 'nope' });
    const e2 = await c.api('GET', '/api/x').catch((e) => e);
    expect(e2.status).toBe(500);
  });

  it('accepts ok() envelopes and check:false', async () => {
    const { fetch } = script({ json: { status: true, code: 1001 } }, { json: { code: 9 } });
    const c = new YunguClient('s1', 'pw', fetch);
    expect(await c.api('GET', '/m', { ok: (b) => b.status === true })).toEqual({ status: true, code: 1001 });
    expect(await c.api('GET', '/m', { check: false })).toEqual({ code: 9 });
  });

  it('sends Referer, the UA, params and a compact JSON body', async () => {
    const { reqs, fetch } = script({ json: { code: 0 } }, { json: { code: 0 } });
    const c = new YunguClient('s1', 'pw', fetch);
    await c.api('GET', '/api/x', { params: { a: 1, b: 'x y', c: true } });
    await c.api('POST', '/api/y', { json: { t: '中文' }, base: LOGIN, referer: 'https://r/' });
    expect(reqs[0].url).toBe(`${BASE}/api/x?a=1&b=x+y&c=true`);
    expect(reqs[0].init.headers).toMatchObject({ Referer: `${BASE}/umiTask`, 'User-Agent': UA });
    expect(reqs[1].url).toBe(`${LOGIN}/api/y`);
    expect(reqs[1].init.headers).toMatchObject({ Referer: 'https://r/', 'Content-Type': 'application/json' });
    expect(reqs[1].init.body).toBe('{"t":"中文"}');
    expect(reqs[1].init.redirect).toBe('manual');
  });

  it('a 302 to the login host raises YunguError with redirect set', async () => {
    const { fetch } = script({ status: 302, headers: [['location', `${LOGIN}/cas/login`]] });
    const err = await new YunguClient('s1', 'pw', fetch).api('GET', '/api/x').catch((e) => e);
    expect(err).toBeInstanceOf(YunguError);
    expect(err.redirect).toBe(`${LOGIN}/cas/login`);
    expect(err.status).toBe(302);
  });

  it('keeps the JSON body of a non-200 so expiry can be detected', async () => {
    const { fetch } = script({ status: 401, json: { ifLogin: false } }, { status: 500 }, { status: 502, json: undefined });
    const c = new YunguClient('s1', 'pw', fetch);
    const e1 = await c.api('GET', '/api/x').catch((e) => e);
    expect(e1.status).toBe(401);
    expect(sessionExpired(e1.body)).toBe(true);
    const e2 = await c.api('GET', '/api/x').catch((e) => e);
    expect(e2).toBeInstanceOf(YunguError);
    expect(e2.status).toBe(500);
    expect(e2.body).toBeUndefined();
  });

  it('a non-JSON non-200 body leaves body undefined', async () => {
    const fetch: Fetch = async () => new Response('<html>oops</html>', { status: 500 });
    const err = await new YunguClient('s1', 'pw', fetch).api('GET', '/api/x').catch((e) => e);
    expect(err).toBeInstanceOf(YunguError);
    expect(err.status).toBe(500);
    expect(err.body).toBeUndefined();
  });

  it('resolves a relative redirect Location to an absolute URL', async () => {
    const { fetch } = script({ status: 302, headers: [['location', '/cas/login?x=1']] });
    const err = await new YunguClient('s1', 'pw', fetch).api('GET', '/api/x').catch((e) => e);
    expect(err.redirect).toBe(`${BASE}/cas/login?x=1`);
  });

  it('a 3xx without Location has no redirect', async () => {
    const { fetch } = script({ status: 302 });
    const err = await new YunguClient('s1', 'pw', fetch).api('GET', '/api/x').catch((e) => e);
    expect(err).toBeInstanceOf(YunguError);
    expect(err.status).toBe(302);
    expect(err.redirect).toBeUndefined();
  });

  it('wraps network failures in YunguError', async () => {
    const c = new YunguClient('s1', 'pw', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(c.api('GET', '/api/x')).rejects.toBeInstanceOf(YunguError);
  });

  it("turns the desktop app's Suspension Mode refusal into Suspended (a YunguUnavailable)", async () => {
    const c = new YunguClient('s1', 'pw', async () => {
      throw Object.assign(new Error('Suspension Mode'), { name: 'Suspended' });
    });
    const err = await c.api('GET', '/api/x').catch((e) => e);
    expect(err).toBeInstanceOf(Suspended);
    expect(err).toBeInstanceOf(YunguUnavailable);
  });
});

describe('sessionExpired', () => {
  it('detects the three expiry shapes only', () => {
    expect(sessionExpired({ ifLogin: false })).toBe(true);
    expect(sessionExpired({ code: 1000 })).toBe(true);
    expect(sessionExpired({ unauthorized: true })).toBe(true);
    expect(sessionExpired({ code: 0 })).toBe(false);
    expect(sessionExpired(null)).toBe(false);
    expect(sessionExpired('x')).toBe(false);
    expect(sessionExpired([{ code: 1000 }])).toBe(false);
  });
});

describe('CookieJar', () => {
  const res = (...cookies: string[]) => new Response(null, { headers: cookies.map((c) => ['set-cookie', c] as [string, string]) });

  it('scopes cookies by host and path', () => {
    const jar = new CookieJar();
    jar.store('https://task.yungu.org/a/b', res('H=1', 'P=2; Path=/a', 'D=3; Domain=yungu.org; Path=/'));
    expect(jar.header('https://task.yungu.org/a/c')).toBe('H=1; P=2; D=3');
    expect(jar.header('https://task.yungu.org/ab')).toBe('D=3');
    expect(jar.header('https://login.yungu.org/a')).toBe('D=3');
    expect(jar.header('https://evil.org/a')).toBe('');
  });

  it('deletes on Max-Age=0 and past Expires, replaces same-name cookies', () => {
    const jar = new CookieJar();
    jar.store('https://task.yungu.org/', res('A=1; Path=/', 'B=1; Path=/'));
    jar.store('https://task.yungu.org/', res('A=2; Path=/', 'B=; Max-Age=0; Path=/'));
    expect(jar.header('https://task.yungu.org/')).toBe('A=2');
    jar.store('https://task.yungu.org/', res('A=x; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/'));
    expect(jar.header('https://task.yungu.org/')).toBe('');
  });

  it('rejects a Domain the host is not in, and clear() empties the jar', () => {
    const jar = new CookieJar();
    jar.store('https://task.yungu.org/', res('X=1; Domain=other.org', 'Y=1'));
    expect(jar.header('https://task.yungu.org/')).toBe('Y=1');
    jar.clear();
    expect(jar.header('https://task.yungu.org/')).toBe('');
  });
});
