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
