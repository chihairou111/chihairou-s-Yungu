import { NextResponse, type NextRequest } from 'next/server';
import { endSession, endedSessionMessage } from '@/lib/session-cookie';

/**
 * A page found the session over (the service answered 401) and sent the browser here, since a page
 * cannot change cookies: clear our session, keep the reason for the sign-in page, then go there.
 * Only clears the visitor's own cookie, so a link here from elsewhere can do no more than sign them out.
 */
export function GET(request: NextRequest) {
  // A relative Location: `request.url` names the server's own host (e.g. localhost), which may not be the
  // host the browser used, and the cookies below belong to the browser's host.
  const response = new NextResponse(null, { status: 303, headers: { Location: '/login' } });
  endSession(response, request, endedSessionMessage(request.nextUrl.searchParams.get('reason')));
  return response;
}
