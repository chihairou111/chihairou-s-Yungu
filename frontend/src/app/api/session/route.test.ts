import { describe, expect, it } from 'vitest';
import { DELETE, POST } from './route';

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('/api/session', () => {
  it('rejects a blank password with 400 and no cookie', async () => {
    const res = await post({ loginId: 's123', password: '   ' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Enter your student ID and password.' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a malformed body with 400', async () => {
    const res = await POST(new Request('http://localhost/api/session', { method: 'POST', body: 'nope' }));
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

  it('DELETE clears the cookie', async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('yl_session=');
    expect(cookie).toContain('Max-Age=0');
  });
});
