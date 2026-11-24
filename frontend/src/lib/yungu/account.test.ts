// @vitest-environment node
// LocalAccount: one local Yungu account, its re-login rule and read cache. Ported from the owner-session
// cases of api/tests/test_service.py; the multi-account, throttling and token cases do not apply.
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PASSWORD_CHANGED, SIGN_IN_AGAIN, SessionEnded, YUNGU_UNAVAILABLE, YunguUnavailable } from '../data/errors';
import { LOGIN_RETRY_MS, LocalAccount, ReadCache, SignInRefused, WRONG_LOGIN } from './account';
import { LOGIN_ID, ME, PASSWORD, World, expiredError, fakeClientFactory, gate } from './fake-yungu';
import { YunguError } from './http';
import { LocalState } from './state';

let dir: string;
let world: World;
let clock: { t: number };

function account() {
  return new LocalAccount({ fetch: vi.fn(), stateDir: dir, now: () => clock.t, makeClient: fakeClientFactory(world) });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yl-account-'));
  world = new World();
  clock = { t: 1_792_800_000_000 };
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const courses = (a: LocalAccount) => a.call((c) => c.courses());

describe('signIn', () => {
  it("reports the user's display name (eName, else userName) and a fresh token", async () => {
    const a = account();
    const first = await a.signIn(LOGIN_ID, PASSWORD);
    expect(first.name).toBe('Ada Example');
    expect(first.token).toMatch(/^[0-9a-f-]{32,}$/);
    expect(a.token()).toBe(first.token);
    expect(a.name()).toBe('Ada Example');

    world.accounts[LOGIN_ID].user = { userId: ME, userName: '学生甲', eName: '  ' };
    const second = await a.signIn(LOGIN_ID, PASSWORD);
    expect(second.name).toBe('学生甲');
    expect(second.token).not.toBe(first.token);
  });

  it('hands the credentials to onCredentials on success', async () => {
    const a = account();
    const seen: unknown[] = [];
    a.onCredentials = (c) => seen.push(c);
    await a.signIn(LOGIN_ID, PASSWORD);
    expect(seen).toEqual([{ loginId: LOGIN_ID, password: PASSWORD }]);
  });

  it('a wrong password is SignInRefused and keeps nothing', async () => {
    const a = account();
    const error = await a.signIn(LOGIN_ID, 'nope').catch((e) => e);
    expect(error).toBeInstanceOf(SignInRefused);
    expect(error.message).toBe(WRONG_LOGIN);
    expect(a.token()).toBeNull();
  });

  it('Yungu down during sign-in is YunguUnavailable', async () => {
    world.loginFail = new YunguError('login: HTTP 503, no public key', { status: 503 });
    await expect(account().signIn(LOGIN_ID, PASSWORD)).rejects.toBeInstanceOf(YunguUnavailable);
  });

  it('signOut forgets the session, the credentials and the cache', async () => {
    const a = account();
    const seen: unknown[] = [];
    a.onCredentials = (c) => seen.push(c);
    await a.signIn(LOGIN_ID, PASSWORD);
    await a.cache.get('k', async () => 1);
    a.signOut();
    expect(a.token()).toBeNull();
    expect(seen.at(-1)).toBeNull();
    expect(await a.cache.get('k', async () => 2)).toBe(2);
    await expect(courses(a)).rejects.toMatchObject({ message: SIGN_IN_AGAIN });
  });
});

describe('call', () => {
  it('without a sign-in is SessionEnded', async () => {
    const error = await courses(account()).catch((e) => e);
    expect(error).toBeInstanceOf(SessionEnded);
    expect(error.message).toBe(SIGN_IN_AGAIN);
  });

  it('re-logs in once on an expired session and retries', async () => {
    const a = account();
    await a.signIn(LOGIN_ID, PASSWORD);
    world.expireAll();
    expect(await courses(a)).toBe(world.courses);
    expect(world.logins).toHaveLength(2);
    expect(world.count('courses')).toBe(2);
  });

  it.each([
    ['code 1000', expiredError()],
    ['ifLogin false on a 401', new YunguError('GET /api/x -> HTTP 401', { status: 401, body: { ifLogin: false } })],
    ['a redirect to the login page', new YunguError('GET /api/x -> HTTP 302', { status: 302, redirect: 'https://login.yungu.org/cas/login?service=x' })],
  ])('%s counts as expiry', async (_name, error) => {
    const a = account();
    await a.signIn(LOGIN_ID, PASSWORD);
    let first = true;
    const value = await a.call(async () => {
      if (first) {
        first = false;
        throw error;
      }
      return 'ok';
    });
    expect(value).toBe('ok');
    expect(world.logins).toHaveLength(2);
  });

  it('a second expiry after the retry is not retried again', async () => {
    const a = account();
    await a.signIn(LOGIN_ID, PASSWORD);
    const error = await a
      .call(async () => {
        throw expiredError();
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(YunguUnavailable);
    expect(world.logins).toHaveLength(2);
  });

  it('two calls that both see expiry share one re-login', async () => {
    const a = account();
    await a.signIn(LOGIN_ID, PASSWORD);
    world.expireAll();
    const held = gate();
    world.expiredGate = held.promise;
    const both = Promise.all([courses(a), courses(a)]);
    await new Promise((r) => setTimeout(r, 0));
    held.open();
    expect(await both).toEqual([world.courses, world.courses]);
    expect(world.logins).toHaveLength(2); // sign-in + one re-login
    expect(world.count('courses')).toBe(4);
  });

  it('a call during a re-login waits for it and keeps the new session', async () => {
    const a = account();
    await a.signIn(LOGIN_ID, PASSWORD);
    world.expireAll();
    const held = gate();
    world.loginGate = held.promise;
    const first = courses(a);
    await new Promise((r) => setTimeout(r, 0));
    const second = courses(a);
    await new Promise((r) => setTimeout(r, 0));
    held.open();
    await Promise.all([first, second]);
    expect(world.logins).toHaveLength(2);
  });

  it('a rejected password on re-login signs out, clears credentials (onCredentials(null)) and throws SessionEnded with PASSWORD_CHANGED', async () => {
    const a = account();
    await a.signIn(LOGIN_ID, PASSWORD);
    const seen: unknown[] = [];
    a.onCredentials = (c) => seen.push(c);
    world.accounts[LOGIN_ID].password = 'changed-elsewhere';
    world.expireAll();
    const error = await courses(a).catch((e) => e);
    expect(error).toBeInstanceOf(SessionEnded);
    expect(error.message).toBe(PASSWORD_CHANGED);
    expect(seen).toEqual([null]);
    expect(a.token()).toBeNull();
    // Nothing more is tried: the next call is told to sign in again without a login.
    await expect(courses(a)).rejects.toBeInstanceOf(SessionEnded);
    expect(world.logins).toHaveLength(2);
  });

  it('a rejected password with concurrent calls is still one attempt', async () => {
    const a = account();
    await a.signIn(LOGIN_ID, PASSWORD);
    world.accounts[LOGIN_ID].password = 'changed-elsewhere';
    world.expireAll();
    const held = gate();
    world.expiredGate = held.promise;
    const both = Promise.allSettled([courses(a), courses(a), courses(a)]);
    await new Promise((r) => setTimeout(r, 0));
    held.open();
    const results = await both;
    expect(results.every((r) => r.status === 'rejected' && r.reason instanceof SessionEnded)).toBe(true);
    expect(world.logins).toHaveLength(2);
  });

  it('a network error throws YunguUnavailable and keeps the credentials', async () => {
    const a = account();
    await a.signIn(LOGIN_ID, PASSWORD);
    const seen: unknown[] = [];
    a.onCredentials = (c) => seen.push(c);
    world.fail = new YunguError('GET /api/my/currentCourses -> fetch failed');
    const error = await courses(a).catch((e) => e);
    expect(error).toBeInstanceOf(YunguUnavailable);
    expect(error.message).toBe(YUNGU_UNAVAILABLE);
    expect(seen).toEqual([]);
    world.fail = null;
    expect(await courses(a)).toBe(world.courses);
  });

  it.each([
    ['a 5xx', new YunguError('GET /x -> HTTP 503', { status: 503 })],
    ['non-JSON', new YunguError('GET /x -> non-JSON response', { status: 200 })],
    ['an unexpected payload', new TypeError("Cannot read properties of undefined (reading 'data')")],
  ])('%s is YunguUnavailable', async (_name, error) => {
    const a = account();
    await a.signIn(LOGIN_ID, PASSWORD);
    world.fail = error;
    await expect(courses(a)).rejects.toBeInstanceOf(YunguUnavailable);
  });

  it('a re-login while Yungu is down is a 502, keeps the password and is not retried per request', async () => {
    const a = account();
    await a.signIn(LOGIN_ID, PASSWORD);
    world.expireAll();
    world.loginFail = new YunguError('login: HTTP 502, non-JSON response', { status: 502 });
    await expect(courses(a)).rejects.toBeInstanceOf(YunguUnavailable);
    await expect(courses(a)).rejects.toBeInstanceOf(YunguUnavailable);
    expect(world.logins).toHaveLength(2); // one re-login attempt in the retry window
    world.loginFail = null;
    clock.t += LOGIN_RETRY_MS;
    expect(await courses(a)).toBe(world.courses);
    expect(world.logins).toHaveLength(3);
  });

  it('a re-login that lands on another account is never used', async () => {
    const a = account();
    await a.signIn(LOGIN_ID, PASSWORD);
    world.accounts[LOGIN_ID].user = { userId: ME + 1, userName: 'x' };
    world.expireAll();
    await expect(courses(a)).rejects.toBeInstanceOf(YunguUnavailable);
  });

  it('a sign-out during a re-login drops its result', async () => {
    const a = account();
    await a.signIn(LOGIN_ID, PASSWORD);
    world.expireAll();
    const held = gate();
    world.loginGate = held.promise;
    const pending = courses(a).catch((e) => e);
    await new Promise((r) => setTimeout(r, 0));
    a.signOut();
    held.open();
    expect(await pending).toBeInstanceOf(SessionEnded);
    expect(a.token()).toBeNull();
  });
});

describe('ReadCache', () => {
  it('cache: second read within 60 s is served from cache; refresh bypasses; clear empties', async () => {
    let t = 0;
    const cache = new ReadCache(() => t);
    let n = 0;
    const compute = async () => ++n;
    expect(await cache.get('a', compute)).toBe(1);
    t = 59_999;
    expect(await cache.get('a', compute)).toBe(1);
    expect(await cache.get('a', compute, true)).toBe(2);
    expect(await cache.get('a', compute)).toBe(2);
    t = 59_999 + 60_000;
    expect(await cache.get('a', compute)).toBe(3);
    cache.clear();
    expect(await cache.get('a', compute)).toBe(4);
    expect(await cache.get('b', compute)).toBe(5);
  });

  it('a value computed across a clear is returned but not stored', async () => {
    const cache = new ReadCache(() => 0);
    const held = gate();
    const pending = cache.get('a', async () => {
      await held.promise;
      return 'stale';
    });
    cache.clear();
    held.open();
    expect(await pending).toBe('stale');
    expect(await cache.get('a', async () => 'fresh')).toBe('fresh');
  });

  it('holds at most its cap, dropping expired entries first', async () => {
    let t = 0;
    const cache = new ReadCache(() => t, 3);
    for (const k of ['a', 'b', 'c', 'd']) {
      t += 1;
      await cache.get(k, async () => k);
    }
    expect(cache.size).toBe(3);
    expect(await cache.get('a', async () => 'again')).toBe('again');
  });

  it('a failed compute is not stored', async () => {
    const cache = new ReadCache(() => 0);
    await expect(cache.get('a', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await cache.get('a', async () => 'ok')).toBe('ok');
  });
});

describe('LocalState', () => {
  it('LocalState survives a new instance on the same dir', () => {
    const state = new LocalState(join(dir, 'state'));
    expect(state.handIn(1)).toBeNull();
    state.setHandIn(1, ['10', '11']);
    state.setHandIn(2, []);
    const again = new LocalState(join(dir, 'state'));
    expect(again.handIn(1)).toEqual(['10', '11']);
    expect(again.handIn(2)).toEqual([]);
    expect(statSync(join(dir, 'state', 'hand-in.json')).mode & 0o777).toBe(0o600);
  });

  it('an unreadable file counts as nothing kept', async () => {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 's'));
    writeFileSync(join(dir, 's', 'hand-in.json'), '{not json');
    expect(new LocalState(join(dir, 's')).handIn(1)).toBeNull();
  });

  it('a disk error never throws: the record is kept in memory and the error only warned', async () => {
    const { writeFileSync } = await import('node:fs');
    // A file where the directory should be: every write fails.
    writeFileSync(join(dir, 'blocked'), 'x');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = new LocalState(join(dir, 'blocked'));
    expect(() => state.setHandIn(7, ['secret-file-id'])).not.toThrow();
    expect(state.handIn(7)).toEqual(['secret-file-id']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-file-id');
    warn.mockRestore();
  });
});
