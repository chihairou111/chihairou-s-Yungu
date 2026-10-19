'use client';
import { createTheme } from '@mui/material/styles';
import type { ColorRoles, ShapeScale, YunguTokens } from './tokens';
import { MuiAlert } from './alert';

// Expressive style: Material 3 (Material You), rounded. Tonal roles are the M3 light scheme for the
// existing blue primary (#1565c0): a faintly blue-tinted surface, cards and containers separated by
// tone rather than shadow, secondary-container for selection. Priorities keep the classic
// error / warning / primary colours, which pass WCAG AA on every surface below.

/** M3 shape scale (dp = px). */
const shape: ShapeScale = { extraSmall: 4, small: 8, medium: 12, large: 16, extraLarge: 28, full: 9999 };

const color: ColorRoles = {
  surface: '#f9f9ff',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#f3f3fa',
  surfaceContainer: '#ededf4',
  surfaceContainerHigh: '#e7e8ee',
  surfaceContainerHighest: '#e2e2e9',
  onSurface: '#191c20',
  onSurfaceVariant: '#44474e',
  outline: '#74777f',
  outlineVariant: '#c4c6d0',
  primaryContainer: '#d6e3ff',
  onPrimaryContainer: '#001b3e',
  secondaryContainer: '#dae2f9',
  onSecondaryContainer: '#131c2b',
};

/** M3 elevation levels 1–3 (key + ambient shadow). */
const level1 = '0 1px 2px 0 rgba(0, 0, 0, 0.3), 0 1px 3px 1px rgba(0, 0, 0, 0.15)';
const level2 = '0 1px 2px 0 rgba(0, 0, 0, 0.3), 0 2px 6px 2px rgba(0, 0, 0, 0.15)';
const level3 = '0 1px 3px 0 rgba(0, 0, 0, 0.3), 0 4px 8px 3px rgba(0, 0, 0, 0.15)';

/** M3 state layers: on-colour at 8% (hover) over the container. */
const hoverOnSurface = 'rgba(25, 28, 32, 0.08)';
const hoverOnSecondaryContainer = '#cbd3ea';
const hoverOnPrimaryContainer = '#c6d4f0';

const tokens: YunguTokens = {
  style: 'expressive',
  shape,
  color,
  // M3 navigation rail: an active indicator pill (secondary container) behind the icon, 56px wide;
  // the floating container is a rounded tonal surface, lifted only while it overlays the page.
  rail: {
    width: 64,
    gap: 16,
    expandedWidth: 196,
    pad: 4,
    itemHeight: 44,
    bg: color.surfaceContainer,
    shadow: 'none',
    expandedShadow: level2,
    fg: color.onSurfaceVariant,
    hoverBg: hoverOnSurface,
    hoverFg: color.onSurface,
    activeBg: color.secondaryContainer,
    activeFg: color.onSecondaryContainer,
    activeHoverBg: hoverOnSecondaryContainer,
    activeFocus: { outlineOffset: -2 },
  },
  // M3 top app bar in its scrolled-under tone: the header reads as one tonal band above the
  // surface, with no line.
  header: { bg: color.surfaceContainer, edge: 'none' },
  loginCard: { radius: shape.extraLarge, shadow: 'none' },
};

