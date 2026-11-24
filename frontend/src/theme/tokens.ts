/** Corner radii in px, named after the Material 3 shape scale. */
export interface ShapeScale {
  extraSmall: number;
  small: number;
  medium: number;
  large: number;
  extraLarge: number;
  /** Fully rounded ends (a pill or a circle). */
  full: number;
}

/** Material 3 color roles used outside MUI's palette. */
export interface ColorRoles {
  surface: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  /** Good news on a tonal container (a behaviour bonus); the error pair carries the opposite. */
  successContainer: string;
  onSuccessContainer: string;
}

/** Nav rail geometry and colours. Colours are sx values (palette paths or CSS colours). */
export interface RailTokens {
  /** Collapsed width; the app shell reserves it (plus `gap`) on the left. */
  width: number;
  /** Distance from the left edge from `sm` up (8px below). */
  gap: number;
  expandedWidth: number;
  pad: number;
  itemHeight: number;
  bg: string;
  shadow: string;
  expandedShadow: string;
  fg: string;
  hoverBg: string;
  hoverFg: string;
  activeBg: string;
  activeFg: string;
  activeHoverBg: string;
  /** Focus ring on the active item, kept inside the clipped rail. */
  activeFocus: { outlineColor?: string; outlineOffset: number };
}

/** Theme values outside MUI's own (M3 roles, rail, header), read by components through `theme.yungu`. */
export interface YunguTokens {
  shape: ShapeScale;
  color: ColorRoles;
  rail: RailTokens;
  /**
   * Top app bar surface, shared by the page header that extends it (tabs, page controls).
   * `edge` is the one boundary between that header and the content (a CSS border value).
   */
  header: { bg: string; edge: string };
  /** Sign-in panel. */
  loginCard: { radius: number; shadow: string };
  /** Dialog surface (pop-ups and their sub-dialogs), per scheme. */
  dialog: { bg: string };
  /** Menu surface (popovers and the Appearance submenu), per scheme. */
  menu: { bg: string };
}

declare module '@mui/material/styles' {
  // The theme is built with CSS variables, so `theme.vars` is always there: styles written with it
  // (`theme.vars.palette.*`, `theme.alpha(theme.vars.palette.*, n)`) follow the scheme in CSS.
  interface CssThemeVariables {
    enabled: true;
  }
  interface Theme {
    yungu: YunguTokens;
  }
  interface ThemeOptions {
    yungu?: YunguTokens;
  }
}
