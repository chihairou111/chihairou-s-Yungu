import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { BLANK_CREDENTIALS_ERROR, YunguUnavailable, data } from '@/lib/data';
import { SESSION_COOKIE, decodeSession, encodeSession } from '@/lib/session-cookie';
import { DELETE, POST } from './route';

const post = (body: unknown, url = 'http://localhost/api/session', headers: Record<string, string> = {}) =>
  POST(
    new NextRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );

const del = (cookie?: string, url = 'http://localhost/api/session') =>
  DELETE(new NextRequest(url, { method: 'DELETE', headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {} }));

/** The value of the yl_session cookie in a Set-Cookie header. */
const cookieValue = (setCookie: string) => /yl_session=([^;]*)/.exec(setCookie)?.[1];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/api/session', () => {
  it('rejects a blank password with 400 and no cookie', async () => {
    const res = await post({ loginId: 's123', password: '   ' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: BLANK_CREDENTIALS_ERROR });
    expect(BLANK_CREDENTIALS_ERROR).toBe('Enter your student ID and password.');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a malformed body with 400', async () => {
    const res = await POST(new NextRequest('http://localhost/api/session', { method: 'POST', body: 'nope' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('sets the session cookie on success', async () => {
    const res = await post({ loginId: 's123', password: 'pw' });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('yl_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).toContain('Path=/');
  });

  it('stores the token returned by data.signIn in the cookie', async () => {
    vi.spyOn(data, 'signIn').mockResolvedValue({ ok: true, displayName: 'Ada', token: 'service-token-1' });
    const res = await post({ loginId: 's123', password: 'pw' });
    expect(decodeSession(cookieValue(res.headers.get('set-cookie') ?? ''))).toEqual({
      name: 'Ada',
      token: 'service-token-1',
    });
  });

  it('marks the cookie Secure only for https requests', async () => {
    const plain = await post({ loginId: 's123', password: 'pw' });
    expect(plain.headers.get('set-cookie')).not.toMatch(/Secure/i);
    const https = await post({ loginId: 's123', password: 'pw' }, 'https://example.com/api/session');
    expect(https.headers.get('set-cookie')).toMatch(/Secure/i);
    const proxied = await post({ loginId: 's123', password: 'pw' }, 'http://127.0.0.1/api/session', {
      'x-forwarded-proto': 'https',
    });
    expect(proxied.headers.get('set-cookie')).toMatch(/Secure/i);
  });

  it('DELETE clears the cookie', async () => {
    const res = await del();
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('yl_session=');
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toMatch(/Secure/i);
  });

  it('DELETE over https clears with a Secure cookie', async () => {
    const res = await del(undefined, 'https://example.com/api/session');
    expect(res.headers.get('set-cookie')).toMatch(/Secure/i);
  });

  it('DELETE signs the token out of the data layer when a session cookie is present', async () => {
    const signOut = vi.spyOn(data, 'signOut');
    await del(encodeSession('Ada', 'service-token-2'));
    expect(signOut).toHaveBeenCalledWith('service-token-2');
  });

  it('DELETE does not call signOut without a valid session cookie', async () => {
    const signOut = vi.spyOn(data, 'signOut');
    await del();
    await del('garbage');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('clears a left-over sign-in notice once signed in', async () => {
    const notice = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('yl_signin_notice='));
    const res = await post({ loginId: 's123', password: 'pw' }, undefined, { cookie: 'yl_signin_notice=password' });
    expect(notice(res)).toMatch(/Max-Age=0/);
    expect(notice(await post({ loginId: 's123', password: 'pw' }))).toBeUndefined();
  });

  it("shows Yungu being down as a sign-in error", async () => {
    vi.spyOn(data, 'signIn').mockResolvedValue({ ok: false, error: "Can't reach Yungu right now. Try again." });
    const res = await post({ loginId: 's123', password: 'pw' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Can't reach Yungu right now. Try again." });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('DELETE keeps the cookie and 502s when the service cannot forget the session', async () => {
    vi.spyOn(data, 'signOut').mockRejectedValue(new YunguUnavailable());
    const res = await del(encodeSession('Ada', 'service-token-3'));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Can't reach Yungu right now. Try again." });
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
