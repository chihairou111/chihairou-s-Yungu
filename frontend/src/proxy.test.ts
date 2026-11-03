import { describe, expect, it } from 'vitest';
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
  const authorize = '/oauth/authorize?client_id=ylc_1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s';

  it('sends a signed-out visitor of the consent page to sign in first, then back to it', () => {
    expect(routeFor('/oauth/authorize', undefined, authorize.slice('/oauth/authorize'.length))).toEqual({
      redirect: `/login?next=${encodeURIComponent(authorize)}`,
      clearCookie: false,
    });
  });

  it('honours a safe next once signed in', () => {
    expect(routeFor('/login', valid, `?next=${encodeURIComponent(authorize)}`)).toEqual({ redirect: authorize, clearCookie: false });
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
    for (const path of ['/api/agent/tokens', '/api/notifications/a.b/read', '/api/assignments/1/submit']) {
      const res = call(path, { method: 'POST', headers: { host: 'localhost', 'content-type': 'text/plain' }, body: '{}' });
      expect(res.status, path).toBe(403);
      expect(await res.json()).toEqual({ error: 'Forbidden.' });
    }
    expect(call('/api/session', { method: 'DELETE', headers: { host: 'localhost', 'sec-fetch-site': 'cross-site' } }).status).toBe(403);
  });

  it('lets reads and same-origin writes on to the handler', () => {
    expect(call('/api/todoist/callback?code=x', { headers: { 'sec-fetch-site': 'cross-site' } }).headers.get('x-middleware-next')).toBe('1');
    const ok = call('/api/agent/tokens', {
      method: 'POST',
      headers: { host: 'localhost', origin: 'http://localhost', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(ok.headers.get('x-middleware-next')).toBe('1');
  });

  it('covers every Route Handler, dotted paths included, but the upload route (which checks for itself)', () => {
    const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });
    for (const url of ['/api/agent/tokens', '/api/agent/tokens/a.b', '/api/notifications/x.y/read', '/api/files/abc', '/api/session', '/api/oauth/approve']) {
      expect(matches(url), url).toBe(true);
    }
    expect(matches('/api/files')).toBe(false);
    expect(matches('/api/files?x=1')).toBe(false);
    expect(matches('/assignments')).toBe(true);
  });
});
