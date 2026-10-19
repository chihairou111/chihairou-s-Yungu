'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { NAV_ITEMS, isActive } from './nav-items';

/** Distance from the left edge below `sm`; from `sm` up it is `theme.yungu.rail.gap`. */
export const RAIL_EDGE_XS = 8;
// Material "emphasized decelerate": quick start, soft landing.
const EASE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
const ICON_PX = 24;

/**
 * Floating vertical rail on the left edge. Shows icons only; widens to the right on hover or
 * keyboard focus to reveal labels, overlaying the page. Labels stay in the DOM (clipped, not
 * hidden) so links keep their names. Size, shape and colours come from `theme.yungu.rail`:
 * classic is an elevated MD2 rail with a filled active item; expressive is an M3 rail with a pill
 * active indicator.
 */
export default function NavRail() {
  const pathname = usePathname();

  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={({ zIndex, yungu: { rail, shape } }) => ({
        position: 'fixed',
        zIndex: zIndex.appBar + 1,
        left: { xs: RAIL_EDGE_XS, sm: rail.gap },
        top: '50%',
        transform: 'translateY(-50%)',
        width: rail.width,
        p: `${rail.pad}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        overflow: 'hidden',
        bgcolor: rail.bg,
        borderRadius: `${shape.extraLarge}px`,
        boxShadow: rail.shadow,
        transition: `width 240ms ${EASE}, box-shadow 240ms ${EASE}`,
        '&:hover, &:has(:focus-visible)': {
          width: rail.expandedWidth,
          boxShadow: rail.expandedShadow,
        },
        '&:hover .rail-label, &:has(:focus-visible) .rail-label': { opacity: 1 },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '& .rail-label': { transition: 'none' },
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
            sx={({ yungu: { rail, shape } }) => ({
              justifyContent: 'flex-start',
              gap: 1.5,
              height: rail.itemHeight,
              // Centre the icon in the collapsed rail.
              pl: `${(rail.width - rail.pad * 2 - ICON_PX) / 2}px`,
              pr: 2,
              borderRadius: `${shape.full}px`,
              whiteSpace: 'nowrap',
              color: active ? rail.activeFg : rail.fg,
              bgcolor: active ? rail.activeBg : 'transparent',
              transition: 'background-color 150ms, color 150ms',
              '&:hover': {
                bgcolor: active ? rail.activeHoverBg : rail.hoverBg,
                color: active ? rail.activeFg : rail.hoverFg,
              },
              // Keep the ring inside the clipped rail.
              '&.Mui-focusVisible': active ? rail.activeFocus : { outlineOffset: -2 },
            })}
          >
            <ItemIcon fontSize="medium" aria-hidden />
            <Box
              component="span"
              className="rail-label"
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
