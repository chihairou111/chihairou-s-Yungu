'use client';
import { useCallback, useEffect, useId, useRef, useState, type Ref } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import NotificationsOutlined from '@mui/icons-material/NotificationsOutlined';
import { chinaMonth, earliestMonth } from '@/lib/behaviour';
import { chinaRelativeTime } from '@/lib/time';
import type { Notification } from '@/lib/types';
import { ApiError, isSessionEnded } from './detail/api';
import { EASE_OUT } from './detail/motion';
import { openTaskHere } from './detail/useTaskParam';
import { fetchNotifications, fetchUnreadCount, markNotificationRead } from './notifications-api';
import { useOnRefresh } from './RefreshContext';
import { useTitleCount } from './useTitleCount';

/** How often the unread count is checked again while the tab is visible. */
export const POLL_MS = 5 * 60_000;
/** The menu growing from the bell, and shrinking back into it. */
const MENU_IN_MS = 200;
const MENU_OUT_MS = 150;
/** An item folding out of Unread or into Read. */
const FOLD_MS = 200;
/** The page that mounts the assignment pop-up. */
const ASSIGNMENTS = '/assignments';
const BEHAVIOUR = '/behaviour';

/** Where an item leads: an assignment, the Behaviour page, or nowhere. */
const opens = (n: Notification) => n.taskId !== null || n.target === 'behaviour';

type Kind = 'unread' | 'read';

interface Section {
  items: Notification[];
  /** The last page loaded (0 before the first). */
  page: number;
  hasMore: boolean;
  status: 'loading' | 'ready' | 'error';
}

const LOADING: Section = { items: [], page: 0, hasMore: false, status: 'loading' };
const newestFirst = (a: Notification, b: Notification) => b.createdAt - a.createdAt;
const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.');

/** Adds `more` after `items`, skipping any already there (a page boundary can shift after a mark). */
function append(items: Notification[], more: Notification[]): Notification[] {
  const seen = new Set(items.map((n) => n.id));
  return [...items, ...more.filter((n) => !seen.has(n.id))];
}

/**
 * The bell in the app bar, left of Refresh. While anything is unread: a red numbered badge, the count
 * in the button's name and in the tab title ("(N) chihairou's Yungu"), checked on load, on Refresh, and every 5 minutes while the tab is visible. It opens a
 * popover: Unread, then Read (20 at a time). Mark as read moves an item down at once (put back, with
 * the reason, if Yungu refuses). An item about an assignment opens it in the pop-up and, like Yungu's
 * own bell, marks it read; a behaviour record opens the Behaviour page at its month.
 */
