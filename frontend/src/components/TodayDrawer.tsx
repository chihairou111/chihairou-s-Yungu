'use client';
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Fab from '@mui/material/Fab';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Close from '@mui/icons-material/Close';
import ChevronRight from '@mui/icons-material/ChevronRight';
import EventNote from '@mui/icons-material/EventNote';
import { classesForPanel } from '@/lib/schedule';
import { chinaShortDate } from '@/lib/time';
import { todayPanelCookie } from '@/lib/today-panel';
import type { ClassEvent, Course } from '@/lib/types';
import { DOCK_MIN_PX, PAGE_HEADER_PX, TODAY_PANEL_ATTR, TODAY_PANEL_PX } from './PageHeader';
import TodayClasses from './TodayClasses';
import { useNow } from './useNow';

const DRAWER_ID = 'today-drawer';
const TITLE_ID = 'today-drawer-title';
const PANEL_ID = 'today-panel';
const PANEL_TITLE_ID = 'today-panel-title';
/** From this width the classes dock as a panel beside the content; below it they open in a drawer. */
export const DOCK_QUERY = `(min-width: ${DOCK_MIN_PX}px)`;
const UNDOCKED_MEDIA = `@media (max-width: ${DOCK_MIN_PX - 0.05}px)`;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** Today's classes is already the calendar's today column, so the calendar shows neither panel nor button. */
const PANEL_HIDDEN_ON = '/calendar';
/** Whether the page at `pathname` shows Today's classes (the panel and its button). */
export function showsTodayPanel(pathname: string): boolean {
  return pathname !== PANEL_HIDDEN_ON;
}
const DOCKED_MEDIA = `@media ${DOCK_QUERY}`;
/** Docked, but on a touch screen: no hover, so the button stays shown at the bottom right. */
const DOCKED_TOUCH_MEDIA = `@media (hover: none) and ${DOCK_QUERY}`;
/** Distance from the right edge within which the pointer reveals the button. */
export const EDGE_ZONE_PX = 56;
/** Below the app bar, so the edge never competes with the account button. */
const APP_BAR_PX = 64;
/** The docked panel starts where the page content does: under the app bar and the page header band. */
export const PANEL_TOP_PX = APP_BAR_PX + PAGE_HEADER_PX;
/** While the panel is open the button reveals over it and this far left of its edge. */
export const OPEN_REACH_PX = TODAY_PANEL_PX + EDGE_ZONE_PX / 2;
/** Open, the button straddles the panel's left edge: 24px over the page's right margin, 16px over the panel's padding. */
const OPEN_BUTTON_RIGHT_PX = TODAY_PANEL_PX - 16;
/** Where the button parks at the bottom right instead: touch screens and narrow windows. */
export const BOTTOM_FAB_MEDIA = `@media (hover: none), (max-width: ${DOCK_MIN_PX - 0.05}px)`;
const EASE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
// Emphasized accelerate, for the panel leaving: it must clear the gutter by the time the content reclaims it.
const EASE_OUT = 'cubic-bezier(0.3, 0, 0.8, 0.15)';

function subscribeDock(onChange: () => void) {
  const query = window.matchMedia?.(DOCK_QUERY);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

/** True from the dock width. The server assumes a wide window, so a stored open panel renders open at once. */
function useDocked(): boolean {
  return useSyncExternalStore(
    subscribeDock,
    () => window.matchMedia?.(DOCK_QUERY).matches ?? false,
    () => true,
  );
}

/**
 * True when a pointer at (x, y) is within `reach` px of the right edge and below `top`: the edge
 * zone under the app bar while the panel is closed; the open panel and a strip left of its edge.
 */
export function shouldRevealEdgeButton(x: number, y: number, viewportWidth: number, top: number, reach = EDGE_ZONE_PX): boolean {
  return x >= viewportWidth - reach && y >= top;
}

/**
 * Watches the pointer passively (a window listener, throttled to one check per frame), so no
 * element covers the page. True while the pointer is near the right edge of the layout viewport
 * (`clientWidth` excludes a classic scrollbar, unlike `innerWidth`) or over the button itself.
 */
function useEdgeReveal(buttonRef: RefObject<HTMLElement | null>, panelOpen: boolean, enabled: boolean): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const [top, reach] = panelOpen ? [PANEL_TOP_PX, OPEN_REACH_PX] : [APP_BAR_PX, EDGE_ZONE_PX];
    let frame = 0;
    let last: PointerEvent | null = null;
    const check = () => {
      frame = 0;
      if (!last) return;
      const overButton = last.target instanceof Node && !!buttonRef.current?.contains(last.target);
      const width = document.documentElement.clientWidth;
      setNear(overButton || shouldRevealEdgeButton(last.clientX, last.clientY, width, top, reach));
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
  }, [buttonRef, panelOpen, enabled]);
  return enabled && near;
}

