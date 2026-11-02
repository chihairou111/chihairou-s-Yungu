'use client';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import CancelRounded from '@mui/icons-material/CancelRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { chinaRelativeTime } from '@/lib/time';
import { todoistWhyMessage } from '@/lib/todoist';
import type { TodoistStatus } from '@/lib/types';
import { ApiError, isSessionEnded } from './detail/api';
import { EASE_OUT } from './detail/motion';
import { useOnRefresh } from './RefreshContext';
import TodoistIcon from './TodoistIcon';
import { SIGN_IN_AGAIN_PATH, TODOIST_CONNECT_PATH, disconnectTodoist, fetchTodoistStatus, syncTodoist } from './todoist-api';

/** How often the status is checked again while the tab is visible (the badge). */
export const POLL_MS = 5 * 60_000;
/** While a sync runs: how soon to look again, so "Syncing…" (or the badge) turns over when it ends. */
export const SYNC_POLL_MS = 3000;
/** The menu growing from the icon, and shrinking back into it (as the notifications menu does). */
const MENU_IN_MS = 200;
const MENU_OUT_MS = 150;
/** The red × arriving on the icon, and leaving it. */
const BADGE_MS = 200;
const BADGE_OUT_MS = 150;
const GENERIC_ERROR = 'Something went wrong. Try again.';

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : GENERIC_ERROR);

