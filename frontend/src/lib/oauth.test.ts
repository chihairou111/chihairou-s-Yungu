import { describe, expect, it } from 'vitest';
import { AUTHORIZE_FIELDS, authorizeParams, consentText, hostOf, isWebRedirect, sameHost } from './oauth';

describe('authorizeParams', () => {
  it('passes every authorization field on as is, response_type included, and blanks the rest', () => {
    expect(authorizeParams({ response_type: 'code', client_id: 'ylc_1', state: 'xyz', extra: 'dropped' })).toEqual({
      response_type: 'code',
      client_id: 'ylc_1',
      redirect_uri: '',
      state: 'xyz',
      code_challenge: '',
      code_challenge_method: '',
      scope: '',
      resource: '',
    });
    expect(AUTHORIZE_FIELDS).toHaveLength(8);
  });

  it('refuses a field given twice (RFC 6749 §3.1) or not as text', () => {
    expect(authorizeParams({ client_id: ['a', 'b'] })).toBeNull();
    expect(authorizeParams({ state: 5 })).toBeNull();
  });

  it('reads URLSearchParams the same way', () => {
    expect(authorizeParams(new URLSearchParams('client_id=a&response_type=code'))?.response_type).toBe('code');
    expect(authorizeParams(new URLSearchParams('client_id=a&client_id=b'))).toBeNull();
  });
});

describe('redirect hosts', () => {
  it('reads the host the browser will go to, without IPv6 brackets', () => {
    expect(hostOf('https://Claude.AI/api/cb?x=1')).toBe('claude.ai');
    expect(hostOf('http://[::1]:8080/cb')).toBe('::1');
    expect(hostOf('not a url')).toBeNull();
  });

  it('matches a redirect to the host the consent page showed', () => {
    expect(sameHost('https://claude.ai/cb?code=1', 'claude.ai')).toBe(true);
    expect(sameHost('https://evil.example/cb', 'claude.ai')).toBe(false);
    expect(sameHost('http://[2001:db8::1]/cb', '2001:db8::1')).toBe(true);
  });

  it('only ever sends the browser to http(s)', () => {
    expect(isWebRedirect('https://claude.ai/cb')).toBe(true);
    expect(isWebRedirect('http://127.0.0.1:9/cb')).toBe(true);
    expect(isWebRedirect('javascript:alert(1)')).toBe(false);
    expect(isWebRedirect('/relative')).toBe(false);
    expect(isWebRedirect(5)).toBe(false);
  });
});

it('says exactly what the agent may do', () => {
  expect(consentText('Claude')).toBe(
    "Allow Claude to read your Yungu assignments, schedule, feedback, points and notifications? It can't hand in, comment or change anything.",
  );
});
