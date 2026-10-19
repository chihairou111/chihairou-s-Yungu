import type { Components, Theme } from '@mui/material/styles';

/**
 * The standard error Alert in both styles: dark red text (7.1:1) on the palette's light red tint, with
 * the icon in the main red (4.9:1). MUI would otherwise lighten `error.light`, which is already a tint,
 * to near-white and darken it to a greyish text that no longer reads as an error.
 */
export const MuiAlert: Components<Theme>['MuiAlert'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      variants: [
        {
          props: { variant: 'standard', severity: 'error' },
          style: {
            backgroundColor: theme.palette.error.light,
            color: theme.palette.error.dark,
            '& .MuiAlert-icon': { color: theme.palette.error.main },
          },
        },
      ],
    }),
  },
};
