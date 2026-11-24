'use client';
import { createContext, useCallback, useContext } from 'react';
import { useColorScheme } from '@mui/material/styles';
import { type Appearance, appearanceCookie, appearanceForMode, modeForAppearance } from './appearance';

/** The choice the server rendered with (from the cookie), for the render before MUI knows its mode. */
export const ServerAppearanceContext = createContext<Appearance>('auto');

/** The local (Electron) app's bridge, when the page runs inside it; it follows the choice natively. */
interface LocalBridge {
  setAppearance?: (appearance: Appearance) => void;
}

/**
 * The current appearance and a setter that applies a choice at once (MUI switches the scheme on
 * <html>), remembers it in the cookie, and tells the local app's window, if there is one.
 */
export function useAppearance(): { appearance: Appearance; setAppearance: (appearance: Appearance) => void } {
  const { mode, setMode } = useColorScheme();
  const serverAppearance = useContext(ServerAppearanceContext);
  const setAppearance = useCallback(
    (appearance: Appearance) => {
      document.cookie = appearanceCookie(appearance);
      setMode(modeForAppearance(appearance));
      (window as unknown as { yunguLocal?: LocalBridge }).yunguLocal?.setAppearance?.(appearance);
    },
    [setMode],
  );
  return { appearance: mode ? appearanceForMode(mode) : serverAppearance, setAppearance };
}