const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'light',
    primary: { main: '#1565c0', light: color.primaryContainer, dark: '#0d4a94', contrastText: '#ffffff' },
    secondary: { main: '#565e71', light: color.secondaryContainer, dark: '#3e4759', contrastText: '#ffffff' },
    error: { main: '#c62828', light: '#fdecec', dark: '#9b1c1c', contrastText: '#ffffff' },
    warning: { main: '#a85100', light: '#fff3e3', dark: '#7f3d00', contrastText: '#ffffff' },
    background: { default: color.surface, paper: color.surfaceContainerLow },
    text: { primary: color.onSurface, secondary: color.onSurfaceVariant },
    divider: color.outlineVariant,
  },
  // Cards, the calendar frame and empty states take the M3 medium corner.
  shape: { borderRadius: shape.medium },
  // M3 type scale on the current font: h1/h2 = title-large, h3 = title-medium, overline = title-small.
  typography: {
    fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
    h1: { fontSize: '1.375rem', fontWeight: 400, letterSpacing: 0, lineHeight: 28 / 22 },
    h2: { fontSize: '1.375rem', fontWeight: 400, letterSpacing: 0, lineHeight: 28 / 22 },
    h3: { fontSize: '1rem', fontWeight: 500, letterSpacing: '0.009375em', lineHeight: 1.5 },
    body1: { letterSpacing: '0.03125em', lineHeight: 1.5 },
    body2: { letterSpacing: '0.0178571em', lineHeight: 20 / 14 },
    button: { textTransform: 'none', fontWeight: 500, letterSpacing: '0.00714em' },
    overline: { textTransform: 'none', fontSize: '0.875rem', fontWeight: 500, letterSpacing: '0.00714em' },
  },
  components: {
    MuiAlert,
    // M3 top app bar: flat, one tonal band with the page header below it.
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: { root: { backgroundColor: tokens.header.bg, color: color.onSurface } },
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
    // Common buttons are full pills.
    MuiButton: {
      // M3 filled buttons are flat (level 0).
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: shape.full },
        outlined: { borderColor: color.outline },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: shape.full } } },
    // Assist / filter chip shape.
    MuiChip: { styleOverrides: { root: { borderRadius: shape.small } } },
    // Cards: tonal surface, no shadow.
    MuiCard: {
      styleOverrides: { root: { backgroundColor: color.surfaceContainerLow, boxShadow: 'none' } },
    },
    MuiPaper: {
      styleOverrides: { outlined: { borderColor: 'transparent' } },
    },
    // Menus: extra-small corner, surface container, level 2.
    MuiPopover: {
      styleOverrides: {
        paper: { borderRadius: shape.extraSmall, backgroundColor: color.surfaceContainer, boxShadow: level2 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 48,
          '&.Mui-selected': {
            backgroundColor: color.secondaryContainer,
            color: color.onSecondaryContainer,
            '& .MuiListItemIcon-root': { color: 'inherit' },
          },
          '&.Mui-selected:hover, &.Mui-selected.Mui-focusVisible': { backgroundColor: hoverOnSecondaryContainer },
        },
      },
    },
    // Modal side sheet: large corners on its inner (left) edge, surface container low, level 1.
    MuiDrawer: {
      styleOverrides: {
        paper: {
          variants: [
            {
              props: { anchor: 'right' },
              style: {
                borderTopLeftRadius: shape.large,
                borderBottomLeftRadius: shape.large,
                backgroundColor: color.surfaceContainerLow,
                boxShadow: level1,
              },
            },
          ],
        },
      },
    },
    // Small FAB: 12px rounded square in primary container (M3 FAB corner = medium at 40px, large at 56px).
    MuiFab: {
      styleOverrides: {
        root: {
          borderRadius: shape.medium,
          boxShadow: level3,
          '&.MuiFab-primary': { backgroundColor: color.primaryContainer, color: color.onPrimaryContainer },
          '&.MuiFab-primary:hover': { backgroundColor: hoverOnPrimaryContainer },
          '&:active': { boxShadow: level3 },
        },
      },
    },
    // Primary tabs: a 3px indicator with rounded top corners.
    MuiTabs: {
      styleOverrides: { indicator: { height: 3, borderTopLeftRadius: 3, borderTopRightRadius: 3 } },
    },
    // Outlined text field: extra-small corner.
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: shape.extraSmall },
        notchedOutline: { borderColor: color.outline },
      },
    },
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        '::selection': { backgroundColor: theme.palette.primary.light, color: theme.palette.text.primary },
        html: { colorScheme: 'light', scrollbarColor: `${color.outlineVariant} transparent` },
        body: { fontVariantNumeric: 'tabular-nums' },
      }),
    },
  },
});
theme.yungu = tokens;

export default theme;
