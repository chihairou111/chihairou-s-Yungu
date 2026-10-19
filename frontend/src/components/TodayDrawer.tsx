'use client';
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Fab from '@mui/material/Fab';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Close from '@mui/icons-material/Close';
import EventNote from '@mui/icons-material/EventNote';
import { chinaShortDate } from '@/lib/time';
import { todayPanelCookie } from '@/lib/today-panel';
import type { ClassEvent, Course } from '@/lib/types';
import { TODAY_PANEL_ATTR, TODAY_PANEL_PX } from './PageHeader';
import TodayClasses from './TodayClasses';
import { useNow } from './useNow';

const DRAWER_ID = 'today-drawer';
const TITLE_ID = 'today-drawer-title';
const PANEL_ID = 'today-panel';
const PANEL_TITLE_ID = 'today-panel-title';
/** From this width the classes dock as a panel beside the content; below it they open in a drawer. */
export const DOCK_QUERY = '(min-width: 900px)';
const DOCKED_MEDIA = `@media ${DOCK_QUERY}`;
/** Docked, but on a touch screen: no hover, so the button stays shown at the bottom right. */
const DOCKED_TOUCH_MEDIA = `@media (hover: none) and ${DOCK_QUERY}`;
/** Distance from the right edge within which the pointer reveals the button. */
export const EDGE_ZONE_PX = 56;
/** Below the app bar, so the edge never competes with the account button. */
const APP_BAR_PX = 64;
/** Where the button parks at the bottom right instead: touch screens and narrow windows. */
export const BOTTOM_FAB_MEDIA = '@media (hover: none), (max-width: 899.95px)';
const EASE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';

function subscribeDock(onChange: () => void) {
  const query = window.matchMedia?.(DOCK_QUERY);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

/** True from 900px. The server assumes a wide window, so a stored open panel renders open at once. */
function useDocked(): boolean {
  return useSyncExternalStore(
    subscribeDock,
    () => window.matchMedia?.(DOCK_QUERY).matches ?? false,
    () => true,
  );
}

/** True when a pointer at (x, y) is in the right-edge zone below the app bar. */
export function shouldRevealEdgeButton(x: number, y: number, viewportWidth: number, appBarHeight: number): boolean {
  return x >= viewportWidth - EDGE_ZONE_PX && y >= appBarHeight;
}

/**
 * Watches the pointer passively (a window listener, throttled to one check per frame), so no
 * element covers the page. True while the pointer is near the right edge of the layout viewport
 * (`clientWidth` excludes a classic scrollbar, unlike `innerWidth`) or over the button itself.
 */
function useEdgeReveal(buttonRef: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    let frame = 0;
    let last: PointerEvent | null = null;
    const check = () => {
      frame = 0;
      if (!last) return;
      const overButton = last.target instanceof Node && !!buttonRef.current?.contains(last.target);
      const width = document.documentElement.clientWidth;
      setNear(overButton || shouldRevealEdgeButton(last.clientX, last.clientY, width, APP_BAR_PX));
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(check);
    };
    const hide = () => {
      last = null;
      setNear(false);
    };
    const root = document.documentElement;
    window.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', hide);
    window.addEventListener('blur', hide);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', hide);
      window.removeEventListener('blur', hide);
    };
  }, [buttonRef]);
  return near;
}

interface TodayDrawerProps {
  /** Today's classes, already selected and ordered by `todaysClasses`. */
  events: ClassEvent[];
  /** Server time; the list then follows the device clock (Now / Next, the date). */
  now: number;
  /** For each class's course-color dot. */
  courses: Course[];
  /** The docked panel's stored state (the `yl_today_panel` cookie, read on the server). */
  initialPanelOpen?: boolean;
}

/**
 * Today's classes. From 900px they dock as a panel on the right, part of the page: the content
 * narrows to make room, and the panel stays open (remembered in a cookie) until it is closed. Below
 * 900px they open in a temporary drawer instead. One round button toggles either: on wide pointer
 * screens it sits mid-right and appears when the pointer nears the right edge or it has focus; on
 * touch screens and narrow windows it is always shown bottom-right.
 */
