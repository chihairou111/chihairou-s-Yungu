'use client';
import { createTheme } from '@mui/material/styles';

// Light Material theme with a blue accent. Every main color passes WCAG AA
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
  shape: { borderRadius: 10 },
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
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        '::selection': { backgroundColor: theme.palette.primary.light, color: theme.palette.text.primary },
        html: { colorScheme: 'light', scrollbarColor: `${theme.palette.divider} transparent` },
        body: { fontVariantNumeric: 'tabular-nums' },
      }),
    },
  },
});

export default theme;
