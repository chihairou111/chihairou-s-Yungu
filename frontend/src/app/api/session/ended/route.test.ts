import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const PASSWORD_CHANGED = 'Sign in again — your Yungu password may have changed.';
const get = (query: string) => GET(new NextRequest(`http://localhost/api/session/ended${query}`));

describe('GET /api/session/ended', () => {
  it('clears the session, keeps the reason for the sign-in page and goes there', async () => {
    const res = await get('?reason=password');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login');
    const cookies = res.headers.getSetCookie();
    expect(cookies.find((c) => c.startsWith('yl_session='))).toMatch(/Max-Age=0/);
    expect(cookies.find((c) => c.startsWith('yl_signin_notice='))).toMatch(/^yl_signin_notice=password;/);
    expect(PASSWORD_CHANGED).toContain('password');
  });

  it('falls back to the plain notice for a missing or unknown reason', async () => {
    for (const query of ['', '?reason=evil', '?reason=password&reason=x']) {
      const res = await get(query);
      expect(res.status).toBe(303);
      const notice = res.headers.getSetCookie().find((c) => c.startsWith('yl_signin_notice='));
      expect(notice, query).toMatch(query.includes('password') ? /=password;/ : /=ended;/);
    }
  });
});

describe('GET /api/session/ended with a page to come back to', () => {
  it('keeps a safe next for the sign-in page', async () => {
    const res = await get(`?reason=ended&next=${encodeURIComponent('/oauth/authorize?client_id=a')}`);
    expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/oauth/authorize?client_id=a')}`);
  });

  it('drops an unsafe one', async () => {
    for (const next of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const res = await get(`?reason=ended&next=${encodeURIComponent(next)}`);
      expect(res.headers.get('location'), next).toBe('/login');
    }
  });
});