export default function TodayDrawer({ events, now: serverNow, courses, initialPanelOpen = false }: TodayDrawerProps) {
  const now = useNow(serverNow);
  const docked = useDocked();
  const [panelOpen, setPanelOpen] = useState(initialPanelOpen);
  // The list stays mounted while the panel slides out; it mounts again (and scrolls to Now) on open.
  const [panelBody, setPanelBody] = useState(initialPanelOpen);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const near = useEdgeReveal(buttonRef);
  // Any focus keeps it shown, including the focus MUI restores after a mouse close of the drawer.
  const [focused, setFocused] = useState(false);
  const expanded = docked ? panelOpen : drawerOpen;

  function setPanel(open: boolean) {
    document.cookie = todayPanelCookie(open);
    if (open) setPanelBody(true);
    setPanelOpen(open);
  }

  return (
    <>
      <Fab
        size="small"
        color="primary"
        aria-label="Today's classes"
        aria-expanded={expanded}
        aria-controls={docked ? PANEL_ID : drawerOpen ? DRAWER_ID : undefined}
        ref={buttonRef}
        // The edge is the panel while it is open, so hovering there no longer reveals the button.
        data-revealed={near && !panelOpen}
        data-focused={focused}
        data-panel={panelOpen ? 'open' : 'closed'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => (docked ? setPanel(!panelOpen) : setDrawerOpen(true))}
        sx={(theme) => ({
          position: 'fixed',
          // Above the docked panel, whose edge it straddles while the panel is open.
          zIndex: theme.zIndex.appBar,
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          opacity: 0,
          pointerEvents: 'none',
          transition: `opacity 160ms ${EASE}`,
          '&[data-revealed="true"], &[data-focused="true"]': { opacity: 1, pointerEvents: 'auto' },
          // Material's standard FAB spot, always visible, clear of the safe area.
          [BOTTOM_FAB_MEDIA]: {
            top: 'auto',
            transform: 'none',
            right: 16,
            bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
            opacity: 1,
            pointerEvents: 'auto',
          },
          // On phones, centred on the bottom nav pill (16 + 56/2 - 40/2 = 24 from the bottom).
          [theme.breakpoints.down('sm')]: { bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))' },
          // While the panel is open its own button closes it: this one shows only for keyboard focus,
          // straddling the panel's edge, so Enter again closes the panel where focus already is.
          [DOCKED_MEDIA]: {
            '&[data-panel="open"]': { right: TODAY_PANEL_PX - 20 },
            '&[data-panel="open"]:not(:focus-visible)': { opacity: 0, pointerEvents: 'none' },
          },
          // Touch screens have no edge to hover: the button stays shown, beside the panel.
          [DOCKED_TOUCH_MEDIA]: {
            '&&[data-panel="open"]': { right: TODAY_PANEL_PX + 16, opacity: 1, pointerEvents: 'auto' },
          },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        })}
      >
        <EventNote />
      </Fab>

      <Drawer
        anchor="right"
        open={drawerOpen && !docked}
        onClose={() => setDrawerOpen(false)}
        slotProps={{
          paper: {
            id: DRAWER_ID,
            role: 'dialog',
            'aria-modal': true,
            'aria-labelledby': TITLE_ID,
            sx: { width: 360, maxWidth: '100%' },
          },
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, pl: 2, pr: 1, py: 1.5, minHeight: 64 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography id={TITLE_ID} variant="h2" sx={{ fontSize: '1.375rem', lineHeight: '28px' }}>
              Today&apos;s classes
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {chinaShortDate(now)}
            </Typography>
          </Box>
          <IconButton aria-label="Close" onClick={() => setDrawerOpen(false)}>
            <Close />
          </IconButton>
        </Stack>
        <Divider />
        <TodayClasses events={events} now={now} courses={courses} />
      </Drawer>

      <Box
        component="aside"
        id={PANEL_ID}
        aria-label="Today's classes"
        {...{ [TODAY_PANEL_ATTR]: '' }}
        data-open={panelOpen}
        inert={!panelOpen}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === 'transform' && !panelOpen) setPanelBody(false);
        }}
        sx={(theme) => {
          const { duration, easing } = theme.transitions;
          const slide = `transform ${duration.enteringScreen}ms ${easing.easeInOut}`;
          return {
            display: 'flex',
            // Narrow windows use the drawer; a stored open state never forces the panel there.
            [theme.breakpoints.down('md')]: { display: 'none' },
            flexDirection: 'column',
            position: 'fixed',
            // Below the app bar, beside the page header and the content.
            top: APP_BAR_PX,
            right: 0,
            bottom: 0,
            width: TODAY_PANEL_PX,
            zIndex: theme.zIndex.appBar - 1,
            bgcolor: 'background.paper',
            borderLeft: 1,
            borderColor: 'divider',
            // Closed: off to the right and out of the accessibility tree once it has slid away.
            transform: 'translateX(100%)',
            visibility: 'hidden',
            transition: `${slide}, visibility 0s linear ${duration.enteringScreen}ms`,
            '&[data-open="true"]': { transform: 'none', visibility: 'visible', transition: slide },
            '@media (prefers-reduced-motion: reduce)': { '&, &[data-open="true"]': { transition: 'none' } },
          };
        }}
      >
        {/* Continues the tab row of the page header: same height, surface and bottom edge. */}
        <Stack
          direction="row"
          sx={(theme) => ({
            alignItems: 'center',
            gap: 1,
            pl: 2,
            pr: 0.5,
            minHeight: 48,
            flexShrink: 0,
            bgcolor: theme.yungu.header.bg,
            borderBottom: theme.yungu.header.edge,
          })}
        >
          <Typography id={PANEL_TITLE_ID} variant="h2" sx={{ fontSize: '1rem', lineHeight: '24px', fontWeight: 500 }} noWrap>
            Today&apos;s classes
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
            {chinaShortDate(now)}
          </Typography>
          <IconButton aria-label="Close today's classes" onClick={() => setPanel(false)}>
            <Close />
          </IconButton>
        </Stack>
        <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {panelBody && <TodayClasses events={events} now={now} courses={courses} />}
        </Box>
      </Box>
    </>
  );
}
