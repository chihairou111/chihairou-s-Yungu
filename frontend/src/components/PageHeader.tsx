'use client';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import { RAIL_EDGE_XS } from './NavRail';

/** Marks a page header so the app shell can join it to the app bar (see `AppShell`). */
export const PAGE_HEADER_ATTR = 'data-page-header';

/** Left inset that keeps content and the title clear of the collapsed nav rail. */
export function contentInset({ yungu: { rail } }: Theme) {
  return { xs: `${RAIL_EDGE_XS + rail.width + 12}px`, sm: `${rail.gap + rail.width + 24}px` };
}

/** Right padding of the app bar, the page header and the page content. */
export const PAGE_PR = { xs: 2, sm: 3 } as const;

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
 * with it, and starts at the title's left edge. The app shell drops the app bar's bottom edge while
 * a page header is present, so the header draws the one edge between the bar and the content
 * (a hairline in classic, a tonal change in expressive; see `theme.yungu.header`).
 */
export default function PageHeader({ children }: PageHeaderProps) {
  return (
    <Box
      {...{ [PAGE_HEADER_ATTR]: '' }}
      sx={(theme) => {
        const inset = contentInset(theme);
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
          ml: { xs: `-${inset.xs}`, sm: `-${inset.sm}` },
          mr: { xs: -PAGE_PR.xs, sm: -PAGE_PR.sm },
          pl: inset,
          pr: PAGE_PR,
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
