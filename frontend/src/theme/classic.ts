'use client';
import { createTheme } from '@mui/material/styles';
import type { YunguTokens } from './tokens';

// Classic style: the Material 2 look. Light Material theme with a blue accent. Every main color passes WCAG AA
// (>= 4.5:1) as text on both white surfaces and the page background.
// The three assignment priorities map to error (Overdue), warning (Nearly
// overdue) and primary (Upcoming).
const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'light',
    primary: { main: '#1565c0', light: '#e8f0fb', dark: '#0d4a94', contrastText: '#ffffff' },
    error: { main: '#c62828', light: '#fdecec', dark: '#9b1c1c', contrastText: '#ffffff' },
    warning: { main: '#a85100', light: '#fff3e3', dark: '#7f3d00', contrastText: '#ffffff' },
    background: { default: '#f5f7fa', paper: '#ffffff' },
    text: { primary: '#1b2330', secondary: '#5f6b7a' },
    divider: '#e3e8ef',
  },
  // MD2 small corners everywhere (cards, buttons, chips, menus, inputs); avatars and FABs stay round.
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
    h1: { fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3 },
    h2: { fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.005em', lineHeight: 1.35 },
    h3: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.palette.background.paper,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }),
      },
    },
    MuiButtonBase: {
      styleOverrides: {
        root: ({ theme }) => ({
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        }),
      },
    },
    MuiChip: {
      styleOverrides: { root: ({ theme }) => ({ borderRadius: theme.shape.borderRadius }) },
    },
    MuiIconButton: {
      styleOverrides: { root: ({ theme }) => ({ borderRadius: theme.shape.borderRadius }) },
    },
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        '::selection': { backgroundColor: theme.palette.primary.light, color: theme.palette.text.primary },
        html: { colorScheme: 'light', scrollbarColor: `${theme.palette.divider} transparent` },
        body: { fontVariantNumeric: 'tabular-nums' },
      }),
    },
  },
});

const tokens: YunguTokens = {
  style: 'classic',
  // MD2 has one small corner for everything; the M3 names keep components style-agnostic.
  shape: { extraSmall: 4, small: 4, medium: 4, large: 4, extraLarge: 4, full: 4 },
  // Nearest classic equivalents of the M3 roles (white surfaces on a cool grey page).
  color: {
    surface: '#f5f7fa',
    surfaceContainerLowest: '#ffffff',
    surfaceContainerLow: '#ffffff',
    surfaceContainer: '#ffffff',
    surfaceContainerHigh: '#ffffff',
    surfaceContainerHighest: '#ffffff',
    onSurface: '#1b2330',
    onSurfaceVariant: '#5f6b7a',
    outline: '#5f6b7a',
    outlineVariant: '#e3e8ef',
    primaryContainer: '#e8f0fb',
    onPrimaryContainer: '#0d4a94',
    secondaryContainer: '#e8f0fb',
    onSecondaryContainer: '#0d4a94',
  },
  // Floating, elevated rail; the active item is filled with the primary colour.
  rail: {
    width: 56,
    gap: 16,
    expandedWidth: 188,
    pad: 6,
    itemHeight: 44,
    bg: 'background.paper',
    shadow: theme.shadows[3],
    expandedShadow: theme.shadows[8],
    fg: 'text.secondary',
    hoverBg: 'primary.light',
    hoverFg: 'primary.main',
    activeBg: 'primary.main',
    activeFg: 'primary.contrastText',
    activeHoverBg: 'primary.dark',
    activeFocus: { outlineColor: theme.palette.primary.contrastText, outlineOffset: -4 },
  },
  segmentedCheck: false,
  loginCard: { radius: 4, shadow: '0 1px 2px rgba(16, 24, 40, 0.04), 0 12px 32px rgba(16, 24, 40, 0.06)' },
};
theme.yungu = tokens;

export default theme;
