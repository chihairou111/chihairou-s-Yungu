import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE, SESSION_MAX_AGE, decodeSession, encodeSession, sessionCookieOptions } from './session-cookie';

describe('session cookie helpers', () => {
  it('exposes the cookie constants', () => {
    expect(SESSION_COOKIE).toBe('yl_session');
    expect(SESSION_MAX_AGE).toBe(2592000);
  });

  it('round-trips a name and the token it is given, including non-ASCII', () => {
    expect(decodeSession(encodeSession('Bruce Zheng', 'tok-1'))).toEqual({ name: 'Bruce Zheng', token: 'tok-1' });
    expect(decodeSession(encodeSession('郑博', 'tok-2'))).toEqual({ name: '郑博', token: 'tok-2' });
  });

  it('produces a url-safe value', () => {
    expect(encodeSession('a??>>b', 'x/y+z')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns null for missing or malformed values', () => {
    expect(decodeSession(undefined)).toBeNull();
    expect(decodeSession('')).toBeNull();
    expect(decodeSession('%%%')).toBeNull();
    expect(decodeSession(Buffer.from('not json').toString('base64url'))).toBeNull();
    expect(decodeSession(Buffer.from('{"name":5,"token":"t"}').toString('base64url'))).toBeNull();
    expect(decodeSession(Buffer.from('{"name":"a"}').toString('base64url'))).toBeNull();
  });
});

describe('sessionCookieOptions', () => {
  const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

  it('is httpOnly, lax, root-scoped and carries the given max age', () => {
    expect(sessionCookieOptions(req('http://localhost/api/session'), 42)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 42,
      secure: false,
    });
  });

  it('is secure when the request URL is https', () => {
    expect(sessionCookieOptions(req('https://example.com/api/session'), 0).secure).toBe(true);
  });

  it('is secure when a proxy reports x-forwarded-proto https', () => {
    expect(sessionCookieOptions(req('http://127.0.0.1/api/session', { 'x-forwarded-proto': 'https' }), 0).secure).toBe(true);
    expect(sessionCookieOptions(req('http://127.0.0.1/api/session', { 'x-forwarded-proto': 'http' }), 0).secure).toBe(false);
  });
});
