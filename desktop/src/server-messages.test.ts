import { describe, expect, it } from 'vitest';
import { parseServerMessage } from './server-messages';

describe('parseServerMessage', () => {
  it('accepts the bridge messages', () => {
    expect(parseServerMessage({ type: 'signed-in', name: 'A', token: 't' })).toEqual({ type: 'signed-in', name: 'A', token: 't' });
    expect(parseServerMessage({ type: 'sign-in-failed', reason: 'wrong-password' })).toEqual({
      type: 'sign-in-failed',
      reason: 'wrong-password',
    });
    expect(parseServerMessage({ type: 'sign-in-failed', reason: 'unreachable' })).toEqual({
      type: 'sign-in-failed',
      reason: 'unreachable',
    });
    expect(parseServerMessage({ type: 'save-credentials', loginId: '1', password: 'p', extra: 1 })).toEqual({
      type: 'save-credentials',
      loginId: '1',
      password: 'p',
    });
    expect(parseServerMessage({ type: 'forget-credentials' })).toEqual({ type: 'forget-credentials' });
  });

  it('refuses anything malformed', () => {
    for (const m of [
      null,
      'signed-in',
      {},
      { type: 'signed-in', name: 'A' },
      { type: 'sign-in-failed', reason: 'other' },
      { type: 'save-credentials', loginId: 1, password: 'p' },
      { type: 'credentials', loginId: '1', password: 'p' },
    ]) {
      expect(parseServerMessage(m)).toBeNull();
    }
  });
});
