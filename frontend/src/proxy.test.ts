import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeSession } from '@/lib/session-cookie';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config, proxy, routeFor } from './proxy';

const valid = encodeSession('Bruce Zheng', 'tok');

describe('routeFor', () => {
  it('sends signed-out visitors of protected pages to /login', () => {
    expect(routeFor('/assignments', undefined)).toEqual({ redirect: '/login', clearCookie: false });
    expect(routeFor('/', undefined)).toEqual({ redirect: '/login', clearCookie: false });
  });

  it('lets signed-out visitors see /login', () => {
    expect(routeFor('/login', undefined)).toEqual({ redirect: null, clearCookie: false });
  });

  it('sends signed-in visitors away from /login and lets them through elsewhere', () => {
    expect(routeFor('/login', valid)).toEqual({ redirect: '/assignments', clearCookie: false });
    expect(routeFor('/calendar', valid)).toEqual({ redirect: null, clearCookie: false });
  });

  it('treats an undecodable cookie as signed out and clears it', () => {
    expect(routeFor('/login', 'garbage')).toEqual({ redirect: null, clearCookie: true });
    expect(routeFor('/assignments', 'garbage')).toEqual({ redirect: '/login', clearCookie: true });
    expect(routeFor('/login', '')).toEqual({ redirect: null, clearCookie: true });
  });
});

describe('coming back after signing in', () => {
  const back = '/assignments/42?tab=files&x=1';

  it('honours a safe next once signed in', () => {
    expect(routeFor('/login', valid, `?next=${encodeURIComponent(back)}`)).toEqual({ redirect: back, clearCookie: false });
    expect(routeFor('/login', valid, '?next=%2Fcalendar')).toEqual({ redirect: '/calendar', clearCookie: false });
  });

  it.each(['https://evil.example/x', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/login', '/api/session/ended'])(
    'ignores an unsafe next (%s)',
    (next) => {
      expect(routeFor('/login', valid, `?next=${encodeURIComponent(next)}`)).toEqual({ redirect: '/assignments', clearCookie: false });
    },
  );

  it('keeps the plain redirect for the other pages', () => {
    expect(routeFor('/calendar', undefined, '?x=1')).toEqual({ redirect: '/login', clearCookie: false });
  });
});

describe('proxy on Route Handlers', () => {
  const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => proxy(new NextRequest(`http://localhost${path}`, init));

  it('refuses a write from another site before any handler runs, dotted paths included', async () => {
    for (const path of ['/api/notifications/a.b/read', '/api/assignments/1/submit']) {
      const res = call(path, { method: 'POST', headers: { host: 'localhost', 'content-type': 'text/plain' }, body: '{}' });
      expect(res.status, path).toBe(403);
      expect(await res.json()).toEqual({ error: 'Forbidden.' });
    }
    expect(call('/api/session', { method: 'DELETE', headers: { host: 'localhost', 'sec-fetch-site': 'cross-site' } }).status).toBe(403);
  });

  it('lets reads and same-origin writes on to the handler', () => {
    expect(call('/api/notifications?x=1', { headers: { 'sec-fetch-site': 'cross-site' } }).headers.get('x-middleware-next')).toBe('1');
    const ok = call('/api/assignments/1/submit', {
      method: 'POST',
      headers: { host: 'localhost', origin: 'http://localhost', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(ok.headers.get('x-middleware-next')).toBe('1');
  });

  it('covers every Route Handler, dotted paths included, but the upload route (which checks for itself)', () => {
    const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });
    for (const url of ['/api/notifications/x.y/read', '/api/files/abc', '/api/session', '/api/assignments/1/submit']) {
      expect(matches(url), url).toBe(true);
    }
    expect(matches('/api/files')).toBe(false);
    expect(matches('/api/files?x=1')).toBe(false);
    expect(matches('/assignments')).toBe(true);
  });
});

describe('the local lock (YUNGU_LOCAL_SECRET)', () => {
  const SECRET = 's3cret-per-launch';
  afterEach(() => vi.unstubAllEnvs());
  const call = (path: string, cookie?: string) =>
    proxy(new NextRequest(`http://127.0.0.1:3201${path}`, { headers: cookie ? { cookie } : {} }));

  it('refuses a request without yl_local (403) when the secret is set', async () => {
    vi.stubEnv('YUNGU_LOCAL_SECRET', SECRET);
    for (const path of ['/assignments', '/login', '/api/notifications', '/api/files/abc', '/_next/static/x.js', '/favicon.ico']) {
      expect(call(path).status, path).toBe(403);
    }
  });

  it('refuses a request with the wrong yl_local value (403)', () => {
    vi.stubEnv('YUNGU_LOCAL_SECRET', SECRET);
    expect(call('/login', 'yl_local=nope').status).toBe(403);
    expect(call('/login', `yl_local=${SECRET}x`).status).toBe(403);
    expect(call('/login', 'yl_local=').status).toBe(403);
  });

  it('allows the right value, and static assets get through without a sign-in', () => {
    vi.stubEnv('YUNGU_LOCAL_SECRET', SECRET);
    expect(call('/login', `yl_local=${SECRET}`).headers.get('x-middleware-next')).toBe('1');
    expect(call('/_next/static/x.js', `yl_local=${SECRET}`).headers.get('x-middleware-next')).toBe('1');
    expect(call('/assignments', `yl_local=${SECRET}`).status).toBe(307);
  });

  it('does nothing when the secret is unset (hosted/tests)', () => {
    expect(call('/login').headers.get('x-middleware-next')).toBe('1');
  });

  it('also matches the static paths, but still not the upload route (its own check)', () => {
    const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });
    expect(matches('/_next/static/x.js')).toBe(true);
    expect(matches('/favicon.ico')).toBe(true);
    expect(matches('/api/files')).toBe(false);
  });
});
