'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { NAV_ITEMS, isActive } from './nav-items';

/** Collapsed pill width; AppShell reserves this plus the side gap for content. */
export const PILL_WIDTH = 56;
export const PILL_GAP = 16;
const EXPANDED_WIDTH = 188;
const PAD = 6;
const ITEM_HEIGHT = 44;
// Material "emphasized decelerate": quick start, soft landing.
const EASE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';

/**
 * Floating vertical pill on the left edge. Shows icons only; widens to the
 * right on hover or keyboard focus to reveal labels, overlaying the page.
 * Labels stay in the DOM (clipped, not hidden) so links keep their names.
 */
export default function PillNav() {
  const pathname = usePathname();

  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={(theme) => ({
        position: 'fixed',
        zIndex: theme.zIndex.appBar + 1,
        left: { xs: 8, sm: PILL_GAP },
        top: '50%',
        transform: 'translateY(-50%)',
        width: PILL_WIDTH,
        p: `${PAD}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        borderRadius: `${PILL_WIDTH / 2}px`,
        border: `1px solid ${theme.palette.divider}`,
        boxShadow: '0 2px 6px rgba(16, 24, 40, 0.06), 0 8px 24px rgba(16, 24, 40, 0.08)',
        transition: `width 240ms ${EASE}, box-shadow 240ms ${EASE}`,
        '&:hover, &:focus-within': {
          width: EXPANDED_WIDTH,
          boxShadow: '0 4px 10px rgba(16, 24, 40, 0.08), 0 16px 40px rgba(16, 24, 40, 0.14)',
        },
        '&:hover .pill-label, &:focus-within .pill-label': { opacity: 1 },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '& .pill-label': { transition: 'none' },
        },
      })}
    >
      {NAV_ITEMS.map(({ href, label, Icon, ActiveIcon }) => {
        const active = isActive(pathname, href);
        const ItemIcon = active ? ActiveIcon : Icon;
        return (
          <ButtonBase
            key={href}
            component={Link}
            href={href}
            aria-current={active ? 'page' : undefined}
            sx={(theme) => ({
              justifyContent: 'flex-start',
              gap: 1.5,
              height: ITEM_HEIGHT,
              // Centre the 24px icon in the collapsed pill (-1 for the pill border).
              pl: `${(PILL_WIDTH - PAD * 2 - 24) / 2 - 1}px`,
              pr: 2,
              borderRadius: `${ITEM_HEIGHT / 2}px`,
              whiteSpace: 'nowrap',
              color: active ? 'primary.contrastText' : 'text.secondary',
              bgcolor: active ? 'primary.main' : 'transparent',
              transition: 'background-color 150ms, color 150ms',
              '&:hover': {
                bgcolor: active ? 'primary.dark' : 'primary.light',
                color: active ? 'primary.contrastText' : 'primary.main',
              },
              // Keep the ring inside the clipped pill; white on the filled item.
              '&.Mui-focusVisible': active
                ? { outlineColor: theme.palette.primary.contrastText, outlineOffset: -4 }
                : { outlineOffset: -2 },
            })}
          >
            <ItemIcon fontSize="medium" aria-hidden />
            <Box
              component="span"
              className="pill-label"
              sx={{ fontSize: '0.9375rem', fontWeight: 600, opacity: 0, transition: `opacity 160ms ${EASE} 40ms` }}
            >
              {label}
            </Box>
          </ButtonBase>
        );
      })}
    </Box>
  );
}
