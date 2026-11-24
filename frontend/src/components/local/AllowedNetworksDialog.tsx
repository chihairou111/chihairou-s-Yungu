'use client';
import { useId, useState, type FormEvent } from 'react';
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
import { popIn } from '../detail/motion';
import type { AllowedNetwork } from './local-api';

export type { AllowedNetwork };

const LABEL_MAX = 64;

interface AllowedNetworksDialogProps {
  open: boolean;
  allowedNetworks: AllowedNetwork[];
  /** The current network's router (MAC), when it could be read. */
  mac?: string;
  onChange: (list: AllowedNetwork[]) => void;
  onClose: () => void;
  /** After the dialog has gone (its exit transition ended): where focus goes next. */
  onExited?: () => void;
}

/**
 * The networks Suspension Mode allows. A network is recognised by its router, so one is added only
 * while connected to it, with "Add current network" and a label to know it by. Each change is saved at
 * once; Done only closes.
 */
export default function AllowedNetworksDialog({ open, allowedNetworks, mac, onChange, onClose, onExited }: AllowedNetworksDialogProps) {
  const titleId = useId();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [label, setLabel] = useState('');
  const typed = label.trim();
  const current = mac ? allowedNetworks.find((n) => n.mac === mac) : undefined;
  const canAdd = !!mac && !current && typed !== '';

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
        transition: { ...popIn(reduceMotion), onExited },
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
          <List dense disablePadding sx={(theme) => ({ border: `1px solid ${theme.yungu.color.outlineVariant}`, borderRadius: 2 })}>
            {allowedNetworks.map((n) => (
              <ListItem
                key={n.mac}
                secondaryAction={
                  <IconButton edge="end" aria-label={`Remove ${n.label}`} onClick={() => onChange(allowedNetworks.filter((x) => x.mac !== n.mac))}>
                    <CloseRounded fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemText primary={n.label} slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }} />
              </ListItem>
            ))}
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
        ) : (
          <Stack component="form" onSubmit={submit} sx={{ mt: 2, gap: 1 }}>
            <TextField
              label="Label"
              size="small"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={!mac}
              autoComplete="off"
              placeholder="School, Home…"
              helperText={mac ? 'A name to know the network you are on by.' : 'Connect to the Wi-Fi you want to allow, then add it here.'}
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