export default function NotificationsMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const headingId = useId();
  const [unread, setUnread] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [sections, setSections] = useState<Record<Kind, Section>>({ unread: LOADING, read: LOADING });
  const [openedAt, setOpenedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Marked read and folding out of Unread (still listed until the fold ends); and the items that just
  // arrived in Read, which unfold into place (the rest of a list never animates).
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [arrived, setArrived] = useState<ReadonlySet<string>>(new Set());
  // Each opening is a generation: answers to an earlier one are dropped.
  const generation = useRef(0);
  const unreadHeading = useRef<HTMLHeadingElement>(null);

  // The dot is a hint: a failed check keeps the last count (none yet: no dot).
  const loadCount = useCallback(() => fetchUnreadCount().then(setUnread, () => {}), []);

  useEffect(() => {
    // A tick missed while hidden is made up as soon as the tab is visible again.
    let missed = false;
    void loadCount();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadCount();
      else missed = true;
    }, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && missed) {
        missed = false;
        void loadCount();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadCount]);

  // The router is only used in callbacks; a ref keeps them stable whatever object the hook hands back.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });

  const loadPage = useCallback(async (kind: Kind, page: number) => {
    const gen = generation.current;
    if (page > 1) setSections((s) => ({ ...s, [kind]: { ...s[kind], status: 'loading' } }));
    try {
      const result = await fetchNotifications(kind === 'read', page);
      if (gen !== generation.current) return;
      setSections((s) => ({
        ...s,
        [kind]: { items: page === 1 ? result.items : append(s[kind].items, result.items), page, hasMore: result.hasMore, status: 'ready' },
      }));
      // The whole unread list is in: it is the count.
      if (kind === 'unread' && page === 1 && !result.hasMore) setUnread(result.items.length);
    } catch (e) {
      if (gen !== generation.current) return;
      if (isSessionEnded(e)) routerRef.current.replace('/login');
      else setSections((s) => ({ ...s, [kind]: { ...s[kind], status: 'error' } }));
    }
  }, []);

  const loadLists = useCallback(() => {
    generation.current += 1;
    setSections({ unread: LOADING, read: LOADING });
    void loadPage('unread', 1);
    void loadPage('read', 1);
  }, [loadPage]);

  const isOpen = anchor !== null;

  useOnRefresh(() => {
    void loadCount();
    if (isOpen) loadLists();
  });

  function open(target: HTMLElement) {
    setOpenedAt(Date.now());
    setError(null);
    setLeaving(new Set());
    setArrived(new Set());
    setAnchor(target);
    loadLists();
  }

  function close() {
    generation.current += 1;
    setAnchor(null);
  }

  const without = (set: ReadonlySet<string>, id: string) => new Set([...set].filter((x) => x !== id));

  /** The fold out of Unread is over: the item leaves that list for good. */
  function gone(id: string) {
    // Only a fold that ran to its end calls this: a failed mark unfolds the item instead, and never exits.
    setLeaving((l) => without(l, id));
    setSections((s) => ({ ...s, unread: { ...s.unread, items: s.unread.items.filter((x) => x.id !== id) } }));
  }

  async function markRead(n: Notification, { refocus }: { refocus: boolean }) {
    setError(null);
    setLeaving((l) => new Set(l).add(n.id));
    setArrived((a) => new Set(a).add(n.id));
    setSections((s) => ({ ...s, read: { ...s.read, items: [{ ...n, read: true }, ...s.read.items.filter((x) => x.id !== n.id)] } }));
    setUnread((c) => (c === null ? c : Math.max(0, c - 1)));
    // The button goes with its item: focus moves to the section, never to the page behind.
    if (refocus) unreadHeading.current?.focus();
    try {
      await markNotificationRead(n.id);
    } catch (e) {
      if (isSessionEnded(e)) {
        router.replace('/login');
        return;
      }
      // Back where it was: unfolds again if it is still folding, else returns to the list.
      setLeaving((l) => without(l, n.id));
      setSections((s) => ({
        unread: { ...s.unread, items: [...s.unread.items.filter((x) => x.id !== n.id), n].sort(newestFirst) },
        read: { ...s.read, items: s.read.items.filter((x) => x.id !== n.id) },
      }));
      setUnread((c) => (c === null ? c : c + 1));
      setError(message(e));
    }
  }

  function openItem(n: Notification) {
    if (!opens(n)) return;
    close();
    if (!n.read) void markRead(n, { refocus: false });
    if (n.taskId === null) {
      // A behaviour record: the month it was sent in (China time); this month's page for a new one, or one
      // older than the page steps back to (or with no time at all).
      const month = chinaMonth(n.createdAt);
      const plain = month < earliestMonth(Date.now()) || month >= chinaMonth(Date.now());
      router.push(plain ? BEHAVIOUR : `${BEHAVIOUR}?month=${month}`);
    } else if (pathname === ASSIGNMENTS) openTaskHere(n.taskId);
    else router.push(`${ASSIGNMENTS}?task=${n.taskId}`);
  }

  const count = unread ?? 0;
  useTitleCount(count);
  const unreadSection = sections.unread;
  const unreadShown =
    unreadSection.status === 'ready' && !unreadSection.hasMore ? unreadSection.items.filter((n) => !leaving.has(n.id)).length : count;

  return (
    <>
      <Tooltip title="Notifications" describeChild>
        <IconButton
          aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
          aria-haspopup="dialog"
          aria-expanded={isOpen ? 'true' : undefined}
          onClick={(e) => open(e.currentTarget)}
          sx={{ color: 'text.secondary' }}
        >
          <Badge
            badgeContent={count}
            max={99}
            color="error"
            overlap="rectangular"
            invisible={count === 0}
            sx={(theme) => ({
              // Ringed in the app bar's own surface, so the badge reads as cut out of the bell.
              // Off the bell's top-right corner, so the bell stays readable under it.
              '& .MuiBadge-badge': {
                top: 1,
                right: -3,
                minWidth: 18,
                height: 18,
                px: 0.5,
                borderRadius: 9,
                fontSize: '0.6875rem',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                border: '2px solid',
                borderColor: theme.yungu.header.bg,
                boxSizing: 'content-box',
              },
              '@media (prefers-reduced-motion: reduce)': { '& .MuiBadge-badge': { transition: 'none' } },
            })}
          >
            <NotificationsOutlined />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        anchorEl={anchor}
        open={isOpen}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        // Grows from the bell on the pop-up's strong ease-out, at a fixed pace: MUI's 'auto' timing
        // stretches with the list's height (to ~380ms when full); leaving is quicker than arriving.
        // (The Popover's own prop: a `timeout` in the transition's slot props is overridden by it.)
        transitionDuration={reduceMotion ? 0 : { enter: MENU_IN_MS, exit: MENU_OUT_MS }}
        slotProps={{
          transition: { easing: EASE_OUT },
          paper: {
            role: 'dialog',
            'aria-labelledby': headingId,
            sx: (theme) => ({
              mt: 1,
              width: 380,
              maxWidth: 'calc(100vw - 16px)',
              maxHeight: 'min(600px, calc(100dvh - 96px))',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: `${theme.yungu.shape.large}px`,
            }),
          },
        }}
      >
        <Box sx={{ px: 2, pt: 1.75, pb: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
          <Typography id={headingId} variant="h3" component="h2">
            Notifications
          </Typography>
        </Box>
        <Box sx={{ overflowY: 'auto', overscrollBehavior: 'contain', pb: 1 }}>
          {error && (
            <Alert severity="error" role="alert" onClose={() => setError(null)} sx={{ mx: 2, mt: 1.5 }}>
              {error}
            </Alert>
          )}
          <SectionView
            kind="unread"
            label={unreadSection.status === 'ready' || unread !== null ? `Unread (${unreadShown})` : 'Unread'}
            headingRef={unreadHeading}
            section={unreadSection}
            leaving={leaving}
            onGone={gone}
            now={openedAt}
            reduceMotion={reduceMotion}
            empty="No unread notifications"
            onOpen={openItem}
            onMarkRead={(n) => void markRead(n, { refocus: true })}
            onMore={() => void loadPage('unread', unreadSection.page + 1)}
            onRetry={() => void loadPage('unread', Math.max(1, unreadSection.page + (unreadSection.items.length ? 1 : 0)))}
          />
          <SectionView
            kind="read"
            label="Read"
            section={sections.read}
            arrived={arrived}
            now={openedAt}
            reduceMotion={reduceMotion}
            empty="No read notifications"
            onOpen={openItem}
            onMore={() => void loadPage('read', sections.read.page + 1)}
            onRetry={() => void loadPage('read', Math.max(1, sections.read.page + (sections.read.items.length ? 1 : 0)))}
          />
        </Box>
      </Popover>
    </>
  );
}

interface SectionViewProps {
  kind: Kind;
  label: string;
  headingRef?: Ref<HTMLHeadingElement>;
  section: Section;
  /** Ids folding out of this list. */
  leaving?: ReadonlySet<string>;
  onGone?(id: string): void;
  /** Ids that just moved into this list. */
  arrived?: ReadonlySet<string>;
  now: number;
  reduceMotion: boolean;
  empty: string;
  onOpen(n: Notification): void;
  onMarkRead?(n: Notification): void;
  onMore(): void;
  onRetry(): void;
}

const NONE: ReadonlySet<string> = new Set();

function SectionView(props: SectionViewProps) {
  const { kind, label, headingRef, section, now, reduceMotion, empty, onOpen, onMarkRead, onMore, onRetry } = props;
  const { leaving = NONE, onGone, arrived = NONE } = props;
  const headingId = useId();
  const first = section.status === 'loading' && section.page === 0;
  const shown = section.items.filter((n) => !leaving.has(n.id)).length;
  return (
    <Box component="section" aria-labelledby={headingId} sx={{ pt: 1.5 }}>
      <Typography
        id={headingId}
        ref={headingRef}
        tabIndex={headingRef ? -1 : undefined}
        variant="body2"
        component="h3"
        color="text.secondary"
        sx={{ px: 2, pb: 0.5, fontWeight: 500, '&:focus': { outline: 'none' }, '&:focus-visible': { outline: 2, outlineColor: 'primary.main' } }}
      >
        {label}
      </Typography>
      {first ? (
        <Box aria-hidden sx={{ px: 2, py: 1 }}>
          {[0, 1].map((i) => (
            <Box key={i} sx={{ py: 0.75 }}>
              <Skeleton width="70%" />
              <Skeleton width="90%" />
            </Box>
          ))}
        </Box>
      ) : shown === 0 && leaving.size === 0 && section.status !== 'error' ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
          {empty}
        </Typography>
      ) : (
        <Box component="ul" aria-label={kind === 'unread' ? 'Unread' : 'Read'} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {section.items.map((n) => {
            const going = leaving.has(n.id);
            return (
              <Collapse
                key={n.id}
                component="li"
                in={!going}
                appear={arrived.has(n.id)}
                timeout={reduceMotion ? 0 : FOLD_MS}
                onExited={() => onGone?.(n.id)}
                inert={going || undefined}
                aria-hidden={going || undefined}
              >
                <Item n={n} now={now} onOpen={onOpen} onMarkRead={onMarkRead} />
              </Collapse>
            );
          })}
        </Box>
      )}
      {section.status === 'error' && (
        <Stack direction="row" sx={{ px: 2, py: 1, alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="error">
            Couldn’t load notifications.
          </Typography>
          <Button size="small" onClick={onRetry}>
            Try again
          </Button>
        </Stack>
      )}
      {section.hasMore && section.status !== 'error' && (
        <Box sx={{ px: 1, pt: 0.5 }}>
          <Button
            size="small"
            onClick={onMore}
            aria-disabled={section.status === 'loading' || undefined}
            sx={{ '&[aria-disabled="true"]': { cursor: 'progress' } }}
          >
            {section.status === 'loading' ? 'Loading…' : 'Load more'}
          </Button>
        </Box>
      )}
    </Box>
  );
}

function Item({ n, now, onOpen, onMarkRead }: { n: Notification; now: number; onOpen(n: Notification): void; onMarkRead?(n: Notification): void }) {
  const titleId = useId();
  const clickable = opens(n);
  const title = (
    <Typography
      id={titleId}
      component="span"
      variant="body2"
      sx={{ display: 'block', fontWeight: n.read ? 500 : 600, overflowWrap: 'anywhere' }}
    >
      {n.title}
    </Typography>
  );
  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        display: 'flex',
        gap: 1.25,
        px: 2,
        py: 1.25,
        '&:has(button[data-open]:focus-visible)': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      })}
    >
      <Box
        aria-hidden
        sx={{ flexShrink: 0, mt: '7px', width: 8, height: 8, borderRadius: '50%', bgcolor: n.read ? 'transparent' : 'primary.main' }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {clickable ? (
          <Box
            component="button"
            type="button"
            data-open=""
            onClick={() => onOpen(n)}
            sx={(theme) => ({
              display: 'block',
              width: '100%',
              p: 0,
              m: 0,
              border: 0,
              bgcolor: 'transparent',
              font: 'inherit',
              color: 'inherit',
              textAlign: 'start',
              cursor: 'pointer',
              '&:focus-visible': { outline: 'none' },
              // The hit area (and hover layer) covers the whole row; Mark as read sits above it.
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: 0,
                transition: theme.transitions.create('background-color', { duration: theme.transitions.duration.shortest, easing: 'ease' }),
              },
              '&:hover::after': { bgcolor: 'action.hover' },
              '&:active::after': { bgcolor: 'action.selected' },
              '@media (prefers-reduced-motion: reduce)': { '&::after': { transition: 'none' } },
            })}
          >
            {title}
          </Box>
        ) : (
          title
        )}
        {n.body && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', mt: 0.25 }}
          >
            {n.body}
          </Typography>
        )}
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, mt: 0.25, minHeight: 30 }}>
          <Typography component="time" dateTime={new Date(n.createdAt).toISOString()} variant="caption" color="text.secondary">
            {chinaRelativeTime(n.createdAt, now)}
          </Typography>
          {!n.read && onMarkRead && (
            <Button size="small" aria-describedby={titleId} onClick={() => onMarkRead(n)} sx={{ position: 'relative', zIndex: 1, mr: -1 }}>
              Mark as read
            </Button>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
