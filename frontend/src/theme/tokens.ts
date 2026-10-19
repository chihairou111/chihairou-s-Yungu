import type { UiStyle } from '@/lib/style';

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

/** Everything a component needs to render the current style, so components never branch on its name. */
export interface YunguTokens {
  style: UiStyle;
  shape: ShapeScale;
  color: ColorRoles;
  rail: RailTokens;
  /** Material 3 segmented buttons show a check on the selected segment. */
  segmentedCheck: boolean;
  /**
   * Top app bar surface, shared by the page header that extends it (tabs, page controls).
   * `edge` is the one boundary between that header and the content (a CSS border value).
   */
  header: { bg: string; edge: string };
  /** Sign-in panel. */
  loginCard: { radius: number; shadow: string };
}

declare module '@mui/material/styles' {
  interface Theme {
    yungu: YunguTokens;
  }
  interface ThemeOptions {
    yungu?: YunguTokens;
  }
}
