import { NextResponse, type NextRequest } from 'next/server';
import { BLANK_CREDENTIALS_ERROR, data } from '@/lib/data';
import { serviceErrorResponse } from '@/lib/api-auth';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  SIGN_IN_NOTICE_COOKIE,
  decodeSession,
  encodeSession,
  sessionCookieOptions,
} from '@/lib/session-cookie';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const { loginId, password } = (body ?? {}) as { loginId?: unknown; password?: unknown };
  if (typeof loginId !== 'string' || typeof password !== 'string' || !loginId.trim() || !password.trim()) {
    return NextResponse.json({ error: BLANK_CREDENTIALS_ERROR }, { status: 400 });
  }

  const result = await data.signIn(loginId, password);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });

  const response = NextResponse.json({ name: result.displayName });
  response.cookies.set(
    SESSION_COOKIE,
    encodeSession(result.displayName, result.token),
    sessionCookieOptions(request, SESSION_MAX_AGE),
  );
  // Signed in again: the reason the last session ended no longer applies.
  if (request.cookies.has(SIGN_IN_NOTICE_COOKIE)) response.cookies.set(SIGN_IN_NOTICE_COOKIE, '', sessionCookieOptions(request, 0));
  return response;
}

export async function DELETE(request: NextRequest) {
  const session = decodeSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    try {
      await data.signOut(session.token);
    } catch (error) {
      // Keep the cookie: the service still holds the saved password, so signing out has not happened yet.
      return serviceErrorResponse(error, request);
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(request, 0));
  return response;
}
