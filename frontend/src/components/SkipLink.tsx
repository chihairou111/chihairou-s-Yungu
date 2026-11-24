'use client';
import Box from '@mui/material/Box';

/** The page content's id: where the skip link lands. */
export const MAIN_ID = 'main';

/**
 * The first stop for keyboard users: jumps past the nav and the app bar's buttons to the page
 * content. Off screen until it takes focus.
 */
export default function SkipLink() {
  return (
    <Box
      component="a"
      href={`#${MAIN_ID}`}
      sx={(theme) => ({
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: theme.zIndex.tooltip,
        px: 2,
        py: 1,
        borderRadius: `${theme.yungu.shape.full}px`,
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        fontSize: '0.875rem',
        fontWeight: 500,
        transform: 'translateY(calc(-100% - 16px))',
        '&:focus': { transform: 'none', outline: `2px solid ${theme.vars.palette.primary.main}`, outlineOffset: 2 },
      })}
    >
      Skip to content
    </Box>
  );
}
