'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { assignLocation } from '@/lib/assign-location';

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";
const GENERIC_ERROR = 'Sign-in failed. Try again.';

/**
 * Student ID + password form; the server sets the session cookie. `notice` says why the last session
 * ended (the service signed it out); it gives way to the outcome of the next attempt. `next` is where to
 * go once signed in (a path the page has already checked with `safeNext`); Assignments otherwise.
 */
export default function LoginForm({ notice, next }: { notice?: string; next?: string }) {
  const router = useRouter();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showNotice, setShowNotice] = useState(notice !== undefined);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setShowNotice(false);
    try {
      const res = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password }),
      });
      if (res.ok) {
        // Back to the page that sent us here as a full navigation, so its own headers apply.
        if (next) assignLocation(next);
        else router.replace('/assignments');
        return; // stay "Signing in…" until the page changes
      }
      const body: unknown = await res.json().catch(() => null);
      const message = (body as { error?: unknown } | null)?.error;
      setError(typeof message === 'string' ? message : GENERIC_ERROR);
    } catch {
      setError(NETWORK_ERROR);
    }
    setPending(false);
  }

  return (
    <Stack component="form" noValidate onSubmit={onSubmit} sx={{ gap: 2 }}>
      <TextField
        label="Student ID"
        name="loginId"
        autoComplete="username"
        value={loginId}
        onChange={(e) => setLoginId(e.target.value)}
        error={error !== null && !loginId.trim()}
        fullWidth
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={error !== null && !password.trim()}
        fullWidth
      />
      {error && <Alert severity="error">{error}</Alert>}
      {!error && showNotice && <Alert severity="warning">{notice}</Alert>}
      <Button type="submit" variant="contained" size="large" disabled={pending} fullWidth sx={{ minHeight: { xs: 48, sm: 40 } }}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </Stack>
  );
}
