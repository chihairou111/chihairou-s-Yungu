import type { Components, Theme } from '@mui/material/styles';

/**
 * The standard Alerts: the palette's dark shade as text on its light tint (dark red 7.1:1, dark
 * amber), the icon in the main colour (red 4.9:1). The `.light` / `.dark` pairs are already a
 * container and its ink in each scheme (light: pale tint, dark ink; dark: deep tint, pale ink); MUI
 * would otherwise lighten (light) or darken (dark) them again into near-white or near-black.
 */
export const MuiAlert: Components<Theme>['MuiAlert'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      variants: (['error', 'warning', 'info', 'success'] as const).map((severity) => ({
        props: { variant: 'standard' as const, severity },
        style: {
          backgroundColor: (theme.vars ?? theme).palette[severity].light,
          color: (theme.vars ?? theme).palette[severity].dark,
          '& .MuiAlert-icon': { color: (theme.vars ?? theme).palette[severity].main },
        },
      })),
    }),
  },
};
