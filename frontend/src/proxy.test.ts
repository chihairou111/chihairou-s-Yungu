import { describe, expect, it } from 'vitest';
import { encodeSession } from '@/lib/session-cookie';
import { routeFor } from './proxy';

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
