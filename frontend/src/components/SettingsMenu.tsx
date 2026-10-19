'use client';
import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import Check from '@mui/icons-material/Check';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import type { UiStyle } from '@/lib/style';
import { useStyle } from './StyleProvider';

const STYLES: { value: UiStyle; label: string }[] = [
  { value: 'classic', label: 'Classic (Material 2)' },
  { value: 'expressive', label: 'Rounded (Material 3)' },
];

/** Gear button in the app bar; its menu switches the visual style. */
export default function SettingsMenu() {
  const { style, setStyle } = useStyle();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);

  return (
    <>
      <IconButton
        id="settings-button"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-controls={anchor ? 'settings-menu' : undefined}
        aria-expanded={anchor ? 'true' : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ mr: 1, color: 'text.secondary' }}
      >
        <SettingsOutlined />
      </IconButton>
      {/* A Popover rather than Menu so the "Style" label sits outside role="menu" and names it. */}
      <Popover
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, minWidth: 240 } } }}
      >
        <Typography id="settings-style-label" variant="body2" color="text.secondary" sx={{ px: 2, pt: 1.5, pb: 0.5, fontWeight: 500 }}>
          Style
        </Typography>
        <MenuList
          id="settings-menu"
          aria-labelledby="settings-style-label"
          autoFocusItem
          sx={{ pt: 0 }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') close();
          }}
        >
          {STYLES.map(({ value, label }) => {
            const checked = value === style;
            return (
              <MenuItem
                key={value}
                role="menuitemradio"
                aria-checked={checked}
                selected={checked}
                onClick={() => {
                  setStyle(value);
                  close();
                }}
              >
                <ListItemIcon>{checked && <Check fontSize="small" />}</ListItemIcon>
                <ListItemText>{label}</ListItemText>
              </MenuItem>
            );
          })}
        </MenuList>
      </Popover>
    </>
  );
}
