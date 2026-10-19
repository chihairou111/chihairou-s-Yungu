'use client';
import type { Theme } from '@mui/material/styles';
import type { UiStyle } from '@/lib/style';
import classic from './classic';
import expressive from './expressive';
import './tokens';

const THEMES: Record<UiStyle, Theme> = { classic, expressive };

/** The MUI theme for a style; both are built once and reused. */
export function getTheme(style: UiStyle): Theme {
  return THEMES[style];
}
