'use client';
import { useState } from 'react';
import Box from '@mui/material/Box';
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
/** Width of the right-edge strip whose hover reveals the button. */
const HOT_ZONE_PX = 56;
/** Keeps the hot zone below the app bar so it never covers the account button. */
const APP_BAR_PX = 64;

interface TodayDrawerProps {
  /** Today's classes, already selected and ordered by `todaysClasses`. */
  events: ClassEvent[];
}

/**
 * A round button on the right edge (revealed by hovering the edge, by keyboard focus, or always on
 * touch screens) that opens a temporary right drawer listing today's classes.
 */
export default function TodayDrawer({ events }: TodayDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Box
        className={open ? 'is-open' : undefined}
        sx={(theme) => ({
          position: 'fixed',
          zIndex: theme.zIndex.speedDial,
          top: APP_BAR_PX,
          bottom: 0,
          right: 0,
          width: HOT_ZONE_PX,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Hidden until the pointer reaches the edge; focus or an open drawer also shows it.
          '& .today-fab': {
            opacity: 0,
            pointerEvents: 'none',
            transition: 'opacity 160ms cubic-bezier(0.05, 0.7, 0.1, 1)',
          },
          '&:hover .today-fab, & .today-fab.Mui-focusVisible, &.is-open .today-fab': {
            opacity: 1,
            pointerEvents: 'auto',
          },
          // No hover on touch screens: keep the button visible and let the strip pass touches through.
          '@media (hover: none)': {
            pointerEvents: 'none',
            '& .today-fab': { opacity: 1, pointerEvents: 'auto' },
          },
          '@media (prefers-reduced-motion: reduce)': { '& .today-fab': { transition: 'none' } },
        })}
      >
        <Fab
          className="today-fab"
          size="small"
          color="primary"
          aria-label="Today's classes"
          aria-expanded={open}
          aria-controls={open ? DRAWER_ID : undefined}
          onClick={() => setOpen(true)}
        >
          <EventNote />
        </Fab>
      </Box>

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
            sx: { width: 320, maxWidth: '100%', borderRadius: 0 },
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
