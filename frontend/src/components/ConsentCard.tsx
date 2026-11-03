'use client';
import { useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import SubdirectoryArrowRightRounded from '@mui/icons-material/SubdirectoryArrowRightRounded';
import { SIGN_IN_AGAIN } from '@/lib/data/errors';
import { consentText, hostOf, isWebRedirect, sameHost, type AuthorizeDecision, type AuthorizeParams } from '@/lib/oauth';
import { endedSessionPath } from '@/lib/session-cookie';
import { ARRIVE_IN } from './detail/motion';
const GENERIC_ERROR = 'Something went wrong. Try again.';
const NO_CONNECTION = 'No connection. Try again.';

/** The service's straight apostrophes as the curly ones the rest of the page uses. */
const typographic = (text: string) => text.replace(/'/g, '’');

/** The row of choices: the secondary one first, the main one last, at the end (full width on phones). */
function Actions({ children }: { children: ReactNode }) {
  return (
    <Stack
      direction={{ xs: 'column-reverse', sm: 'row' }}
      sx={{ justifyContent: 'flex-end', gap: 1, mt: 3, '& > *': { minHeight: { xs: 48, sm: 40 } } }}
    >
      {children}
    </Stack>
  );
}

interface ConsentCardProps {
  /** The agent's request, field for field as the page received it. */
  params: AuthorizeParams;
  client: { name: string; redirectHost: string };
  userName: string;
  /** This page's own path and query: where signing in again comes back to. */
  here: string;
  /** Sends the browser on (a test stands in for it). */
  navigate?: (url: string) => void;
}

/**
 * The consent screen of an agent's sign-in: who is asking (the name it registered, which anyone can
 * choose, and the host it returns to, which it cannot), the exact question, and Allow / Deny. Either
 * choice goes to the service, which answers where the browser goes; the page follows that only to the
 * host it showed. A refusal stays here with its reason, and offers the way back only when the service
 * gave one.
 */
export default function ConsentCard({ params, client, userName, here, navigate = (url) => window.location.assign(url) }: ConsentCardProps) {
  const [busy, setBusy] = useState<AuthorizeDecision | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<{ message: string; redirect?: string } | null>(null);

  async function decide(decision: AuthorizeDecision) {
    if (busy || leaving) return;
    setBusy(decision);
    setError(null);
    const answer = await approve(params, decision);
    setBusy(null);
    if (answer.kind === 'ended') {
      setLeaving(true);
      navigate(endedSessionPath(answer.message, here));
    } else if (answer.kind === 'go' && sameHost(answer.redirect, client.redirectHost)) {
      setLeaving(true);
      navigate(answer.redirect); // stays "Returning to …" until the browser leaves
    } else if (answer.kind === 'refused') {
      const back = answer.redirect && sameHost(answer.redirect, client.redirectHost) ? answer.redirect : undefined;
      setError({ message: answer.message, redirect: back });
    } else {
      setError({ message: answer.kind === 'offline' ? NO_CONNECTION : GENERIC_ERROR });
    }
  }

  const pending = (decision: AuthorizeDecision) => ({
    'aria-disabled': busy !== null || leaving || undefined,
    sx: { '&[aria-disabled="true"]': { cursor: busy === decision ? 'progress' : 'default' } },
  });

  return (
    <>
      <Typography variant="h1" sx={{ fontSize: '1.5rem', lineHeight: 1.3, overflowWrap: 'anywhere' }}>
        Connect {client.name}
      </Typography>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, mt: 0.75, color: 'text.secondary' }}>
        <SubdirectoryArrowRightRounded aria-hidden sx={{ fontSize: 18 }} />
        <Typography variant="body2" component="p" sx={{ minWidth: 0 }}>
          Returns you to{' '}
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 600, overflowWrap: 'anywhere' }}>
            {client.redirectHost}
          </Box>
        </Typography>
      </Stack>
      <Typography sx={{ mt: 3, overflowWrap: 'anywhere' }}>{consentText(client.name)}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, overflowWrap: 'anywhere' }}>
        Signed in as {userName}
      </Typography>
      {error && (
        <Alert
          severity="error"
          role="alert"
          sx={{ mt: 2.5, ...ARRIVE_IN }}
          action={
            error.redirect ? (
              <Button color="inherit" size="small" href={error.redirect}>
                Return to {hostOf(error.redirect)}
              </Button>
            ) : undefined
          }
        >
          {typographic(error.message)}
        </Alert>
      )}
      {leaving && (
        <Typography role="status" variant="body2" color="text.secondary" sx={{ mt: 2.5, ...ARRIVE_IN }}>
          Returning to {client.redirectHost}…
        </Typography>
      )}
      <Actions>
        <Button variant="outlined" color="inherit" onClick={() => void decide('deny')} {...pending('deny')}>
          {busy === 'deny' ? 'Denying…' : 'Deny'}
        </Button>
        <Button variant="contained" onClick={() => void decide('allow')} {...pending('allow')}>
          {busy === 'allow' ? 'Allowing…' : 'Allow'}
        </Button>
      </Actions>
    </>
  );
}

type Approval =
  | { kind: 'go'; redirect: string }
  | { kind: 'refused'; message: string; redirect?: string }
  | { kind: 'ended'; message: string }
  | { kind: 'offline' }
  | { kind: 'failed' };

/** Allow or Deny through the approve route: where to go, or why not (a refusal keeps the service's redirect). */
async function approve(params: AuthorizeParams, decision: AuthorizeDecision): Promise<Approval> {
  let res: Response;
  try {
    res = await fetch('/api/oauth/approve', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, decision }),
    });
  } catch {
    return { kind: 'offline' };
  }
  const body: unknown = await res.json().catch(() => null);
  const { redirect, error } = (body && typeof body === 'object' ? body : {}) as { redirect?: unknown; error?: unknown };
  const message = typeof error === 'string' && error ? error : null;
  if (res.status === 401) return { kind: 'ended', message: message ?? SIGN_IN_AGAIN };
  if (res.ok) return isWebRedirect(redirect) ? { kind: 'go', redirect } : { kind: 'failed' };
  if (res.status === 400 && message) return { kind: 'refused', message, ...(isWebRedirect(redirect) && { redirect }) };
  return message ? { kind: 'refused', message } : { kind: 'failed' };
}

/**
 * In place of the consent screen when the request can't go ahead: the reason, and the way back to the
 * agent only when the service gave a redirect for it (the client and its registered address checked).
 * Otherwise nowhere but this dashboard: an unchecked address is never followed.
 */
export function AuthorizeProblem({ error, redirect, title = 'Can’t connect this agent' }: { error: string; redirect?: string; title?: string }) {
  const back = isWebRedirect(redirect) ? redirect : undefined;
  return (
    <>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <ErrorOutlineRounded aria-hidden color="error" />
        <Typography variant="h1" sx={{ fontSize: '1.5rem', lineHeight: 1.3 }}>
          {title}
        </Typography>
      </Stack>
      <Typography sx={{ mt: 2, overflowWrap: 'anywhere' }}>{typographic(error)}</Typography>
      <Actions>
        <Button variant={back ? 'outlined' : 'contained'} color={back ? 'inherit' : 'primary'} href="/assignments">
          Go to Assignments
        </Button>
        {back && (
          <Button variant="contained" href={back}>
            Return to {hostOf(back)}
          </Button>
        )}
      </Actions>
    </>
  );
}
