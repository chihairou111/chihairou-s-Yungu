import { describe, expect, it } from 'vitest';
import { loginPath, safeNext } from './next-path';

describe('safeNext', () => {
  it('keeps a relative same-origin path, query included', () => {
    expect(safeNext('/oauth/authorize?client_id=ylc_1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb')).toBe(
      '/oauth/authorize?client_id=ylc_1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb',
    );
    expect(safeNext('/calendar')).toBe('/calendar');
  });

  it.each([
    ['an absolute URL', 'https://evil.example/x'],
    ['a scheme', 'javascript:alert(1)'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash authority', '/\\evil.example'],
    ['a backslash later on', '/x\\y'],
    ['a tab the URL parser would drop', '/\t/evil.example'],
    ['a newline', '/\n/evil.example'],
    ['a space', '/ /evil.example'],
    ['no leading slash', 'assignments'],
    ['empty', ''],
    ['the sign-in page itself', '/login?next=/x'],
    ['a route handler', '/api/session/ended'],
    ['something absurdly long', `/${'a'.repeat(9000)}`],
  ])('refuses %s', (_, raw) => {
    expect(safeNext(raw)).toBeNull();
  });

  it('refuses anything that is not one string', () => {
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext(null)).toBeNull();
    expect(safeNext(['/a', '/b'])).toBeNull();
  });
});

describe('loginPath', () => {
  it('carries a safe return path and drops an unsafe one', () => {
    expect(loginPath('/oauth/authorize?a=1&b=2')).toBe('/login?next=%2Foauth%2Fauthorize%3Fa%3D1%26b%3D2');
    expect(loginPath('//evil.example')).toBe('/login');
    expect(loginPath(null)).toBe('/login');
  });
});
