import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, decodeSession } from '@/lib/session-cookie';

export interface RouteDecision {
  redirect: '/login' | '/assignments' | null;
  /** The cookie is present but does not decode: remove it. */
  clearCookie: boolean;
}

/** Pure routing rule: a cookie counts as a session only if it decodes. */
export function routeFor(pathname: string, cookieValue: string | undefined): RouteDecision {
  const signedIn = decodeSession(cookieValue) !== null;
  const clearCookie = cookieValue !== undefined && !signedIn;
  const onLogin = pathname === '/login';

  if (!signedIn && !onLogin) return { redirect: '/login', clearCookie };
  if (signedIn && onLogin) return { redirect: '/assignments', clearCookie };
  return { redirect: null, clearCookie };
}

export function proxy(request: NextRequest) {
  const { redirect, clearCookie } = routeFor(
    request.nextUrl.pathname,
    request.cookies.get(SESSION_COOKIE)?.value,
  );
  const response = redirect ? NextResponse.redirect(new URL(redirect, request.url)) : NextResponse.next();
  if (clearCookie) response.cookies.delete({ name: SESSION_COOKIE, path: '/' });
  return response;
}

export const config = {
  matcher: ['/((?!_next|api|favicon\\.ico|.*\\..*).*)'],
};
