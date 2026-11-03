import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, decodeSession } from '@/lib/session-cookie';
import { loginPath, safeNext } from '@/lib/next-path';
import { isSameOriginWrite } from '@/lib/same-origin';

export interface RouteDecision {
  /** A same-origin path (with any query) to send the browser to, or null to go ahead. */
  redirect: string | null;
  /** The cookie is present but does not decode: remove it. */
  clearCookie: boolean;
}

/** Pages a signed-out visitor comes back to after signing in (an agent's consent page); the rest start on Assignments. */
const RETURN_AFTER_SIGN_IN = /^\/oauth\//;

/**
 * Pure routing rule: a cookie counts as a session only if it decodes. `search` is the request's query
 * (`?…`): the sign-in page's `next`, and the consent page's own request to come back to.
 */
export function routeFor(pathname: string, cookieValue: string | undefined, search = ''): RouteDecision {
  const signedIn = decodeSession(cookieValue) !== null;
  const clearCookie = cookieValue !== undefined && !signedIn;
  const onLogin = pathname === '/login';

  if (!signedIn && !onLogin) {
    return { redirect: RETURN_AFTER_SIGN_IN.test(pathname) ? loginPath(`${pathname}${search}`) : '/login', clearCookie };
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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
  // Pages (not assets), and every Route Handler, dotted paths included, for the write check — except the
  // upload route `/api/files` itself: the proxy would copy its body and cut it at 10 MB, so that route
  // runs the same check on its own (`/api/files/<id>` is still covered).
  matcher: ['/((?!_next|api|favicon\\.ico|.*\\..*).*)', '/api/((?!files$).*)'],
};
