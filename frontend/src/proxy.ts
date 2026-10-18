import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const onLogin = pathname === '/login';

  if (!hasSession && !onLogin) return NextResponse.redirect(new URL('/login', request.url));
  if (hasSession && onLogin) return NextResponse.redirect(new URL('/assignments', request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|api|favicon\\.ico|.*\\..*).*)'],
};