/** The service's straight apostrophes as the curly ones the rest of the menu uses. */
const typographic = (text: string) => text.replace(/'/g, '\u2019');

/** "Synced 3 min ago", "Synced today 14:05", "Synced Oct 30, 14:05". */
function syncedLabel(lastSyncAt: number, now: number): string {
  const when = chinaRelativeTime(lastSyncAt, now);
  return `Synced ${/^(Today|Yesterday) /.test(when) ? when[0].toLowerCase() + when.slice(1) : when}`;
}

/** The query the connect routes send the browser back with: shown once, then taken out of the URL. */
function takeReturnResult(): { note: string | null } | null {
  const url = new URL(window.location.href);
  const result = url.searchParams.get('todoist');
  if (result !== 'connected' && result !== 'error') return null;
  const why = url.searchParams.get('why');
  url.searchParams.delete('todoist');
  url.searchParams.delete('why');
  // The native History API, which Next keeps its search params in step with.
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return { note: result === 'error' ? todoistWhyMessage(why) : null };
}

/**
 * Todoist in the app bar, first in the icon row (Todoist · Notifications · Refresh · avatar). The icon
 * says nothing while all is well, not even while a sync runs; only when the account's sync is stuck
 * does a red circle with a white × sit on its corner (and its name become "Todoist, sync problem").
 * The status is read on load, after Refresh (which starts a sync), on opening, every 5 minutes while the
 * tab is visible, and every 3 seconds while a sync runs. The menu: Connect Todoist; or the connected
 * account, its last sync and Disconnect; or what is wrong and the one action that fixes it. Coming back
 * from Todoist (`?todoist=connected|error`) opens it once on the result. Nothing in the task views.
 */
export default function TodoistMenu() {
  const router = useRouter();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const headingId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<TodoistStatus | null>(null);
  const [checkedAt, setCheckedAt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // What came back from Todoist (an error's reason), and why the last action failed.
  const [note, setNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'sync' | 'disconnect' | null>(null);
  // Each change made here is a generation: answers to reads started before it are dropped.
  const generation = useRef(0);
  const isOpen = anchor !== null;
  const open = useRef(false);

  // The router is only used in callbacks; a ref keeps them stable whatever object the hook hands back.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  const load = useCallback(() => {
    const gen = generation.current;
    return fetchTodoistStatus().then(
      (next) => {
        if (gen !== generation.current) return;
        setStatus(next);
        setCheckedAt(Date.now());
        setLoadFailed(false);
      },
      (e: unknown) => {
        if (gen !== generation.current) return;
        // Closed, the icon keeps what it last knew; the page itself sends an ended session to sign in.
        if (isSessionEnded(e) && open.current) routerRef.current.replace('/login');
        else setLoadFailed(true);
      },
    );
  }, []);

  const show = useCallback(
    (target: HTMLElement | null, withNote: string | null) => {
      if (!target) return;
      open.current = true;
      setNote(withNote);
      setActionError(null);
      setAnchor(target);
      void load();
    },
    [load],
  );

  function close() {
    open.current = false;
    setAnchor(null);
  }

  // Back from Todoist: read (and cleaned out of the URL) once, kept here should the effect run again.
  const returned = useRef<{ note: string | null } | null>(null);
  useEffect(() => {
    void load();
    returned.current ??= takeReturnResult();
    const result = returned.current;
    if (!result) return;
    // Opened once the bar is laid out, so the menu is placed under the icon.
    const frame = requestAnimationFrame(() => {
      returned.current = null;
      show(button.current, result.note);
    });
    return () => cancelAnimationFrame(frame);
  }, [load, show]);

  const syncing = status?.state === 'syncing';
  useEffect(() => {
    // A tick missed while hidden is made up as soon as the tab is visible again.
    let missed = false;
    const timer = setInterval(
      () => {
        if (document.visibilityState === 'visible') void load();
        else missed = true;
      },
      syncing ? SYNC_POLL_MS : POLL_MS,
    );
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && missed) {
        missed = false;
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, syncing]);

  // Refresh has just started a sync on the service: pick it up (and the badge clears while it runs).
  useOnRefresh(() => void load());

  async function act(kind: 'sync' | 'disconnect') {
    if (busy) return;
    setBusy(kind);
    setActionError(null);
    setNote(null);
    try {
      if (kind === 'sync') {
        await syncTodoist();
      } else {
        await disconnectTodoist();
        generation.current += 1;
        setStatus({ connected: false, state: 'ok' });
      }
      await load();
    } catch (e) {
      if (isSessionEnded(e)) router.replace('/login');
      else setActionError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  const problem = status?.connected === true && status.state === 'error';

  return (
    <>
      {/* Plain: the button's own name already says when something is wrong. */}
      <Tooltip title="Todoist" describeChild>
        <IconButton
          ref={button}
          aria-label={problem ? 'Todoist, sync problem' : 'Todoist'}
          aria-haspopup="dialog"
          aria-expanded={isOpen ? 'true' : undefined}
          onClick={(e) => show(e.currentTarget, null)}
          sx={{ color: 'text.secondary' }}
        >
          <Badge
            badgeContent={<CloseRounded aria-hidden />}
            color="error"
            overlap="rectangular"
            invisible={!problem}
            sx={(theme) => ({
              // A red circle with a white ×, ringed in the app bar's own surface so it reads as cut out of
              // the icon, pinned to its top-right corner (like the bell's count beside it).
              '& .MuiBadge-badge': {
                top: 3,
                right: 1,
                // As tall as the bell's count badge beside it, so the two marks sit as a pair.
                width: 16,
                minWidth: 16,
                height: 16,
                p: 0,
                borderRadius: '50%',
                border: '2px solid',
                borderColor: theme.yungu.header.bg,
                boxSizing: 'content-box',
                '& svg': { fontSize: 12 },
                // Arrives from half size and fades, never from nothing (MUI's default is scale(0)), on the
                // menus' ease-out; it leaves the same way, a little quicker.
                transition: `transform ${BADGE_MS}ms ${EASE_OUT}, opacity ${BADGE_MS}ms ${EASE_OUT}`,
                '&.MuiBadge-invisible': {
                  transform: 'scale(0.5) translate(var(--Badge-translate))',
                  opacity: 0,
                  transition: `transform ${BADGE_OUT_MS}ms ${EASE_OUT}, opacity ${BADGE_OUT_MS}ms ${EASE_OUT}`,
                },
              },
              '@media (prefers-reduced-motion: reduce)': { '& .MuiBadge-badge, & .MuiBadge-badge.MuiBadge-invisible': { transition: 'none' } },
            })}
          >
            <TodoistIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        anchorEl={anchor}
        open={isOpen}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        // Grows from the icon on the pop-up's strong ease-out at a fixed pace; leaving is quicker.
        transitionDuration={reduceMotion ? 0 : { enter: MENU_IN_MS, exit: MENU_OUT_MS }}
        slotProps={{
          transition: { easing: EASE_OUT },
          paper: {
            role: 'dialog',
            'aria-labelledby': headingId,
            sx: (theme) => ({
              mt: 1,
              width: 340,
              maxWidth: 'calc(100vw - 16px)',
              borderRadius: `${theme.yungu.shape.large}px`,
            }),
          },
        }}
      >
        <Box sx={{ px: 2, pt: 1.75, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
          <Typography id={headingId} variant="h3" component="h2">
            Todoist
          </Typography>
        </Box>
        <Stack sx={{ px: 2, pt: 1.5, pb: 1.5, gap: 1.5 }}>
          {note && (
            <Alert severity="error" role="alert" onClose={() => setNote(null)}>
              {note}
            </Alert>
          )}
          {actionError && (
            <Alert severity="error" role="alert" onClose={() => setActionError(null)}>
              {actionError}
            </Alert>
          )}
          <MenuBody status={status} loadFailed={loadFailed} now={checkedAt} busy={busy} onRetryLoad={() => void load()} onAct={act} />
        </Stack>
      </Popover>
    </>
  );
}

interface MenuBodyProps {
  status: TodoistStatus | null;
  loadFailed: boolean;
  now: number;
  busy: 'sync' | 'disconnect' | null;
  onRetryLoad(): void;
  onAct(kind: 'sync' | 'disconnect'): void;
}

/** The menu's actions row: secondary first, the main action last, at the end (as in a dialog). */
function Actions({ children }: { children: ReactNode }) {
  return <Stack direction="row" sx={{ justifyContent: 'flex-end', alignItems: 'center', gap: 1, mr: -1, mb: -0.5 }}>{children}</Stack>;
}

/** A button that stays focusable while its action runs, marked disabled (`aria-disabled`). */
const pending = (running: boolean) => ({
  'aria-disabled': running || undefined,
  sx: { '&[aria-disabled="true"]': { cursor: 'progress' } },
});

function MenuBody({ status, loadFailed, now, busy, onRetryLoad, onAct }: MenuBodyProps) {
  if (!status) {
    return loadFailed ? (
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="body2" color="error">
          Couldn’t load your Todoist connection.
        </Typography>
        <Button size="small" onClick={onRetryLoad} sx={{ mr: -1 }}>
          Try again
        </Button>
      </Stack>
    ) : (
      <Box aria-hidden>
        <Skeleton width="80%" />
        <Skeleton width="45%" />
      </Box>
    );
  }

  if (!status.connected) {
    return (
      <>
        <Typography variant="body2" color="text.secondary">
          Your unfinished assignments go to your Todoist Inbox, each with its due date and a link back here.
        </Typography>
        <Actions>
          <Button variant="contained" href={TODOIST_CONNECT_PATH}>
            Connect Todoist
          </Button>
        </Actions>
      </>
    );
  }

  const error = status.state === 'error' ? status.error : undefined;
  const disconnecting = busy === 'disconnect';
  const disconnect = (
    // Never the menu's main action: neutral, so it does not read as the thing to press.
    <Button {...pending(disconnecting)} onClick={() => onAct('disconnect')} color="inherit">
      {disconnecting ? 'Disconnecting…' : 'Disconnect'}
    </Button>
  );
  const fix =
    error?.code === 'reauth' ? (
      <Button variant="contained" href={TODOIST_CONNECT_PATH}>
        Reconnect
      </Button>
    ) : error?.code === 'signin' ? (
      <Button variant="contained" href={SIGN_IN_AGAIN_PATH}>
        Sign in again
      </Button>
    ) : error ? (
      <Button variant="contained" {...pending(busy === 'sync')} onClick={() => onAct('sync')}>
        Try again
      </Button>
    ) : null;

  return (
    <>
      <Box>
        <Typography variant="body1" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
          {status.account ? `Connected to Todoist · ${status.account}` : 'Connected to Todoist'}
        </Typography>
        <Typography role="status" variant="body2" color="text.secondary">
          {status.state === 'syncing' ? 'Syncing…' : status.lastSyncAt ? syncedLabel(status.lastSyncAt, now) : 'Not synced yet'}
        </Typography>
      </Box>
      {error && (
        <Stack direction="row" sx={{ gap: 1, alignItems: 'flex-start' }}>
          {/* The badge's own mark, so the reason reads as the explanation of the × on the icon. */}
          <CancelRounded aria-hidden color="error" sx={{ fontSize: 20, mt: '1px', flexShrink: 0 }} />
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {typographic(error.message)}
          </Typography>
        </Stack>
      )}
      <Actions>
        {disconnect}
        {fix}
      </Actions>
    </>
  );
}
