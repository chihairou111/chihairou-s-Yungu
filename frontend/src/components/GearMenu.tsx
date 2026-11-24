'use client';
import { createContext, useContext, useId, useState, type ReactNode, type Ref } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import AppearanceMenu from './AppearanceMenu';

const CloseContext = createContext<() => void>(() => undefined);

/** Closes the gear menu: for an item in `children` that opens something of its own (a dialog). */
export function useCloseGearMenu(): () => void {
  return useContext(CloseContext);
}

/**
 * The app bar's Settings gear, left of the account avatar. Its menu holds `Appearance` (a submenu of
 * Automatic, Light, Dark) and then `children`: the local app adds its Suspension items there.
 * `buttonRef` is the gear button, for focus to come back to after a dialog an item opened.
 */
export default function GearMenu({ children, buttonRef }: { children?: ReactNode; buttonRef?: Ref<HTMLButtonElement> }) {
  const id = useId();
  const buttonId = `${id}-button`;
  const menuId = `${id}-menu`;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);

  return (
    <CloseContext.Provider value={close}>
      <IconButton
        ref={buttonRef}
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
    </CloseContext.Provider>
  );
}
