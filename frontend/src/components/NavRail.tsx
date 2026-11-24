'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { NAV_ITEMS, isActive } from './nav-items';

/** Phones: a horizontal pill docked bottom-left (16px insets), 56 tall with 48px-high items. */
const BAR_EDGE_PX = 16;
const BAR_ITEM_PX = 48;
/** Touch screens from 600px: the rail is 88 wide (room for its longest label), 8px from the edge, with 56px-high items. */
const TOUCH_RAIL_PX = 88;
const TOUCH_RAIL_EDGE_PX = 8;
const TOUCH_ITEM_PX = 56;
/** A touch screen has no hover to reveal labels, so there they always show, under the icons. */
const TOUCH = '@media (hover: none)';
const HOVER = '@media (hover: hover)';
/** The label under an icon (M3 label-medium). */
const LABEL_UNDER = { opacity: 1, fontSize: '0.75rem', lineHeight: '1rem', fontWeight: 500 };
/** Bottom padding (8px units) that keeps the last of the page clear of the phone nav: 16 + 56 + 16 = 88px. */
export const PHONE_NAV_CLEARANCE = 11;
// Material "emphasized decelerate": quick start, soft landing.
const EASE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
const ICON_PX = 24;

/**
 * Floating vertical rail on the left edge from 600px. With a mouse it shows icons only and widens to
 * the right on hover or keyboard focus to reveal labels, overlaying the page; labels stay in the DOM
 * (clipped, not hidden) so links keep their names. On a touch screen, which has no hover, the labels
 * always show under the icons. Size, shape and colours come from `theme.yungu.rail`: an M3 rail with
 * a pill active indicator. On phones the same pill turns horizontal and docks at the bottom left
 * (Material's compact layout puts navigation at the bottom), each icon over its label.
 */
export default function NavRail() {
  const pathname = usePathname();

  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={({ zIndex, breakpoints, yungu: { rail, shape } }) => ({
        position: 'fixed',
        zIndex: zIndex.appBar + 1,
        display: 'flex',
        gap: 0.5,
        overflow: 'hidden',
        bgcolor: rail.bg,
        borderRadius: `${shape.extraLarge}px`,
        [breakpoints.down('sm')]: {
          left: BAR_EDGE_PX,
          bottom: `calc(${BAR_EDGE_PX}px + env(safe-area-inset-bottom, 0px))`,
          flexDirection: 'row',
          p: 0.5,
          // Always over scrolling content, so always lifted.
          boxShadow: rail.expandedShadow,
          '& .rail-label': LABEL_UNDER,
        },
        [breakpoints.up('sm')]: {
          left: rail.gap,
          top: '50%',
          transform: 'translateY(-50%)',
          flexDirection: 'column',
          width: rail.width,
          p: `${rail.pad}px`,
          boxShadow: rail.shadow,
          transition: `width 240ms ${EASE}, box-shadow 240ms ${EASE}`,
          [HOVER]: {
            '&:hover, &:has(:focus-visible)': {
              width: rail.expandedWidth,
              boxShadow: rail.expandedShadow,
            },
            '&:hover .rail-label, &:has(:focus-visible) .rail-label': { opacity: 1 },
          },
          [TOUCH]: {
            left: TOUCH_RAIL_EDGE_PX,
            width: TOUCH_RAIL_PX,
            '& .rail-label': LABEL_UNDER,
          },
        },
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
            sx={({ breakpoints, yungu: { rail, shape } }) => ({
              [breakpoints.down('sm')]: { flexDirection: 'column', justifyContent: 'center', gap: '2px', minWidth: 64, minHeight: BAR_ITEM_PX, px: 0.75 },
              [breakpoints.up('sm')]: {
                justifyContent: 'flex-start',
                gap: 1.5,
                height: rail.itemHeight,
                // Centre the icon in the collapsed rail.
                pl: `${(rail.width - rail.pad * 2 - ICON_PX) / 2}px`,
                pr: 2,
                [TOUCH]: { flexDirection: 'column', justifyContent: 'center', gap: '2px', height: 'auto', minHeight: TOUCH_ITEM_PX, px: 0 },
              },
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
