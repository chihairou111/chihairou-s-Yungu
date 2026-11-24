'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Theme } from '@mui/material/styles';
import Close from '@mui/icons-material/Close';
import { MEDIA_UNAVAILABLE, type MediaAccess } from './media';
import { popIn } from './motion';

interface MediaDialogProps {
  open: boolean;
  title: string;
  /** Accessible name of the ✕ ("Close camera"). */
  closeLabel: string;
  /** Shown instead of the body when the device cannot be used. */
  unavailableIcon: ReactNode;
  access: MediaAccess;
  /** "Discard 2 photos?" while there is unsaved work; closing then asks first. */
  discardPrompt: string | null;
  onClose: () => void;
  /** After the closing animation: the place to reset for the next opening. */
  onExited: () => void;
  children: ReactNode;
  /** The bottom row (Cancel and the add button). */
  actions: ReactNode;
}

/**
 * The small dialog the camera and the recorder open in, on top of the assignment pop-up (full-screen on
 * phones): a title row with ✕, the body, and a bottom row of actions. With unsaved work, closing by any
 * route (✕, Esc, Cancel, the backdrop) first asks in that bottom row. When the browser gives no device,
 * the body is replaced by the reason and a Close button.
 */
export default function MediaDialog(props: MediaDialogProps) {
  const { open, title, closeLabel, unavailableIcon, access, discardPrompt, onClose, onExited, children, actions } = props;
  const titleId = useId();
  const fullScreen = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'));
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [confirming, setConfirming] = useState(false);
  if (confirming && discardPrompt === null) setConfirming(false);

  const closeButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  // Where Keep puts focus back: the button that asked to close (the ✕ for Esc and the backdrop).
  const askedBy = useRef<'close' | 'cancel'>('close');
  const requestClose = (from: 'close' | 'cancel' = 'close') => {
    if (!discardPrompt) return onClose();
    askedBy.current = from;
    setConfirming(true);
  };
  const refocus = useRef(false);
  const keep = () => {
    refocus.current = true;
    setConfirming(false);
  };
  useEffect(() => {
    if (confirming || !refocus.current) return;
    refocus.current = false;
    (askedBy.current === 'cancel' ? cancelButton : closeButton).current?.focus();
  }, [confirming]);
  const blocked = access.status === 'unavailable' || access.status === 'failed';

  return (
    <Dialog
      open={open}
      fullScreen={fullScreen}
      aria-labelledby={titleId}
      onClose={(_, reason) => (confirming && reason === 'escapeKeyDown' ? keep() : requestClose())}
      slotProps={{
        transition: {
          ...popIn(reduceMotion),
          onExited: () => {
            setConfirming(false);
            onExited();
          },
        },
        paper: {
          sx: (theme) => ({
            bgcolor: theme.yungu.dialog.bg,
            backgroundImage: 'none',
            ...(!fullScreen && {
              m: 2,
              width: 'calc(100% - 32px)',
              maxWidth: 560,
              maxHeight: 'calc(100% - 32px)',
              borderRadius: `${theme.yungu.shape.extraLarge}px`,
            }),
          }),
        },
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, pl: { xs: 2, sm: 3 }, pr: { xs: 1, sm: 1.5 }, pt: 1.5, pb: 1 }}>
        <Typography id={titleId} variant="h2" component="h2" sx={{ flex: 1, minWidth: 0 }}>
          {title}
        </Typography>
        <IconButton ref={closeButton} aria-label={closeLabel} onClick={() => requestClose('close')}>
          <Close />
        </IconButton>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', px: { xs: 2, sm: 3 } }}>
        {blocked ? (
          <Unavailable icon={unavailableIcon} message={access.status === 'failed' ? access.message : MEDIA_UNAVAILABLE} />
        ) : (
          children
        )}
      </Box>

      <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2, pb: { xs: 'max(16px, env(safe-area-inset-bottom))', sm: 2.5 } }}>
        {confirming && discardPrompt ? (
          <DiscardRow prompt={discardPrompt} onKeep={keep} onDiscard={onClose} />
        ) : blocked ? (
          <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
            <Button variant="contained" onClick={onClose}>
              Close
            </Button>
          </Stack>
        ) : (
          <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 1 }}>
            <Button ref={cancelButton} onClick={() => requestClose('cancel')}>
              Cancel
            </Button>
            {actions}
          </Stack>
        )}
      </Box>
    </Dialog>
  );
}

function Unavailable({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <Stack sx={{ alignItems: 'center', textAlign: 'center', py: { xs: 6, sm: 4 }, my: 'auto' }}>
      <Box aria-hidden sx={{ color: 'text.secondary', mb: 1.5, '& svg': { fontSize: 40 } }}>
        {icon}
      </Box>
      <Typography variant="body1" sx={{ maxWidth: 340, textWrap: 'pretty' }}>
        {message}
      </Typography>
    </Stack>
  );
}

/** "Discard 2 photos?" with Keep (focused, the safe choice) and Discard. */
function DiscardRow({ prompt, onKeep, onDiscard }: { prompt: string; onKeep: () => void; onDiscard: () => void }) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  return (
    <Stack direction="row" role="group" aria-label={prompt} sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <Typography variant="body2" sx={{ flex: 1, minWidth: 'max-content', fontWeight: 500 }}>
        {prompt}
      </Typography>
      <Button ref={keep} onClick={onKeep}>
        Keep
      </Button>
      <Button variant="contained" color="error" onClick={onDiscard}>
        Discard
      </Button>
    </Stack>
  );
}
