import { describe, expect, it } from 'vitest';
import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  SIGN_IN_NOTICE_COOKIE,
  decodeSession,
  encodeSession,
  endSession,
  endedSessionPath,
  sessionCookieOptions,
  signInNotice,
} from './session-cookie';

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

describe('ending a session the service refused', () => {
  const PASSWORD_CHANGED = 'Sign in again — your Yungu password may have changed.';

  it('clears the session cookie and leaves a short-lived notice naming the reason', () => {
    const res = NextResponse.json({});
    endSession(res, new Request('https://example.com/x'), PASSWORD_CHANGED);
    expect(SIGN_IN_NOTICE_COOKIE).toBe('yl_signin_notice');
    const session = res.cookies.get(SESSION_COOKIE);
    expect(session).toMatchObject({ value: '', maxAge: 0, httpOnly: true, secure: true, path: '/' });
    expect(res.cookies.get(SIGN_IN_NOTICE_COOKIE)).toMatchObject({ value: 'password', maxAge: 300, httpOnly: true, path: '/' });

    const plain = NextResponse.json({});
    endSession(plain, new Request('http://localhost/x'), 'Sign in again.');
    expect(plain.cookies.get(SIGN_IN_NOTICE_COOKIE)?.value).toBe('ended');
  });

  it('names the reason, never the message itself, in the sign-out path', () => {
    expect(endedSessionPath(PASSWORD_CHANGED)).toBe('/api/session/ended?reason=password');
    expect(endedSessionPath('Sign in again.')).toBe('/api/session/ended?reason=ended');
    expect(endedSessionPath('<b>anything else</b>')).toBe('/api/session/ended?reason=ended');
  });

  it('turns a notice back into its message, ignoring anything unknown', () => {
    expect(signInNotice('password')).toBe(PASSWORD_CHANGED);
    expect(signInNotice('ended')).toBe('Sign in again.');
    expect(signInNotice('toString')).toBeNull();
    expect(signInNotice('Call 123 now')).toBeNull();
    expect(signInNotice(undefined)).toBeNull();
  });
});
