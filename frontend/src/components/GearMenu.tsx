'use client';
import { useId, useState, type ReactNode } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import AppearanceMenu from './AppearanceMenu';

/**
 * The app bar's Settings gear, left of the account avatar. Its menu holds `Appearance` (a submenu of
 * Automatic, Light, Dark) and then `children`: the local app adds its Suspension items there.
 */
export default function GearMenu({ children }: { children?: ReactNode }) {
  const id = useId();
  const buttonId = `${id}-button`;
  const menuId = `${id}-menu`;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);

  return (
    <>
      <IconButton
        id={buttonId}
        aria-label="Settings"
        aria-haspopup="menu"
        aria-controls={anchor ? menuId : undefined}
        aria-expanded={anchor ? 'true' : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <SettingsOutlined />
      </IconButton>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          list: { 'aria-labelledby': buttonId },
          // The Appearance submenu is drawn inside this paper, beside or below it: it must not clip.
          paper: { sx: { mt: 1, minWidth: 200, overflow: 'visible' } },
        }}
      >
        <AppearanceMenu onClose={close} />
        {children}
      </Menu>
    </>
  );
}
