'use client';
import { useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Portal from '@mui/material/Portal';
import Snackbar from '@mui/material/Snackbar';
import Tooltip from '@mui/material/Tooltip';
import useMediaQuery from '@mui/material/useMediaQuery';
import Refresh from '@mui/icons-material/Refresh';
import { useRefresh } from './RefreshContext';
import { VISUALLY_HIDDEN } from './visually-hidden';

/** One full turn of the icon while a refresh runs. */
const TURN_MS = 800;

/**
 * Refresh in the app bar, left of the gear: reloads the page (and the open assignment) from Yungu,
 * past every cache. The icon turns while it works and finishes its turn rather than snapping back;
 * with reduced motion it stays still and dims instead. It is marked disabled while running but keeps
 * focus (`aria-disabled`, not `disabled`), so a keyboard user is not dropped to the page.
 */
export default function RefreshButton() {
  const { refreshing, refresh, error, dismissError } = useRefresh();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  // Spinning outlasts the refresh by the rest of the current turn (ended on the next iteration).
  const [spinning, setSpinning] = useState(false);
  if (refreshing && !reduceMotion && !spinning) setSpinning(true);
  if (spinning && reduceMotion) setSpinning(false);

  // The snackbar keeps its message while it slides out; it mounts on a failure, so it lands after an
  // open pop-up in the page (in its own layer, above the backdrop) and is not hidden with the rest.
  const [shown, setShown] = useState(error);
  if (error && error !== shown) setShown(error);

  return (
    <>
      <Tooltip title="Refresh from Yungu" describeChild>
        <IconButton
          aria-label="Refresh"
          aria-disabled={refreshing || undefined}
          data-spinning={spinning || undefined}
          onClick={refresh}
          sx={(theme) => ({
            color: 'text.secondary',
            '&[aria-disabled="true"]': { cursor: 'progress' },
            // No turning: the icon dims (a short colour fade, no movement) while it works.
            '@media (prefers-reduced-motion: reduce)': {
              transition: theme.transitions.create(['background-color', 'color'], {
                duration: theme.transitions.duration.shortest,
                easing: 'ease',
              }),
              '&[aria-disabled="true"]': { color: theme.palette.action.disabled },
            },
            // Constant motion, so linear; it starts from the resting angle, so nothing jumps.
            '&[data-spinning] svg': {
              animation: `yl-refresh-turn ${TURN_MS}ms linear infinite`,
              '@keyframes yl-refresh-turn': { to: { rotate: '360deg' } },
            },
          })}
        >
          <Refresh
            onAnimationIteration={() => {
              if (!refreshing) setSpinning(false);
            }}
          />
        </IconButton>
      </Tooltip>
      <Box component="span" role="status" sx={VISUALLY_HIDDEN}>
        {refreshing ? 'Refreshing…' : ''}
      </Box>
      {shown && (
        <Portal>
          <Snackbar
            key={shown.key}
            open={error !== null}
            message={shown.message}
            autoHideDuration={6000}
            onClose={(_, reason) => reason !== 'clickaway' && dismissError()}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            slotProps={{
              transition: { ...(reduceMotion && { timeout: 0 }), onExited: () => setShown(null) },
              content: { role: 'alert' },
            }}
          />
        </Portal>
      )}
    </>
  );
}
