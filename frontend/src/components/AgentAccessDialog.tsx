'use client';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Theme } from '@mui/material/styles';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import { TransitionGroup } from 'react-transition-group';
import { chinaRelativeTime } from '@/lib/time';
import type { AgentAccess, NewAgentToken } from '@/lib/types';
import { ApiError, isSessionEnded } from './detail/api';
import { ARRIVE_IN, EASE_OUT, popIn } from './detail/motion';
import { MCP_URL, createAgentToken, disconnectAgent, fetchAgentAccess, revokeAgentToken } from './agent-api';
import { VISUALLY_HIDDEN } from './visually-hidden';

const GENERIC_ERROR = 'Something went wrong. Try again.';
/** A row arriving in a list, and the new token's panel opening; leaving is a little quicker. */
const ROW_MS = { enter: 200, exit: 150 };
/** How long "Copied" stays on a copy button before it reads "Copy" again. */
export const COPIED_MS = 2000;

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : GENERIC_ERROR);
/** The service's straight apostrophes as the curly ones the rest of the dialog uses. */
const typographic = (text: string) => text.replace(/'/g, '’');

/** "just now", "5 min ago", "today 14:05", "Oct 30, 14:05": after a verb ("Last used …"). */
function when(ms: number, now: number): string {
  const label = chinaRelativeTime(ms, now);
  return /^(Today|Yesterday) /.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

interface AgentAccessDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * "Agent access" (the avatar menu): how an AI agent reads this account's Yungu data, read-only. The
 * server URL to give an agent (it then signs in here and asks on the consent page); the agents
 * connected that way, each to disconnect; and personal tokens for agents that can't sign in — made
 * with a name, shown once to copy, listed by name and use, revoked after asking. Full-screen on phones.
 * The new token's secret is forgotten when the dialog closes.
 */
export default function AgentAccessDialog({ open, onClose }: AgentAccessDialogProps) {
  const router = useRouter();
  const titleId = useId();
  const fullScreen = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'));
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [access, setAccess] = useState<AgentAccess | null>(null);
  const [checkedAt, setCheckedAt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [created, setCreated] = useState<NewAgentToken | null>(null);
  const [announce, setAnnounce] = useState('');
  // Each change made here is a generation: answers to reads started before it are dropped.
  const generation = useRef(0);

  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  const ended = useCallback((error: unknown) => {
    if (!isSessionEnded(error)) return false;
    routerRef.current.replace('/login');
    return true;
  }, []);

  const load = useCallback(() => {
    const gen = generation.current;
    return fetchAgentAccess().then(
      (next) => {
        if (gen !== generation.current) return;
        setAccess(next);
        setCheckedAt(Date.now());
        setLoadFailed(false);
      },
      (error: unknown) => {
        if (gen !== generation.current || ended(error)) return;
        setLoadFailed(true);
      },
    );
  }, [ended]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /** After a change: what the service now holds (and drop any read that started before it). */
  const changed = useCallback(
    (update: (current: AgentAccess) => AgentAccess) => {
      generation.current += 1;
      setAccess((current) => current && update(current));
      void load();
    },
    [load],
  );

  const rowTimeout = reduceMotion ? 0 : ROW_MS;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      aria-labelledby={titleId}
      slotProps={{
        transition: {
          ...popIn(reduceMotion),
          ...(reduceMotion && { timeout: 0 }),
          // Shown once: the secret goes with the dialog, and the next opening starts fresh.
          onExited: () => {
            setCreated(null);
            setAnnounce('');
          },
        },
        paper: {
          sx: (theme) => ({
            bgcolor: theme.yungu.dialog.bg,
            backgroundImage: 'none',
            ...(!fullScreen && {
              m: 2,
              width: 'calc(100% - 32px)',
              maxWidth: 600,
              maxHeight: 'calc(100% - 32px)',
              borderRadius: `${theme.yungu.shape.extraLarge}px`,
            }),
          }),
        },
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, pl: { xs: 2, sm: 3 }, pr: { xs: 1, sm: 1.5 }, pt: 1.5, pb: 1 }}>
        <Typography id={titleId} variant="h2" component="h2" sx={{ flex: 1, minWidth: 0 }}>
          Agent access
        </Typography>
        <IconButton aria-label="Close" onClick={onClose}>
          <CloseRounded />
        </IconButton>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 2, sm: 3 }, pb: { xs: 'max(24px, env(safe-area-inset-bottom))', sm: 3 } }}>
        <Typography color="text.secondary" sx={{ maxWidth: '60ch' }}>
          AI agents such as Claude can read your assignments, schedule, feedback, points and notifications. They can’t hand in, comment or change anything.
        </Typography>

        <Section title="Server URL">
          <Secret text={MCP_URL} copyLabel="Copy server URL" copiedNote="Server URL copied" onNote={setAnnounce} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Add it to the agent as a remote MCP server (in Claude, a custom connector). It sends you here to sign in and choose Allow.
          </Typography>
        </Section>

        {loadFailed && !access ? (
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 3 }}>
            <Typography variant="body2" color="error">
              Couldn’t load agent access.
            </Typography>
            <Button size="small" onClick={() => void load()} sx={{ mr: -1 }}>
              Try again
            </Button>
          </Stack>
        ) : (
          <>
            <Section title="Connected agents">
              <Rows
                label="Connected agents"
                loading={!access}
                empty="No agents connected yet."
                timeout={rowTimeout}
                rows={(access?.clients ?? []).map((client) => ({
                  id: client.id,
                  node: (
                    <AgentRow
                      name={client.name}
                      meta={`Connected ${when(client.connectedAt, checkedAt)} · ${client.lastUsedAt ? `Last used ${when(client.lastUsedAt, checkedAt)}` : 'Not used yet'}`}
                      action="Disconnect"
                      busyAction="Disconnecting…"
                      onAct={async () => {
                        await disconnectAgent(client.id);
                        changed((a) => ({ ...a, clients: a.clients.filter((c) => c.id !== client.id) }));
                      }}
                      onEnded={ended}
                    />
                  ),
                }))}
              />
            </Section>

            <Section title="Personal tokens">
              <Typography variant="body2" color="text.secondary">
                For agents that can’t sign in themselves: the agent sends the token as{' '}
                <Box component="code" sx={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: '0.8125rem' }}>
                  Authorization: Bearer
                </Box>
                . It works until you revoke it.
              </Typography>
              <Collapse in={created !== null} timeout={rowTimeout} easing={EASE_OUT} unmountOnExit>
                {created && (
                  <NewToken
                    token={created}
                    onNote={setAnnounce}
                    onDone={() => {
                      setCreated(null);
                      setAnnounce('');
                    }}
                  />
                )}
              </Collapse>
              <CreateToken
                onCreated={(token) => {
                  setCreated(token);
                  changed((a) => ({ ...a, personal: [...a.personal, { id: token.id, name: token.name, createdAt: Date.now(), lastUsedAt: null }] }));
                }}
                onEnded={ended}
              />
              <Rows
                label="Personal tokens"
                loading={!access}
                empty="No tokens yet."
                timeout={rowTimeout}
                rows={(access?.personal ?? []).map((token) => ({
                  id: token.id,
                  node: (
                    <AgentRow
                      name={token.name}
                      meta={`Created ${when(token.createdAt, checkedAt)} · ${token.lastUsedAt ? `Last used ${when(token.lastUsedAt, checkedAt)}` : 'Never used'}`}
                      action="Revoke"
                      busyAction="Revoking…"
                      confirm="Agents using it stop working at once."
                      onAct={async () => {
                        await revokeAgentToken(token.id);
                        if (created?.id === token.id) setCreated(null);
                        changed((a) => ({ ...a, personal: a.personal.filter((t) => t.id !== token.id) }));
                      }}
                      onEnded={ended}
                    />
                  ),
                }))}
              />
            </Section>
          </>
        )}
      </Box>
      {/* One polite announcement for the copy buttons ("Token copied"). */}
      <Box role="status" sx={VISUALLY_HIDDEN}>
        {announce}
      </Box>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ mt: 3 }}>
      <Typography variant="h3" component="h3" sx={{ mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

interface RowsProps {
  label: string;
  loading: boolean;
  empty: string;
  timeout: number | { enter: number; exit: number };
  rows: { id: string; node: ReactNode }[];
}

/** A list of agents or tokens: rows open in and fold away as they come and go; a line when there are none. */
function Rows({ label, loading, empty, timeout, rows }: RowsProps) {
  if (loading) {
    return (
      <Box aria-hidden sx={{ mt: 1 }}>
        <Skeleton width="55%" />
        <Skeleton width="35%" />
      </Box>
    );
  }
  return (
    <>
      <Box component="ul" aria-label={label} sx={{ listStyle: 'none', p: 0, m: 0 }}>
        <TransitionGroup component={null}>
          {rows.map((row) => (
            <Collapse key={row.id} component="li" timeout={timeout} easing={EASE_OUT}>
              {row.node}
            </Collapse>
          ))}
        </TransitionGroup>
      </Box>
      {rows.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          {empty}
        </Typography>
      )}
    </>
  );
}

interface AgentRowProps {
  name: string;
  meta: string;
  /** The row's one action ("Revoke"), named with the row ("Revoke Laptop"). */
  action: string;
  busyAction: string;
  /** Asked first, in the row, when set: what the action does. */
  confirm?: string;
  onAct: () => Promise<void>;
  onEnded: (error: unknown) => boolean;
}

function AgentRow({ name, meta, action, busyAction, confirm, onAct, onEnded }: AgentRowProps) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);
  useEffect(() => {
    // Asking moves focus to Cancel (never to the destructive choice); Cancel brings it back.
    if (asking) cancelButton.current?.focus();
    else if (wasAsking.current) actionButton.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  async function act() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAct();
    } catch (e) {
      if (!onEnded(e)) setError(typographic(messageOf(e)));
      setBusy(false);
      setAsking(false);
    }
  }

  return (
    <Box sx={{ py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {meta}
          </Typography>
        </Box>
        {!asking && (
          <Button
            ref={actionButton}
            color="inherit"
            aria-label={`${action} ${name}`}
            aria-disabled={busy || undefined}
            onClick={() => (confirm ? setAsking(true) : void act())}
            sx={{ flexShrink: 0, mr: -1, '&[aria-disabled="true"]': { cursor: 'progress' } }}
          >
            {busy ? busyAction : action}
          </Button>
        )}
      </Stack>
      {asking && confirm && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ alignItems: { xs: 'stretch', sm: 'center' }, gap: 1, mt: 1, p: 1.5, borderRadius: 2, bgcolor: 'action.hover', ...ARRIVE_IN }}
        >
          <Typography variant="body2" sx={{ flex: 1, fontWeight: 500 }}>
            {action} {name}? {confirm}
          </Typography>
          <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
            <Button ref={cancelButton} color="inherit" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="error"
              aria-disabled={busy || undefined}
              onClick={() => void act()}
              sx={{ '&[aria-disabled="true"]': { cursor: 'progress' } }}
            >
              {busy ? busyAction : action}
            </Button>
          </Stack>
        </Stack>
      )}
      {error && (
        <Alert severity="error" role="alert" onClose={() => setError(null)} sx={{ mt: 1, ...ARRIVE_IN }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}

function CreateToken({ onCreated, onEnded }: { onCreated: (token: NewAgentToken) => void; onEnded: (error: unknown) => boolean }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await createAgentToken(name);
      setName('');
      onCreated(token);
    } catch (e) {
      if (!onEnded(e)) setError(typographic(messageOf(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack component="form" noValidate onSubmit={create} direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, mt: 2, mb: 1, alignItems: { sm: 'flex-start' } }}>
      <TextField
        label="Token name"
        placeholder="e.g. Laptop script"
        size="small"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={error !== null}
        helperText={error ?? undefined}
        slotProps={{ htmlInput: { maxLength: 64 } }}
        sx={{ flex: 1 }}
      />
      <Button
        type="submit"
        variant="outlined"
        aria-disabled={busy || undefined}
        sx={{ flexShrink: 0, minHeight: { xs: 48, sm: 40 }, '&[aria-disabled="true"]': { cursor: 'progress' } }}
      >
        {busy ? 'Creating…' : 'Create token'}
      </Button>
    </Stack>
  );
}

/** The new token, this once: the secret to copy, a warning that it won't be shown again, and Done. */
function NewToken({ token, onNote, onDone }: { token: NewAgentToken; onNote: (note: string) => void; onDone: () => void }) {
  const headingId = useId();
  const copyButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    copyButton.current?.focus();
  }, []);
  return (
    <Box
      role="region"
      aria-label={`New token: ${token.name}`}
      sx={(theme) => ({ mt: 2, p: 2, borderRadius: `${theme.yungu.shape.large}px`, bgcolor: theme.yungu.color.primaryContainer, color: theme.yungu.color.onPrimaryContainer })}
    >
      <Typography id={headingId} sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
        {token.name}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1.5 }}>
        Copy it now — you won’t see it again.
      </Typography>
      <Secret text={token.token} copyLabel="Copy token" copiedNote="Token copied" onNote={onNote} buttonRef={copyButton} tone="onContainer" />
      <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 1.5, mr: -1, mb: -0.5 }}>
        <Button color="inherit" onClick={onDone}>
          Done
        </Button>
      </Stack>
    </Box>
  );
}

