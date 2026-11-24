'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider, useColorScheme } from '@mui/material/styles';
import theme from '@/theme';
import { APPEARANCE_ATTRIBUTE } from '@/theme/expressive';
import { type Appearance, modeForAppearance } from '@/lib/appearance';
import { ServerAppearanceContext } from '@/lib/useAppearance';

/**
 * Keeps <html data-appearance> on the scheme in effect. The root layout renders the attribute from the
 * cookie (light/dark) or leaves it out (Automatic, set by the init script), so a server render after a
 * choice (a refresh) can make React change or drop it under MUI, which sets it only when the scheme
 * changes. This puts it back in the same commit, before paint, and follows a new cookie value.
 */
function AppearanceSync({ appearance }: { appearance: Appearance }) {
  const { colorScheme, setMode } = useColorScheme();
  const rendered = useRef(appearance);
  const applied = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (rendered.current !== appearance) {
      rendered.current = appearance;
      setMode(modeForAppearance(appearance));
    }
    if (!colorScheme) return;
    // A switch (not the first scheme after hydration) is instant: no component's colour transition
    // runs for it. Lifted after the next frame, once the new colours have been painted.
    if (applied.current && applied.current !== colorScheme) suspendTransitions();
    applied.current = colorScheme;
    document.documentElement.setAttribute(APPEARANCE_ATTRIBUTE, colorScheme);
  }, [appearance, colorScheme, setMode]);
  return null;
}

function suspendTransitions() {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(style);
  requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
}

/**
 * Provides the app's one MUI theme (Rounded, Material 3, light and dark schemes) and its CSS baseline,
 * starting from the appearance the server read from the `yl_appearance` cookie (Automatic follows
 * `prefers-color-scheme` live). MUI keeps nothing in localStorage: the cookie is the one record.
 * A scheme switch is instant: transitions are suspended for the change, so nothing cross-fades.
 */
export default function ThemeRegistry({ appearance = 'light', children }: { appearance?: Appearance; children: ReactNode }) {
  return (
    <ServerAppearanceContext.Provider value={appearance}>
      <ThemeProvider theme={theme} defaultMode={modeForAppearance(appearance)} storageManager={null}>
        <CssBaseline />
        <AppearanceSync appearance={appearance} />
        {children}
      </ThemeProvider>
    </ServerAppearanceContext.Provider>
  );
}
