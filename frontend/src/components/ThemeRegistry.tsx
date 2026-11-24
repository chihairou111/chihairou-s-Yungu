'use client';
import type { ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import theme from '@/theme';

/**
 * Provides the app's one MUI theme (Rounded, Material 3, light and dark schemes) and its CSS baseline.
 * The provider sets `data-appearance` on <html>; it starts in light and keeps nothing in localStorage
 * (MUI's default), since the appearance choice lives in the `yl_appearance` cookie.
 */
export default function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme} defaultMode="light" storageManager={null}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