interface SecretProps {
  text: string;
  copyLabel: string;
  copiedNote: string;
  onNote: (note: string) => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
  tone?: 'surface' | 'onContainer';
}

/**
 * A value to hand to an agent: in monospace (a click selects all of it), with Copy beside it. Copy turns
 * to "Copied" with a check for two seconds; when the browser refuses, the text is selected instead.
 */
function Secret({ text, copyLabel, copiedNote, onNote, buttonRef, tone = 'surface' }: SecretProps) {
  const [copied, setCopied] = useState(false);
  const value = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onNote(copiedNote);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      const node = value.current;
      if (node) window.getSelection()?.selectAllChildren(node);
      onNote('Couldn’t copy. It’s selected: copy it yourself.');
    }
  }

  return (
    // On phones the value takes the whole width (the server URL on one line) and Copy sits under it.
    <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ alignItems: { xs: 'stretch', sm: 'center' }, gap: 1 }}>
      <Box
        ref={value}
        component="code"
        sx={(theme) => ({
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          minHeight: 40,
          px: 1.5,
          py: 1,
          borderRadius: `${theme.yungu.shape.small}px`,
          fontFamily: 'var(--font-geist-mono), monospace',
          fontSize: { xs: '0.8125rem', sm: '0.875rem' },
          overflowWrap: 'anywhere',
          userSelect: 'all',
          bgcolor: tone === 'surface' ? theme.yungu.color.surfaceContainer : theme.yungu.color.surfaceContainerLowest,
          color: theme.yungu.color.onSurface,
        })}
      >
        {text}
      </Box>
      <Button
        ref={buttonRef}
        variant={tone === 'surface' ? 'outlined' : 'contained'}
        aria-label={copyLabel}
        onClick={() => void copy()}
        startIcon={
          <Box component="span" sx={{ position: 'relative', display: 'inline-flex', width: 18, height: 18 }}>
            <CopyGlyph shown={!copied}>
              <ContentCopyRounded sx={{ fontSize: 18 }} />
            </CopyGlyph>
            <CopyGlyph shown={copied}>
              <CheckRounded sx={{ fontSize: 18 }} />
            </CopyGlyph>
          </Box>
        }
        // Wide enough for "Copied", so the label swap never changes the button's width.
        sx={{ flexShrink: 0, minWidth: 104, minHeight: { xs: 48, sm: 40 } }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </Stack>
  );
}

/** One of the copy button's two icons: the other crossfades in from slightly smaller. */
function CopyGlyph({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'inline-flex',
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'scale(0.6)',
        transition: `opacity 150ms ${EASE_OUT}, transform 150ms ${EASE_OUT}`,
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', transform: 'none' },
      }}
    >
      {children}
    </Box>
  );
}
