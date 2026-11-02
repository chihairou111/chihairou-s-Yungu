import 'server-only';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { SessionEnded } from '@/lib/data';
import { endSession } from '@/lib/session-cookie';

/**
 * Answers for the connect flow's two routes, which the browser navigates to (a link, then Todoist's
 * redirect) rather than fetches: always a 303 on, never a JSON error page. Relative Locations, like
 * `/api/session/ended`: `request.url` names the server's own host, not the one the browser used.
 * Uncached, and sent with no Referer, so nothing of the callback's query (Todoist's code and state)
 * is kept or passed on.
 */
export function goTo(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

/** Signed out: on to the sign-in page (which comes back to Assignments after signing in). */
export async function signedOut(): Promise<Response | null> {
  return (await getSession()) ? null : goTo('/login');
}

/** The service said our session is over: clear it (keeping the reason) and go to sign in. */
export function sessionEnded(error: SessionEnded, request: Request): Response {
  const response = goTo('/login');
  endSession(response, request, error.message);
  return response;
}
