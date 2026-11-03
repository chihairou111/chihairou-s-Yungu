import { NextResponse } from 'next/server';
import { requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';
import { BAD_AUTHORIZE_REQUEST, authorizeParams, isWebRedirect } from '@/lib/oauth';
import { isSameOriginWrite } from '@/lib/same-origin';

const NO_STORE = { 'Cache-Control': 'no-store' };
const CHOOSE = 'Choose Allow or Deny.';

/**
 * Allow or Deny on the consent page (`/oauth/authorize`): the agent's request, field for field as the
 * page received it, plus the decision. The service checks it all again and says where the browser goes:
 * the client's registered redirect with a one-use code or the denial. Nothing in the body ever decides
 * that place; a refusal carries a redirect only when the service gave one.
 */
export const POST = withServiceErrors(async (request: Request) => {
  const denied = await requireSession();
  if (denied) return denied;
  // The proxy checks every write already; here JSON only, from the consent page itself (never a form).
  if (!isSameOriginWrite(request, { jsonOnly: true })) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
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
