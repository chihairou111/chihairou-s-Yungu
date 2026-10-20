import type { Components, Theme } from '@mui/material/styles';

/**
 * The standard error and warning Alerts: the palette's dark shade as text on its light
 * tint (dark red 7.1:1, dark amber), the icon in the main colour (red 4.9:1). MUI would otherwise
 * lighten `error.light` / `warning.light`, which are already tints, to near-white and darken them to a
 * greyish text that no longer reads as an error or a notice.
 */
export const MuiAlert: Components<Theme>['MuiAlert'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      variants: (['error', 'warning'] as const).map((severity) => ({
        props: { variant: 'standard' as const, severity },
        style: {
          backgroundColor: theme.palette[severity].light,
          color: theme.palette[severity].dark,
          '& .MuiAlert-icon': { color: theme.palette[severity].main },
        },
      })),
    }),
  },
};
