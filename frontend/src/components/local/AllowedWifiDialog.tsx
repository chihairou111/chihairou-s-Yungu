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

interface AllowedWifiDialogProps {
  open: boolean;
  allowedWifi: string[];
  /** The current Wi-Fi's name, when known: offered as "Add current Wi-Fi" while not listed. */
  ssid?: string;
  onChange: (names: string[]) => void;
  onClose: () => void;
}

/**
 * The list of Wi-Fi names Suspension Mode allows: typed in (names compare exactly, so case counts), or
 * the current one added with one click. Each change is saved at once; Done only closes.
 */
export default function AllowedWifiDialog({ open, allowedWifi, ssid, onChange, onClose }: AllowedWifiDialogProps) {
  const titleId = useId();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [name, setName] = useState('');
  const typed = name.trim();
  const canAdd = typed !== '' && !allowedWifi.includes(typed);
  const current = ssid?.trim();
  const offerCurrent = !!current && !allowedWifi.includes(current);

  const add = (n: string) => onChange([...allowedWifi, n]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    add(typed);
    setName('');
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      slotProps={{
        transition: popIn(reduceMotion),
        paper: {
          sx: (theme) => ({
            bgcolor: theme.yungu.color.surfaceContainerLowest,
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
          Allowed Wi-Fi
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          With Suspension Mode on, nothing is sent to Yungu on any other Wi-Fi.
        </Typography>
      </Box>

      <Box sx={{ px: 3, pt: 2 }}>
        {allowedWifi.length > 0 ? (
          <List dense disablePadding sx={(theme) => ({ border: `1px solid ${theme.yungu.color.outlineVariant}`, borderRadius: 2 })}>
            {allowedWifi.map((n) => (
              <ListItem
                key={n}
                secondaryAction={
                  <IconButton edge="end" aria-label={`Remove ${n}`} onClick={() => onChange(allowedWifi.filter((x) => x !== n))}>
                    <CloseRounded fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemText primary={n} slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }} />
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No Wi-Fi allowed yet.
          </Typography>
        )}

        <Stack component="form" direction="row" onSubmit={submit} sx={{ mt: 2, gap: 1, alignItems: 'flex-start' }}>
          <TextField
            label="Wi-Fi name"
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            slotProps={{ htmlInput: { maxLength: 64, spellCheck: false } }}
            sx={{ flex: 1 }}
          />
          <Button type="submit" variant="outlined" disabled={!canAdd} sx={{ height: 40 }}>
            Add
          </Button>
        </Stack>
      </Box>

      <Stack direction="row" sx={{ px: 3, pt: 2.5, pb: 2.5, gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {offerCurrent && <Button onClick={() => add(current!)}>Add current Wi-Fi</Button>}
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </Stack>
    </Dialog>
  );
}
