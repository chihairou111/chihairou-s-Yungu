import type { ColorRoles } from './tokens';

// The M3 tonal roles of both schemes, as hex, for code that computes with them (contrast tests, the
// calendar's course tints). Components read them through `theme.yungu.color`, which follows the scheme.

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
