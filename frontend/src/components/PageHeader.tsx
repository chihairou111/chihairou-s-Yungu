'use client';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';

/** Marks a page header so the app shell can join it to the app bar (see `AppShell`). */
export const PAGE_HEADER_ATTR = 'data-page-header';

/** Marks the docked Today's classes panel; while it is open (from 900px) the content narrows for it. */
export const TODAY_PANEL_ATTR = 'data-today-panel';
/** Width of the docked panel (px). */
export const TODAY_PANEL_PX = 344;
/** Space the open panel takes from the page (a length; 0px while closed). Set by the app shell. */
export const TODAY_PANEL_SPACE = 'var(--today-panel, 0px)';

/** Content is capped at this width and centred in the space right of the rail (on large screens). */
export const CONTENT_MAX_PX = 1280;
/** Phones: the nav sits at the bottom, so the page takes the Material compact margin on both sides. */
const PHONE_MARGIN_PX = 16;
/** Right margin from `sm` and from `lg` (px). */
const RIGHT_SM_PX = 24;
const RIGHT_LG_PX = 32;

type Responsive = { xs: string; sm: string; lg: string };

/** Page margins in px per breakpoint: clear of the rail on the left from `sm` (it moves to the bottom on phones). */
function margins({ yungu: { rail } }: Theme) {
  const railLeft = rail.gap + rail.width + 24;
  return {
    left: { xs: PHONE_MARGIN_PX, sm: railLeft, lg: railLeft },
    right: { xs: PHONE_MARGIN_PX, sm: RIGHT_SM_PX, lg: RIGHT_LG_PX },
  };
}

const px = (n: number) => `${n}px`;

function perBreakpoint(f: (bp: keyof Responsive) => string): Responsive {
  return { xs: f('xs'), sm: f('sm'), lg: f('lg') };
}

/** Left and right padding of the page content (the content column itself is capped by `capContent`). */
export function pagePadding(theme: Theme): { pl: Responsive; pr: Responsive } {
  const { left, right } = margins(theme);
  return { pl: perBreakpoint((bp) => px(left[bp])), pr: perBreakpoint((bp) => px(right[bp])) };
}

/**
 * Padding for a full-width bar so its contents line up with the capped, centred content column.
 * `within: 'viewport'` for a bar as wide as the window (the app bar); `'content'` for a bar whose
 * containing block is the padded page content (the page header, which then bleeds out).
 */
export function alignedPadding(theme: Theme, within: 'viewport' | 'content'): { pl: Responsive; pr: Responsive } {
  const { left, right } = margins(theme);
  const gutter = (bp: keyof Responsive, reserved = '0px') =>
    within === 'viewport'
      ? `max(0px, (100% - ${reserved} - ${px(left[bp] + right[bp] + CONTENT_MAX_PX)}) / 2)`
      : `max(0px, (100% - ${px(CONTENT_MAX_PX)}) / 2)`;
  return {
    // The app bar spans the window, over the docked panel too: its title follows the content's left
    // edge (which moves when the panel takes its space), while its actions stay at the window's end.
    pl: perBreakpoint((bp) => `calc(${px(left[bp])} + ${gutter(bp, within === 'viewport' ? TODAY_PANEL_SPACE : '0px')})`),
    pr: perBreakpoint((bp) => `calc(${px(right[bp])} + ${gutter(bp)})`),
  };
}

/** Space between the page header and the content below it (8px units): 24px. */
const CONTENT_GAP = 3;

type Styles = { [key: string]: unknown };

/** The app bar's height at every breakpoint, as `top` offsets (the toolbar mixin with `minHeight` renamed). */
function belowToolbar(toolbar: Styles): Styles {
  return Object.fromEntries(
    Object.entries(toolbar).map(([key, value]) =>
      key === 'minHeight' ? ['top', value] : [key, value && typeof value === 'object' ? belowToolbar(value as Styles) : value],
    ),
  );
}

interface PageHeaderProps {
  children: ReactNode;
}

/**
 * The lower part of the top app bar, owned by the page: tabs or page controls on the app bar's own
 * surface ("tabs attached to the top app bar"). It spans the full width under the app bar, sticks
 * with it, and starts at the title's left edge (both line up with the capped content column). The app shell drops the app bar's bottom edge while
 * a page header is present, so the header draws the one edge between the bar and the content
 * (a hairline in classic, a tonal change in expressive; see `theme.yungu.header`).
 */
export default function PageHeader({ children }: PageHeaderProps) {
  return (
    <Box
      {...{ [PAGE_HEADER_ATTR]: '' }}
      sx={(theme) => {
        const { pl, pr } = pagePadding(theme);
        const aligned = alignedPadding(theme, 'content');
        const { header } = theme.yungu;
        return {
          ...belowToolbar(theme.mixins.toolbar as Styles),
          position: 'sticky',
          zIndex: theme.zIndex.appBar,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 2,
          minHeight: 48,
          // Full bleed: undo the content padding, then pad back to the title's left edge.
          ml: perBreakpoint((bp) => `-${pl[bp]}`),
          mr: perBreakpoint((bp) => `-${pr[bp]}`),
          ...aligned,
          mb: CONTENT_GAP,
          bgcolor: header.bg,
          borderBottom: header.edge,
          color: 'text.primary',
        };
      }}
    >
      {children}
    </Box>
  );
}
