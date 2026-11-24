import { describe, expect, it } from 'vitest';
import { encodeSession as frontendEncodeSession, signInNotice } from '../../frontend/src/lib/session-cookie';
import { encodeSession, NOTICE_PASSWORD, NOTICE_UNREACHABLE } from './session-cookie';

describe('encodeSession', () => {
  it('matches the pinned value', () => {
    expect(encodeSession('Test Student', 'tok-123')).toBe('eyJuYW1lIjoiVGVzdCBTdHVkZW50IiwidG9rZW4iOiJ0b2stMTIzIn0');
  });

  it('matches the frontend function, non-ASCII included', () => {
    for (const [name, token] of [
      ['Test Student', 'tok-123'],
      ['测试 学生', 'a/b+c=d?'],
      ['', ''],
    ]) {
      expect(encodeSession(name, token)).toBe(frontendEncodeSession(name, token));
    }
  });
});

describe('the notice values the shell sets', () => {
  it('are ones the sign-in page knows', () => {
    expect(signInNotice(NOTICE_PASSWORD)).toBe('Sign in again — your Yungu password may have changed.');
    expect(signInNotice(NOTICE_UNREACHABLE)).toBe("Can't reach Yungu right now — trying again.");
  });
});
