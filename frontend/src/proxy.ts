import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, decodeSession } from '@/lib/session-cookie';
import { safeNext } from '@/lib/next-path';
import { isSameOriginWrite } from '@/lib/same-origin';
import { LOCAL_COOKIE, localUnlocked } from '@/lib/local-lock';

export interface RouteDecision {
  /** A same-origin path (with any query) to send the browser to, or null to go ahead. */
  redirect: string | null;
  /** The cookie is present but does not decode: remove it. */
  clearCookie: boolean;
}

/**
 * Pure routing rule: a cookie counts as a session only if it decodes. `search` is the request's query
 * (`?…`): the sign-in page's `next`.
 */
export function routeFor(pathname: string, cookieValue: string | undefined, search = ''): RouteDecision {
  const signedIn = decodeSession(cookieValue) !== null;
  const clearCookie = cookieValue !== undefined && !signedIn;
  const onLogin = pathname === '/login';

  if (!signedIn && !onLogin) {
    return { redirect: '/login', clearCookie };
  }
  if (signedIn && onLogin) {
    const next = new URLSearchParams(search).getAll('next');
    return { redirect: (next.length === 1 && safeNext(next[0])) || '/assignments', clearCookie };
  }
  return { redirect: null, clearCookie };
}

/** Route Handlers: every write must come from this site's own pages (see `isSameOriginWrite`). */
function guardApi(request: NextRequest): NextResponse {
  return isSameOriginWrite(request) ? NextResponse.next() : NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
}

/** Assets and the like: not pages, so no sign-in redirect (the matcher lets them through for the local lock). */
function isPage(pathname: string): boolean {
  return !(pathname.startsWith('/_next') || pathname === '/favicon.ico' || /\.[^/]*$/.test(pathname));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Local desktop build: every request carries the per-launch secret cookie (reads only the cookie; the
  // body is never touched). Off unless YUNGU_LOCAL_SECRET is set.
  if (!localUnlocked(request.cookies.get(LOCAL_COOKIE)?.value)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
  if (!isPage(pathname) && !(pathname === '/api' || pathname.startsWith('/api/'))) return NextResponse.next();
  if (pathname === '/api' || pathname.startsWith('/api/')) return guardApi(request);
  const { redirect, clearCookie } = routeFor(
    request.nextUrl.pathname,
    request.cookies.get(SESSION_COOKIE)?.value,
    request.nextUrl.search,
  );
  const response = redirect ? NextResponse.redirect(new URL(redirect, request.url)) : NextResponse.next();
  if (clearCookie) response.cookies.delete({ name: SESSION_COOKIE, path: '/' });
  return response;
}

export const config = {
  // Every path (assets too, for the local lock) except the upload route `/api/files` itself: the proxy
  // would copy its body and cut it at 10 MB, so that route runs the write check and the local lock on its
  // own (`/api/files/<id>` is still covered).
  matcher: ['/((?!api/files$).*)'],
};