interface TodayDrawerProps {
  /** Today's classes and the next school day's (`loadPanelClasses`); `classesForPanel` picks the day to show. */
  events: ClassEvent[];
  /** Server time; the list then follows the device clock (Now / Next, the date). */
  now: number;
  /** For each class's course-color dot. */
  courses: Course[];
  /** The docked panel's stored state (the `yl_today_panel` cookie, read on the server). */
  initialPanelOpen?: boolean;
}

/**
 * Today's classes, part of the dashboard shell (every page but the calendar, whose today column
 * already shows them; the stored state is kept for the other pages). Once today's last class has
 * ended they show the next school day's, headed by its date, and the title says "Done for today" in
 * place of today's date. From `DOCK_MIN_PX` they dock as a panel on the right, below the page header
 * band: the content narrows to make room in one step (only the panel slides), and the panel stays
 * open (remembered in a cookie) until it is closed. Narrower windows open them in a temporary drawer
 * instead.
 * One round button toggles either. On wide pointer screens it sits mid-right and appears when the
 * pointer nears the right edge (closed) or is over the panel (open, then straddling the panel's left
 * edge as a collapse chevron), and whenever it has focus. On touch screens and narrow windows it is
 * always shown bottom-right. The panel has no title row: the cards start at its top.
 */
