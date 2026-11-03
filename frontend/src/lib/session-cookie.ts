// Cookie format helpers with no next/headers import, so the proxy can use them too.
import type { NextResponse } from 'next/server';
import { PASSWORD_CHANGED, SIGN_IN_AGAIN } from './data/errors';

export const SESSION_COOKIE = 'yl_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** Our own session: the display name plus the opaque token the data layer issued at sign-in. */
export interface Session {
  name: string;
  token: string;
}

/** Session cookie value: base64url(JSON {name, token}). */
export function encodeSession(name: string, token: string): string {
  return Buffer.from(JSON.stringify({ name, token })).toString('base64url');
}

export function decodeSession(value: string | undefined): Session | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      parsed &&
      typeof parsed === 'object' &&
      'name' in parsed &&
      typeof parsed.name === 'string' &&
      'token' in parsed &&
      typeof parsed.token === 'string'
    ) {
      return { name: parsed.name, token: parsed.token };
    }
  } catch {
    // fall through: malformed cookie means no session
  }
  return null;
}

/** True when the browser reached us over HTTPS, directly or through a TLS-terminating proxy. */
function isHttps(request: Request): boolean {
  if (new URL(request.url).protocol === 'https:') return true;
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return forwarded === 'https';
}

/** Options for setting (maxAge > 0) or clearing (maxAge 0) the session cookie. */
export function sessionCookieOptions(request: Request, maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
    secure: isHttps(request),
  };
}

/**
 * Why the last session ended, for the sign-in page to say. The service tells only the request that hit
 * the rejected re-login that the password may have changed, so that answer is kept here for the page
 * that follows. The cookie holds a reason code, never text, so a link cannot put words on the sign-in page.
 */
export const SIGN_IN_NOTICE_COOKIE = 'yl_signin_notice';
const NOTICE_MAX_AGE = 5 * 60;
const NOTICES = { password: PASSWORD_CHANGED, ended: SIGN_IN_AGAIN } as const;
type NoticeReason = keyof typeof NOTICES;

const reasonFor = (message: string): NoticeReason => (message === PASSWORD_CHANGED ? 'password' : 'ended');

/** The message for a notice cookie value; null when there is none (or it is not one of ours). */
export function signInNotice(value: string | undefined): string | null {
  return value !== undefined && Object.hasOwn(NOTICES, value) ? NOTICES[value as NoticeReason] : null;
}

/** On a response: our session is over (the service answered 401 with `message`); clear it and keep the reason. */
export function endSession(response: NextResponse, request: Request, message: string): void {
  response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(request, 0));
  response.cookies.set(SIGN_IN_NOTICE_COOKIE, reasonFor(message), sessionCookieOptions(request, NOTICE_MAX_AGE));
}

/**
 * Where a page sends the browser when the service ended the session: clears the cookie, then signs in
 * (coming back to `next` afterwards, when the ended route finds it safe).
 */
export function endedSessionPath(message: string, next?: string): string {
  const back = next ? `&next=${encodeURIComponent(next)}` : '';
  return `/api/session/ended?reason=${reasonFor(message)}${back}`;
}

/** The ended-session route: the message for a `reason` query value, the plain one for anything else. */
export function endedSessionMessage(reason: string | null): string {
  return reason === 'password' ? PASSWORD_CHANGED : SIGN_IN_AGAIN;
}
