import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import ConsentCard, { AuthorizeProblem } from '@/components/ConsentCard';
import LoginCard from '@/components/LoginCard';
import { getSession } from '@/lib/auth';
import { ServiceError, SessionEnded, data } from '@/lib/data';
import { loginPath } from '@/lib/next-path';
import { BAD_AUTHORIZE_REQUEST, authorizeParams } from '@/lib/oauth';
import { endedSessionPath } from '@/lib/session-cookie';
import { SITE_NAME } from '@/lib/site';
import type { AuthorizeCheck } from '@/lib/types';

// The session and the agent's request come with the request, so the page renders per request.
export const instant = false;

export const metadata: Metadata = {
  title: `Connect an agent · ${SITE_NAME}`,
  robots: { index: false, follow: false },
  // The agent's request (its state, its return address) is never passed on in a Referer.
  referrer: 'no-referrer',
};

type Query = Record<string, string | string[] | undefined>;

/** This page's own path and query, as it was asked for: where signing in comes back to. */
function pathOf(query: Query): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(key, one);
  }
  const text = search.toString();
  return text ? `/oauth/authorize?${text}` : '/oauth/authorize';
}

type View = { kind: 'check'; check: AuthorizeCheck } | { kind: 'unavailable'; message: string };

/**
 * An agent's sign-in (the OAuth authorization endpoint; the service's metadata names this page): signed
 * out, first the sign-in page, which comes back here. The service checks the request (client, its
 * registered return address, PKCE, resource); valid, the consent screen; refused, the reason, and the
 * way back to the agent only when the service could trust its address.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const here = pathOf(query);
  const session = await getSession();
  if (!session) redirect(loginPath(here));

  const params = authorizeParams(query);
  let view: View;
  let ended: string | null = null;
  if (!params) {
    view = { kind: 'check', check: { valid: false, error: BAD_AUTHORIZE_REQUEST } };
  } else {
    try {
      view = { kind: 'check', check: await data.checkAuthorize(params) };
    } catch (error) {
      if (error instanceof SessionEnded) ended = endedSessionPath(error.message, here);
      else if (!(error instanceof ServiceError)) throw error;
      view = { kind: 'unavailable', message: error.message };
    }
  }
  // Outside the try: `redirect` works by throwing.
  if (ended) redirect(ended);

  return (
    <Box
      component="main"
      // Placed as the sign-in page is, so coming from it the card stays where it was.
      sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'start center', px: 2, pt: 'max(32px, 18vh)', pb: 4, bgcolor: 'background.default' }}
    >
      <LoginCard>
        {view.kind === 'unavailable' ? (
          <AuthorizeProblem title="Can’t check this agent right now" error={view.message} />
        ) : view.check.valid ? (
          <ConsentCard params={params!} client={view.check.client} userName={session.name} here={here} />
        ) : (
          <AuthorizeProblem error={view.check.error} redirect={view.check.redirect} />
        )}
      </LoginCard>
    </Box>
  );
}