export default function TodayDrawer({ events, now: serverNow, courses, initialPanelOpen = false }: TodayDrawerProps) {
  const now = useNow(serverNow);
  const docked = useDocked();
  const hidden = !showsTodayPanel(usePathname());
  const [panelOpen, setPanelOpen] = useState(initialPanelOpen);
  // Open or still sliding out: the list stays mounted and the content keeps the panel's space until
  // the slide ends; on open both return at once (and the list scrolls to Now).
  const [panelBody, setPanelBody] = useState(initialPanelOpen);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const near = useEdgeReveal(buttonRef, docked && panelOpen, !hidden);
  // Any focus keeps it shown, including the focus MUI restores after a mouse close of the drawer.
  const [focused, setFocused] = useState(false);
  const expanded = docked ? panelOpen : drawerOpen;

  const shown = classesForPanel(events, now);
  const showsNextDay = shown.label === 'next';
  const list = (
    <TodayClasses
      events={shown.items}
      now={now}
      courses={courses}
      nextDay={showsNextDay ? shown.dayLabel : undefined}
    />
  );
  // Under the title: today's date, or once the list shows another day (which it dates itself), that today is over.
  const subtitle = (
    <Typography variant="body2" color="text.secondary">
      {showsNextDay ? (shown.todayHadClasses ? 'Done for today' : 'No classes today') : chinaShortDate(now)}
    </Typography>
  );

  function setPanel(open: boolean) {
    document.cookie = todayPanelCookie(open);
    // No slide under reduced motion, so no transitionend to wait for.
    if (open || window.matchMedia?.(REDUCED_MOTION_QUERY).matches) setPanelBody(open);
    setPanelOpen(open);
  }

  // Unmounted (on the calendar) or not shown (an undocked window), the panel cannot finish a slide,
  // so a pending slide-out ends here rather than leaving the content narrowed for a closed panel.
  if ((hidden || !docked) && panelBody !== panelOpen) setPanelBody(panelOpen);

  if (hidden) return null;

  return (
    <>
      <Fab
        size="small"
        color="primary"
        aria-label="Today's classes"
        aria-expanded={expanded}
        aria-controls={docked ? PANEL_ID : drawerOpen ? DRAWER_ID : undefined}
        ref={buttonRef}
        data-revealed={near}
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
          // While the panel is open the button straddles its left edge, centred on the panel's height,
          // and closes it (revealed by hovering the panel, or by focus).
          [DOCKED_MEDIA]: {
            '&[data-panel="open"]': { right: OPEN_BUTTON_RIGHT_PX, top: `calc(50% + ${PANEL_TOP_PX / 2}px)` },
          },
          // Touch screens have no edge to hover: the button stays shown, beside the panel.
          [DOCKED_TOUCH_MEDIA]: {
            '&&[data-panel="open"]': { top: 'auto', right: TODAY_PANEL_PX + 16, opacity: 1, pointerEvents: 'auto' },
          },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        })}
      >
        {docked && panelOpen ? <ChevronRight /> : <EventNote />}
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
            // The page's surface, so the class cards stand out as they do on the page (and in the panel).
            sx: { width: 360, maxWidth: '100%', bgcolor: 'background.default' },
          },
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, pl: 2, pr: 1, py: 1.5, minHeight: 64 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography id={TITLE_ID} variant="h2" sx={{ fontSize: '1.375rem', lineHeight: '28px' }}>
              Today&apos;s classes
            </Typography>
            {subtitle}
          </Box>
          <IconButton aria-label="Close" onClick={() => setDrawerOpen(false)}>
            <Close />
          </IconButton>
        </Stack>
        <Divider />
        <Box sx={{ p: 2, overflowY: 'auto' }}>
          {list}
        </Box>
      </Drawer>

      <Box
        component="aside"
        id={PANEL_ID}
        aria-labelledby={PANEL_TITLE_ID}
        {...{ [TODAY_PANEL_ATTR]: '' }}
        data-open={panelOpen}
        data-takes-space={panelOpen || panelBody}
        inert={!panelOpen}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === 'transform' && !panelOpen) setPanelBody(false);
        }}
        sx={(theme) => {
          const { duration } = theme.transitions;
          // Entering decelerates (answers the click at once); leaving accelerates and is a touch quicker.
          const slideIn = `transform ${duration.enteringScreen}ms ${EASE}`;
          const slideOut = `transform ${duration.leavingScreen}ms ${EASE_OUT}`;
          return {
            display: 'flex',
            // Narrow windows use the drawer; a stored open state never forces the panel there.
            [UNDOCKED_MEDIA]: { display: 'none' },
            flexDirection: 'column',
            position: 'fixed',
            // Below the app bar and the page header band, beside the content.
            top: PANEL_TOP_PX,
            right: 0,
            bottom: 0,
            width: TODAY_PANEL_PX,
            zIndex: theme.zIndex.appBar - 1,
            // The page's own surface, so the class cards read like the page's cards.
            bgcolor: 'background.default',
            borderLeft: 1,
            borderColor: 'divider',
            // Closed: off to the right and out of the accessibility tree once it has slid away.
            transform: 'translateX(100%)',
            visibility: 'hidden',
            transition: `${slideOut}, visibility 0s linear ${duration.leavingScreen}ms`,
            '&[data-open="true"]': { transform: 'none', visibility: 'visible', transition: slideIn },
            '@media (prefers-reduced-motion: reduce)': { '&, &[data-open="true"]': { transition: 'none' } },
          };
        }}
      >
        {/* The title scrolls with the cards: no separate title bar; it sits level with the page's column headings. */}
        <Box
          data-today-panel-body=""
          sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', px: 2, pt: 3, pb: 2 }}
        >
          <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, mb: 1.5, minHeight: 28 }}>
            <Typography id={PANEL_TITLE_ID} variant="h3" component="h2">
              Today&apos;s classes
            </Typography>
            {subtitle}
          </Stack>
          {panelBody && list}
        </Box>
      </Box>
    </>
  );
}
