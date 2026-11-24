'use client';
import { useCallback, useEffect, useId, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Fade from '@mui/material/Fade';
import Modal from '@mui/material/Modal';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import WifiOffRounded from '@mui/icons-material/WifiOffRounded';
import { localApi, useLocalState } from './local-api';

interface SuspensionScreenProps {
  reason?: string;
  ssid?: string;
  onTurnOff: () => void;
}

/** The one line under the title: why nothing is being sent. */
export function suspensionLine(reason: string | undefined, ssid: string | undefined): string {
  return reason === 'not-allowed' && ssid ? `Not sending anything to Yungu on "${ssid}".` : "Can't tell which Wi-Fi this is.";
}

/**
 * Suspension Mode's full-window screen: the page blurred behind a scrim, a title, why, and one button
 * that turns Suspension Mode off. It takes focus, keeps Tab inside, blocks clicks to the page and is not
 * dismissed by Escape or a click outside: only the button (or an allowed Wi-Fi) ends it.
 */
export default function SuspensionScreen({ reason, ssid, onTurnOff }: SuspensionScreenProps) {
  const titleId = useId();
  const lineId = useId();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // The Modal's portal mounts its content after this component's effects, so focus goes in as the
  // button itself arrives.
  const button = useCallback((el: HTMLButtonElement | null) => el?.focus(), []);

  return (
    <Modal
      open
      disableAutoFocus // the button takes focus itself
      closeAfterTransition={false}
      // Neither Escape nor a click outside closes it.
      onClose={() => undefined}
      slotProps={{
        backdrop: {
          transitionDuration: reduceMotion ? 0 : 200,
          sx: (theme) => ({
            // The surface is a CSS variable (it follows the colour scheme): mixed, not alpha()'d.
            backgroundColor: `color-mix(in srgb, ${theme.yungu.color.surface} 55%, transparent)`,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }),
        },
      }}
    >
      <Fade in appear={!reduceMotion} timeout={reduceMotion ? 0 : 200}>
        <Box
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={lineId}
          sx={{
            position: 'fixed',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            px: 2,
            outline: 'none',
          }}
        >
          <Box
            sx={(theme) => ({
              textAlign: 'center',
              maxWidth: 420,
              px: { xs: 3, sm: 5 },
              py: { xs: 4, sm: 5 },
              borderRadius: `${theme.yungu.shape.extraLarge}px`,
              bgcolor: theme.yungu.dialog.bg,
              boxShadow: theme.shadows[6],
            })}
          >
            <Box
              aria-hidden
              sx={(theme) => ({
                mx: 'auto',
                mb: 2,
                width: 56,
                height: 56,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '50%',
                bgcolor: theme.yungu.color.secondaryContainer,
                color: theme.yungu.color.onSecondaryContainer,
              })}
            >
              <WifiOffRounded />
            </Box>
            <Typography id={titleId} variant="h2" component="h2">
              Suspension Mode
            </Typography>
            <Typography id={lineId} color="text.secondary" sx={{ mt: 1, mb: 3, textWrap: 'pretty', overflowWrap: 'anywhere' }}>
              {suspensionLine(reason, ssid)}
            </Typography>
            <Button ref={button} variant="contained" size="large" onClick={onTurnOff}>
              Turn off Suspension Mode
            </Button>
          </Box>
        </Box>
      </Fade>
    </Modal>
  );
}

/**
 * The screen wherever the desktop shell says requests are suspended; nothing on the web. When it goes
 * away (an allowed Wi-Fi, no Wi-Fi, or the switch turned off) the page reloads its data.
 */
export function LocalSuspension() {
  const state = useLocalState();
  const router = useRouter();
  const suspended = state?.suspended === true;
  const was = useRef(false);
  useEffect(() => {
    if (was.current && !suspended) router.refresh();
    was.current = suspended;
  }, [suspended, router]);
  if (!state || !suspended) return null;
  return (
    <SuspensionScreen
      reason={state.reason}
      ssid={state.ssid}
      onTurnOff={() => void localApi()?.setSuspension(false).catch(() => undefined)}
    />
  );
}
