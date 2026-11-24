'use client';
import { useId, useRef, useState, type FormEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { ARRIVE_IN, popIn } from '../detail/motion';
import type { AllowedNetwork } from './local-api';

export type { AllowedNetwork };

const LABEL_MAX = 64;

interface AllowedNetworksDialogProps {
  open: boolean;
  allowedNetworks: AllowedNetwork[];
  /** The current network's router (MAC), when it could be read. */
  mac?: string;
  /** Suspension Mode's switch is on: removing the network you're on would suspend the app at once. */
  suspension?: boolean;
  onChange: (list: AllowedNetwork[]) => void;
  onClose: () => void;
  /** After the dialog has gone (its exit transition ended): where focus goes next. */
  onExited?: () => void;
}

/**
 * The networks Suspension Mode allows. A network is recognised by its router, so one is added only
 * while connected to it, with "Add current network" and a label to know it by. Each change is saved at
 * once; Done only closes. The network you're on is marked, and with the switch on its × first asks, in
 * the row itself, since removing it suspends the app at once.
 */
export default function AllowedNetworksDialog({ open, allowedNetworks, mac, suspension, onChange, onClose, onExited }: AllowedNetworksDialogProps) {
  const titleId = useId();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [label, setLabel] = useState('');
  const typed = label.trim();
  const current = mac ? allowedNetworks.find((n) => n.mac === mac) : undefined;
  const canAdd = !!mac && !current && typed !== '';
  // The router of the row asking "remove it?", if any.
  const [confirming, setConfirming] = useState<string | undefined>(undefined);
  // The current row's ×, to give focus back to when the question is cancelled.
  const removeButton = useRef<HTMLButtonElement | null>(null);

  const remove = (target: string) => {
    setConfirming(undefined);
    onChange(allowedNetworks.filter((x) => x.mac !== target));
  };
  const cancel = () => {
    setConfirming(undefined);
    requestAnimationFrame(() => removeButton.current?.focus());
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    onChange([...allowedNetworks, { label: typed, mac: mac! }]);
    setLabel('');
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      // Focus is put back by `onExited` (the item that opened this has gone with the gear menu).
      disableRestoreFocus={!!onExited}
      slotProps={{
        transition: {
          ...popIn(reduceMotion),
          // A question left open is gone when the dialog comes back.
          onExited: () => {
            setConfirming(undefined);
            onExited?.();
          },
        },
        paper: {
          sx: (theme) => ({
            bgcolor: theme.yungu.dialog.bg,
            backgroundImage: 'none',
            m: 2,
            width: 'calc(100% - 32px)',
            maxWidth: 440,
            borderRadius: `${theme.yungu.shape.extraLarge}px`,
          }),
        },
      }}
    >
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Typography id={titleId} variant="h2" component="h2">
          Allowed networks
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, textWrap: 'pretty' }}>
          With Suspension Mode on, nothing is sent to Yungu on any other network. Each network is recognised by its router.
        </Typography>
      </Box>

      <Box sx={{ px: 3, pt: 2 }}>
        {allowedNetworks.length > 0 ? (
          <List dense disablePadding sx={(theme) => ({ border: `1px solid ${theme.yungu.color.outlineVariant}`, borderRadius: `${theme.yungu.shape.medium}px` })}>
            {allowedNetworks.map((n) => {
              const here = n.mac === mac;
              if (confirming === n.mac)
                return (
                  <ListItem key={n.mac} sx={{ ...ARRIVE_IN, flexWrap: 'wrap', columnGap: 1 }}>
                    <Typography variant="body2" sx={{ flex: '1 1 180px', py: 0.5, textWrap: 'pretty' }}>
                      You’re on this network — removing it suspends the app now.
                    </Typography>
                    <Stack direction="row" sx={{ gap: 0.5, ml: 'auto' }}>
                      <Button autoFocus onClick={cancel}>
                        Cancel
                      </Button>
                      <Button color="error" onClick={() => remove(n.mac)}>
                        Remove
                      </Button>
                    </Stack>
                  </ListItem>
                );
              return (
                <ListItem
                  key={n.mac}
                  secondaryAction={
                    <IconButton
                      ref={here ? removeButton : undefined}
                      edge="end"
                      aria-label={`Remove ${n.label}`}
                      onClick={() => (here && suspension ? setConfirming(n.mac) : remove(n.mac))}
                    >
                      <CloseRounded fontSize="small" />
                    </IconButton>
                  }
                >
                  <ListItemText
                    primary={n.label}
                    secondary={here ? 'This network' : undefined}
                    slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }}
                  />
                </ListItem>
              );
            })}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No networks allowed yet.
          </Typography>
        )}

        {current ? (
          <Typography variant="body2" sx={{ mt: 2, overflowWrap: 'anywhere' }}>
            This network is allowed as “{current.label}”.
          </Typography>
        ) : !mac ? (
          // No router reading: nothing to add, so no disabled form, only what to do.
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Connect to the Wi-Fi you want to allow, then add it here.
          </Typography>
        ) : (
          <Stack component="form" onSubmit={submit} sx={{ mt: 2, gap: 1 }}>
            <TextField
              label="Label"
              size="small"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoComplete="off"
              placeholder="School, Home…"
              helperText="A name to know the network you are on by."
              slotProps={{ htmlInput: { maxLength: LABEL_MAX, spellCheck: false } }}
            />
            <Box>
              <Button type="submit" variant="outlined" disabled={!canAdd}>
                Add current network
              </Button>
            </Box>
          </Stack>
        )}
      </Box>

      <Stack direction="row" sx={{ px: 3, pt: 2.5, pb: 2.5, justifyContent: 'flex-end' }}>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </Stack>
    </Dialog>
  );
}
