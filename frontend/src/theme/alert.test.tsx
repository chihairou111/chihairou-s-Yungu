import { render, screen } from '@testing-library/react';
import Alert from '@mui/material/Alert';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/colors';
import { getTheme } from './index';

describe.each(['classic', 'expressive'] as const)('%s error alert', (style) => {
  it('is dark red on the light red tint (the palette error.light, not a lightened copy of it)', () => {
    const theme = getTheme(style);
    render(
      <ThemeProvider theme={theme}>
        <Alert severity="error">Could not upload.</Alert>
      </ThemeProvider>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveStyle({ backgroundColor: theme.palette.error.light, color: theme.palette.error.dark });
    expect(alert.querySelector('.MuiAlert-icon')).toHaveStyle({ color: theme.palette.error.main });
    expect(contrastRatio(theme.palette.error.dark, theme.palette.error.light)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.palette.error.main, theme.palette.error.light)).toBeGreaterThanOrEqual(3);
  });
});

describe.each(['classic', 'expressive'] as const)('%s warning alert', (style) => {
  it('is dark amber on the light amber tint, so it reads as a notice and not as grey text', () => {
    const theme = getTheme(style);
    render(
      <ThemeProvider theme={theme}>
        <Alert severity="warning">Sign in again.</Alert>
      </ThemeProvider>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveStyle({ backgroundColor: theme.palette.warning.light, color: theme.palette.warning.dark });
    expect(alert.querySelector('.MuiAlert-icon')).toHaveStyle({ color: theme.palette.warning.main });
    expect(contrastRatio(theme.palette.warning.dark, theme.palette.warning.light)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.palette.warning.main, theme.palette.warning.light)).toBeGreaterThanOrEqual(3);
  });
});
