import { NextResponse } from 'next/server';
import { requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';
import { BAD_AUTHORIZE_REQUEST, authorizeParams, isWebRedirect } from '@/lib/oauth';

const NO_STORE = { 'Cache-Control': 'no-store' };
const CHOOSE = 'Choose Allow or Deny.';

/**
 * Only the consent page itself may answer for the person: a same-origin JSON fetch. A form or a
 * text/plain post from another site (which needs no CORS preflight) or a fetch the browser marks as
 * cross-site is refused, on top of the session cookie being SameSite=Lax.
 */
function fromConsentPage(request: Request): boolean {
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return false;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Allow or Deny on the consent page (`/oauth/authorize`): the agent's request, field for field as the
 * page received it, plus the decision. The service checks it all again and says where the browser goes:
 * the client's registered redirect with a one-use code or the denial. Nothing in the body ever decides
 * that place; a refusal carries a redirect only when the service gave one.
 */
export const POST = withServiceErrors(async (request: Request) => {
  const denied = await requireSession();
  if (denied) return denied;
  if (!fromConsentPage(request)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: BAD_AUTHORIZE_REQUEST }, { status: 400 });
  const params = authorizeParams(body as Record<string, unknown>);
  if (!params) return NextResponse.json({ error: BAD_AUTHORIZE_REQUEST }, { status: 400 });
  const { decision } = body as Record<string, unknown>;
  if (decision !== 'allow' && decision !== 'deny') return NextResponse.json({ error: CHOOSE }, { status: 400 });

  const outcome = await data.decideAuthorize(params, decision);
  if (outcome.ok) return NextResponse.json({ redirect: outcome.redirect }, { headers: NO_STORE });
  const refusal = isWebRedirect(outcome.redirect) ? { error: outcome.error, redirect: outcome.redirect } : { error: outcome.error };
  return NextResponse.json(refusal, { status: 400, headers: NO_STORE });
});
