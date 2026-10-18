import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE, SESSION_MAX_AGE, decodeSession, encodeSession } from './auth';

describe('session cookie helpers', () => {
  it('exposes the cookie constants', () => {
    expect(SESSION_COOKIE).toBe('yl_session');
    expect(SESSION_MAX_AGE).toBe(2592000);
  });

  it('round-trips a name, including non-ASCII', () => {
    expect(decodeSession(encodeSession('Bruce Zheng'))).toEqual({ name: 'Bruce Zheng' });
    expect(decodeSession(encodeSession('郑博'))).toEqual({ name: '郑博' });
  });

  it('produces a url-safe value', () => {
    expect(encodeSession('a??>>b')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('returns null for missing or malformed values', () => {
    expect(decodeSession(undefined)).toBeNull();
    expect(decodeSession('')).toBeNull();
    expect(decodeSession('%%%')).toBeNull();
    expect(decodeSession(Buffer.from('not json').toString('base64url'))).toBeNull();
    expect(decodeSession(Buffer.from('{"name":5}').toString('base64url'))).toBeNull();
  });
});
