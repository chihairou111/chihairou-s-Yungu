'use client';
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { DEFAULT_STYLE, styleCookie, type UiStyle } from '@/lib/style';
import { getTheme } from '@/theme';

interface StyleContextValue {
  style: UiStyle;
  /** Re-themes the app at once and remembers the choice in the `yl_style` cookie. */
  setStyle: (style: UiStyle) => void;
}

const StyleContext = createContext<StyleContextValue>({ style: DEFAULT_STYLE, setStyle: () => {} });

export function useStyle(): StyleContextValue {
  return use(StyleContext);
}

interface StyleProviderProps {
  /** Read from the cookie on the server, so the first paint already has the right theme. */
  initialStyle: UiStyle;
  children: ReactNode;
}

/** Owns the visual style (classic or expressive) and provides the matching MUI theme. */
export default function StyleProvider({ initialStyle, children }: StyleProviderProps) {
  const [style, setStyleState] = useState(initialStyle);
  const setStyle = useCallback((next: UiStyle) => {
    document.cookie = styleCookie(next);
    setStyleState(next);
  }, []);
  const value = useMemo(() => ({ style, setStyle }), [style, setStyle]);

  return (
    <StyleContext value={value}>
      <ThemeProvider theme={getTheme(style)}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </StyleContext>
  );
}
