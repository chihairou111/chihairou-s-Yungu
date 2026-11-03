import { NextResponse, type NextRequest } from 'next/server';
import { loginPath } from '@/lib/next-path';
import { endSession, endedSessionMessage } from '@/lib/session-cookie';

/**
 * A page found the session over (the service answered 401) and sent the browser here, since a page
 * cannot change cookies: clear our session, keep the reason for the sign-in page, then go there.
 * Only clears the visitor's own cookie, so a link here from elsewhere can do no more than sign them out.
 * A safe `next` (a path on this site, see `safeNext`) is kept for the sign-in page to come back to.
 */
export function GET(request: NextRequest) {
  // A relative Location: `request.url` names the server's own host (e.g. localhost), which may not be the
  // host the browser used, and the cookies below belong to the browser's host.
  const next = request.nextUrl.searchParams.getAll('next');
  const location = loginPath(next.length === 1 ? next[0] : null);
  const response = new NextResponse(null, { status: 303, headers: { Location: location } });
  endSession(response, request, endedSessionMessage(request.nextUrl.searchParams.get('reason')));
  return response;
}
