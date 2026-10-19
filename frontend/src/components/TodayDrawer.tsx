'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import Fab from '@mui/material/Fab';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Close from '@mui/icons-material/Close';
import EventNote from '@mui/icons-material/EventNote';
import type { ClassEvent } from '@/lib/types';
import TodayClasses from './TodayClasses';

const DRAWER_ID = 'today-drawer';
const TITLE_ID = 'today-drawer-title';
/** Distance from the right edge within which the pointer reveals the button. */
export const EDGE_ZONE_PX = 56;
/** Below the app bar, so the edge never competes with the account button. */
const APP_BAR_PX = 64;
/** Where the button parks at the bottom right instead: touch screens and narrow windows. */
export const BOTTOM_FAB_MEDIA = '@media (hover: none), (max-width: 899.95px)';
const EASE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';

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
}

/**
 * A round button that opens a temporary right drawer listing today's classes. On wide pointer
 * screens it sits mid-right and appears when the pointer nears the right edge, while it has focus,
 * or while the drawer is open; on touch screens and narrow windows it is always shown bottom-right.
 */
export default function TodayDrawer({ events }: TodayDrawerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const near = useEdgeReveal(buttonRef);
  // Any focus keeps it shown, including the focus MUI restores after a mouse close of the drawer.
  const [focused, setFocused] = useState(false);

  return (
    <>
      <Fab
        size="small"
        color="primary"
        aria-label="Today's classes"
        aria-expanded={open}
        aria-controls={open ? DRAWER_ID : undefined}
        ref={buttonRef}
        data-revealed={near}
        data-focused={focused}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => setOpen(true)}
        sx={(theme) => ({
          position: 'fixed',
          zIndex: theme.zIndex.speedDial,
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          opacity: 0,
          pointerEvents: 'none',
          transition: `opacity 160ms ${EASE}`,
          '&[data-revealed="true"], &[data-focused="true"], &[aria-expanded="true"]': { opacity: 1, pointerEvents: 'auto' },
          // Material's standard FAB spot, always visible, clear of the safe area.
          [BOTTOM_FAB_MEDIA]: {
            top: 'auto',
            transform: 'none',
            right: 16,
            bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
            opacity: 1,
            pointerEvents: 'auto',
          },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        })}
      >
        <EventNote />
      </Fab>

      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        slotProps={{
          paper: {
            id: DRAWER_ID,
            role: 'dialog',
            'aria-modal': true,
            'aria-labelledby': TITLE_ID,
            sx: { width: 320, maxWidth: '100%' },
          },
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, pl: 2, pr: 1, minHeight: 64 }}>
          <Typography id={TITLE_ID} variant="h2" sx={{ flexGrow: 1 }}>
            Today&apos;s classes
          </Typography>
          <IconButton aria-label="Close" onClick={() => setOpen(false)}>
            <Close />
          </IconButton>
        </Stack>
        <Divider />
        <TodayClasses events={events} />
      </Drawer>
    </>
  );
}
