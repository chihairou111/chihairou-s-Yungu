import { render, screen } from '@testing-library/react';
import Alert from '@mui/material/Alert';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/colors';
import theme from './index';
import { darkPalette, lightPalette } from './expressive';

// Styles read MUI's per-scheme CSS variables; the contrast checks use each scheme's hex values.
const v = (path: string) => `var(--mui-palette-${path})`;

describe('error alert', () => {
  it('is dark red on the light red tint (the palette error.light, not a lightened copy of it)', () => {
    render(
      <ThemeProvider theme={theme}>
        <Alert severity="error">Could not upload.</Alert>
      </ThemeProvider>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveStyle({ backgroundColor: v('error-light'), color: v('error-dark') });
    expect(alert.querySelector('.MuiAlert-icon')).toHaveStyle({ color: v('error-main') });
    for (const { error: p } of [lightPalette, darkPalette]) {
      expect(contrastRatio(p.dark, p.light)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.main, p.light)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('warning alert', () => {
  it('is dark amber on the light amber tint, so it reads as a notice and not as grey text', () => {
    render(
      <ThemeProvider theme={theme}>
        <Alert severity="warning">Sign in again.</Alert>
      </ThemeProvider>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveStyle({ backgroundColor: v('warning-light'), color: v('warning-dark') });
    expect(alert.querySelector('.MuiAlert-icon')).toHaveStyle({ color: v('warning-main') });
    for (const { warning: p } of [lightPalette, darkPalette]) {
      expect(contrastRatio(p.dark, p.light)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.main, p.light)).toBeGreaterThanOrEqual(3);
    }
  });
});
