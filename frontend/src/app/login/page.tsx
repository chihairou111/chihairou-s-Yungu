import { io } from 'next/cache';
import { cookies } from 'next/headers';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import LoginCard from '@/components/LoginCard';
import LoginForm from '@/components/LoginForm';
import { safeNext } from '@/lib/next-path';
import { SIGN_IN_NOTICE_COOKIE, signInNotice } from '@/lib/session-cookie';

// The sign-in notice comes from a request cookie, so the page renders per request (reading a cookie is instant).
export const instant = false;

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Set when the service ended the last session: why, e.g. the saved Yungu password stopped working.
  const notice = signInNotice((await cookies()).get(SIGN_IN_NOTICE_COOKIE)?.value);
  // Where to go once signed in (an agent's consent page): a path on this site only, else Assignments.
  const next = safeNext((await searchParams).next) ?? undefined;
  // The router keeps a page it has left mounted (hidden) and shows that same instance on the next visit,
  // so the form would come back as it was left: "Signing in…" after a sign-in, without the notice. A key
  // that is new on every visit makes it a fresh form instead.
  await io();
  const visit = crypto.randomUUID();
  return (
    <Box
      component="main"
      // Optically centred: exact centring sits low on tall screens.
      sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'start center', px: 2, pt: 'max(32px, 18vh)', pb: 4, bgcolor: 'background.default' }}
    >
      <LoginCard>
        <Typography variant="h1" sx={{ fontSize: '1.5rem' }}>
          Yungu
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
          Sign in with your Yungu account
        </Typography>
        <LoginForm key={visit} notice={notice ?? undefined} next={next} />
      </LoginCard>
    </Box>
  );
}
