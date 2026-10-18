import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_MAX_AGE, encodeSession } from '@/lib/auth';
import { data } from '@/lib/data';

const BLANK_ERROR = 'Enter your student ID and password.';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const { loginId, password } = (body ?? {}) as { loginId?: unknown; password?: unknown };
  if (typeof loginId !== 'string' || typeof password !== 'string' || !loginId.trim() || !password.trim()) {
    return NextResponse.json({ error: BLANK_ERROR }, { status: 400 });
  }

  const result = await data.signIn(loginId, password);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 });

  const response = NextResponse.json({ name: result.displayName });
  response.cookies.set(SESSION_COOKIE, encodeSession(result.displayName), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}
