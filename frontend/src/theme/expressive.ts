'use client';
import { createTheme } from '@mui/material/styles';
import type { ColorRoles, ShapeScale, YunguTokens } from './tokens';
import { MuiAlert } from './alert';
import { APPEARANCE_ATTRIBUTE } from '@/lib/appearance';

// The app's one style, Rounded: Material 3 (Material You). Tonal roles are the M3 light and dark
// schemes for the existing blue primary (#1565c0): a faintly blue-tinted surface, cards and containers
// separated by tone rather than shadow, secondary-container for selection. Priorities keep the original
// error / warning / primary colours in light; dark uses their M3 tone-80 counterparts. Both schemes pass
// WCAG AA (contrast.test.ts).
//
// Scheme selection: `data-appearance="light"|"dark"` on <html>. MUI keys its own variables to that
// attribute (`colorSchemeSelector: 'data-appearance'` -> `[data-appearance="dark"]`), and the Yungu role
// variables below use the same selectors, so one attribute switches everything. "Automatic" is resolved
// to light or dark before paint by MUI's `InitColorSchemeScript attribute="data-appearance"`, which
// sets the same attribute from `prefers-color-scheme`; with no attribute the page is light (`:root`).
export { APPEARANCE_ATTRIBUTE };

/** M3 shape scale (dp = px). */
const shape: ShapeScale = { extraSmall: 4, small: 8, medium: 12, large: 16, extraLarge: 28, full: 9999 };

export const lightRoles: ColorRoles = {
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
  successContainer: '#dcf3e3',
  onSuccessContainer: '#1b6c3a',
};

export const darkRoles: ColorRoles = {
  surface: '#111318',
  surfaceContainerLowest: '#0c0e13',
  surfaceContainerLow: '#191c20',
  surfaceContainer: '#1d2024',
  surfaceContainerHigh: '#282a2f',
  surfaceContainerHighest: '#33353a',
  onSurface: '#e2e2e9',
  onSurfaceVariant: '#c4c6d0',
  outline: '#8e9099',
  outlineVariant: '#44474e',
  primaryContainer: '#284777',
  onPrimaryContainer: '#d6e3ff',
  secondaryContainer: '#3e4759',
  onSecondaryContainer: '#dae2f9',
  successContainer: '#1b5e33',
  onSuccessContainer: '#b7f1c4',
};

/** M3 state layers: on-colour at 8% (hover) over the container, per scheme. */
interface StateRoles {
  hoverOnSurface: string;
  hoverOnSecondaryContainer: string;
  hoverOnPrimaryContainer: string;
}
const lightStates: StateRoles = {
  hoverOnSurface: 'rgba(25, 28, 32, 0.08)',
  hoverOnSecondaryContainer: '#cbd3ea',
  hoverOnPrimaryContainer: '#c6d4f0',
};
const darkStates: StateRoles = {
  hoverOnSurface: 'rgba(226, 226, 233, 0.08)',
  hoverOnSecondaryContainer: '#4a5366',
  hoverOnPrimaryContainer: '#365382',
};

/** Palette keys whose `.light` / `.dark` pair forms a chip (ink on container) in each scheme. */
interface SchemePalette {
  primary: { main: string; light: string; dark: string; contrastText: string };
  secondary: { main: string; light: string; dark: string; contrastText: string };
  error: { main: string; light: string; dark: string; contrastText: string };
  warning: { main: string; light: string; dark: string; contrastText: string };
}

export const lightPalette: SchemePalette = {
  primary: { main: '#1565c0', light: lightRoles.primaryContainer, dark: '#0d4a94', contrastText: '#ffffff' },
  secondary: { main: '#565e71', light: lightRoles.secondaryContainer, dark: '#3e4759', contrastText: '#ffffff' },
  error: { main: '#c62828', light: '#fdecec', dark: '#9b1c1c', contrastText: '#ffffff' },
  warning: { main: '#a85100', light: '#fff3e3', dark: '#7f3d00', contrastText: '#ffffff' },
};

/** Dark: `main` is the tone-80 accent, `.light` the dark container and `.dark` the light ink on it. */
export const darkPalette: SchemePalette = {
  primary: { main: '#aac7ff', light: darkRoles.primaryContainer, dark: darkRoles.onPrimaryContainer, contrastText: '#0a305f' },
  secondary: { main: '#bec6dc', light: darkRoles.secondaryContainer, dark: darkRoles.onSecondaryContainer, contrastText: '#283141' },
  error: { main: '#ffb4ab', light: '#93000a', dark: '#ffdad6', contrastText: '#690005' },
  warning: { main: '#ffb870', light: '#693c00', dark: '#ffdcbe', contrastText: '#4a2800' },
};

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const cssVar = (key: string) => `--yungu-${kebab(key)}`;

/** The CSS custom properties for one scheme (`--yungu-surface: #f9f9ff`, ...). */
function schemeVars(roles: ColorRoles, states: StateRoles): Record<string, string> {
  return Object.fromEntries(Object.entries({ ...roles, ...states }).map(([k, v]) => [cssVar(k), v]));
}

/** Role name -> `var(--yungu-…)`, so `theme.yungu.color.*` resolves per scheme. */
const color = Object.fromEntries(Object.keys(lightRoles).map((k) => [k, `var(${cssVar(k)})`])) as unknown as ColorRoles;
const hoverOnSurface = `var(${cssVar('hoverOnSurface')})`;
const hoverOnSecondaryContainer = `var(${cssVar('hoverOnSecondaryContainer')})`;
const hoverOnPrimaryContainer = `var(${cssVar('hoverOnPrimaryContainer')})`;

/** M3 elevation levels 1–3 (key + ambient shadow). */
const level1 = '0 1px 2px 0 rgba(0, 0, 0, 0.3), 0 1px 3px 1px rgba(0, 0, 0, 0.15)';
const level2 = '0 1px 2px 0 rgba(0, 0, 0, 0.3), 0 2px 6px 2px rgba(0, 0, 0, 0.15)';
/** A menu's shadow (level 2), for menus drawn outside MUI's Popover (the Appearance submenu). */
export const MENU_SHADOW = level2;
const level3 = '0 1px 3px 0 rgba(0, 0, 0, 0.3), 0 4px 8px 3px rgba(0, 0, 0, 0.15)';

/**
 * Touch screens: a button smaller than 48px (M3's minimum target) keeps its size but takes taps over
 * a 48px area centred on it. The inset is negative only on an axis where the button falls short.
 */
const touchTarget = {
  '@media (pointer: coarse)': {
    '&::after': { content: '""', position: 'absolute', inset: 'min(0px, calc((100% - 48px) / 2))' },
  },
};

const tokens: YunguTokens = {
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
  cssVariables: { colorSchemeSelector: APPEARANCE_ATTRIBUTE },
  colorSchemes: {
    light: {
      palette: {
        ...lightPalette,
        background: { default: lightRoles.surface, paper: lightRoles.surfaceContainerLow },
        text: { primary: lightRoles.onSurface, secondary: lightRoles.onSurfaceVariant },
        divider: lightRoles.outlineVariant,
      },
    },
    dark: {
      palette: {
        ...darkPalette,
        background: { default: darkRoles.surface, paper: darkRoles.surfaceContainerLow },
        text: { primary: darkRoles.onSurface, secondary: darkRoles.onSurfaceVariant },
        divider: darkRoles.outlineVariant,
      },
    },
  },
  // Cards, the calendar frame and empty states take the M3 medium corner.
  shape: { borderRadius: shape.medium },
  // M3 type scale on the current font: h1/h2 = title-large, h3 = title-medium, overline = title-small.
  typography: {
    fontFamily: 'var(--font-geist-sans), "PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif',
    h1: { fontSize: '1.375rem', fontWeight: 400, letterSpacing: 0, lineHeight: 28 / 22 },
    h2: { fontSize: '1.375rem', fontWeight: 400, letterSpacing: 0, lineHeight: 28 / 22 },
    h3: { fontSize: '1rem', fontWeight: 600, letterSpacing: '0.009375em', lineHeight: 1.5 },
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
            outline: `2px solid ${(theme.vars ?? theme).palette.primary.main}`,
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
        root: { borderRadius: shape.full, ...touchTarget },
        outlined: { borderColor: color.outline },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: shape.full, ...touchTarget } } },
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
        root: ({ theme }) => ({
          minHeight: 48,
          // MUI shortens menu items from `sm`; a tablet is still a touch screen.
          [theme.breakpoints.up('sm')]: { minHeight: 48 },
          '&.Mui-selected': {
            backgroundColor: color.secondaryContainer,
            color: color.onSecondaryContainer,
            '& .MuiListItemIcon-root': { color: 'inherit' },
          },
          '&.Mui-selected:hover, &.Mui-selected.Mui-focusVisible': { backgroundColor: hoverOnSecondaryContainer },
        }),
      },
    },
    // A small select's 40px field takes taps over 48px on touch screens (see `touchTarget`).
    MuiSelect: {
      styleOverrides: {
        select: { '@media (pointer: coarse)': { '&::after': { content: '""', position: 'absolute', inset: '-4px 0' } } },
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
          ...touchTarget,
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
        // The Yungu role variables, keyed like MUI's own: light on :root and [data-appearance="light"],
        // dark on [data-appearance="dark"] (same specificity, later in the sheet, so it wins).
        [`:root, [${APPEARANCE_ATTRIBUTE}="light"]`]: { colorScheme: 'light', ...schemeVars(lightRoles, lightStates) },
        [`[${APPEARANCE_ATTRIBUTE}="dark"]`]: { colorScheme: 'dark', ...schemeVars(darkRoles, darkStates) },
        '::selection': { backgroundColor: (theme.vars ?? theme).palette.primary.light, color: (theme.vars ?? theme).palette.text.primary },
        html: { scrollbarColor: `${color.outlineVariant} transparent` },
        body: { fontVariantNumeric: 'tabular-nums' },
        // Reduced motion: menus and pop-ups fade in place instead of growing from their anchor, and
        // the tab indicator moves in one step.
        '@media (prefers-reduced-motion: reduce)': {
          '.MuiPopover-paper': { transform: 'none !important', transition: 'opacity 120ms ease-out !important' },
          '.MuiTabs-indicator': { transition: 'none' },
        },
      }),
    },
  },
});
theme.yungu = tokens;

export default theme;
