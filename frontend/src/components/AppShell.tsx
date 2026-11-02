'use client';
import { useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Popover from '@mui/material/Popover';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Logout from '@mui/icons-material/Logout';
import { sectionFor } from './nav-items';
import {
  CONTENT_MAX_PX,
  DOCK_MIN_PX,
  PAGE_HEADER_ATTR,
  TODAY_PANEL_ATTR,
  TODAY_PANEL_PX,
  TODAY_PANEL_SPACE,
  alignedPadding,
  pagePadding,
} from './PageHeader';
import { PHONE_NAV_CLEARANCE } from './NavRail';
import { BOTTOM_FAB_MEDIA, showsTodayPanel } from './TodayDrawer';
import NotificationsMenu from './NotificationsMenu';
import TodoistMenu from './TodoistMenu';
import RefreshButton from './RefreshButton';
import { RefreshProvider } from './RefreshContext';

/** "Bruce Zheng" -> "BZ"; "郑博" -> "郑"; blank -> "?". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0];
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : '';
  return (first + last).toUpperCase();
}

interface AppShellProps {
  userName: string;
  children: ReactNode;
  /**
   * Today's classes (a `TodayDrawer`): part of the shell, so it is the same on every page and keeps
   * its state, without re-animating, as the user moves between pages.
   */
  panel?: ReactNode;
}

/**
 * Material app bar (section title, Todoist, notifications, Refresh and the account menu) over the page content. A page
 * may extend the bar with a `PageHeader` (tabs, page controls); the bar then gives up its bottom edge
 * so the two read as one header. The Today's classes panel sits beside the content on every page.
 */
export default function AppShell({ userName, children, panel }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const title = sectionFor(pathname)?.label ?? 'Yungu';
  const closeMenu = () => setMenuAnchor(null);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(false);
    try {
      const res = await fetch('/api/session', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.replace('/login');
    } catch {
      setSignOutError(true);
      setSigningOut(false);
    }
  }

  const shell = (
    <Box
      sx={{
        minHeight: '100dvh',
        bgcolor: 'background.default',
        [`&:has([${PAGE_HEADER_ATTR}]) > .MuiAppBar-root`]: { borderBottom: 'none' },
        // The docked Today's classes panel takes its width from the page (from the dock width) while it
        // is open or sliding out; the width changes in one step, so only the panel itself moves.
        [`@media (min-width: ${DOCK_MIN_PX}px)`]: {
          [`&:has([${TODAY_PANEL_ATTR}][data-takes-space="true"])`]: { '--today-panel': `${TODAY_PANEL_PX}px` },
        },
      }}
    >
      <AppBar position="sticky">
        <Toolbar sx={(theme) => alignedPadding(theme, 'viewport')}>
          <Typography variant="h1" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
            {title}
          </Typography>
          <TodoistMenu />
          <NotificationsMenu />
          <RefreshButton />
          <IconButton
            id="account-button"
            aria-label={`Account: ${userName}`}
            aria-haspopup="menu"
            aria-controls={menuAnchor ? 'account-menu' : undefined}
            aria-expanded={menuAnchor ? 'true' : undefined}
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            sx={{ ml: 1, p: 0.5, borderRadius: '50%' }}
          >
            <Avatar sx={{ width: 36, height: 36, fontSize: '0.875rem', fontWeight: 600, bgcolor: 'primary.main' }}>
              {initials(userName)}
            </Avatar>
          </IconButton>
          {/* A Popover rather than Menu so the account name and errors sit outside role="menu". */}
          <Popover
            anchorEl={menuAnchor}
            open={menuAnchor !== null}
            onClose={closeMenu}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { mt: 1, minWidth: 220, maxWidth: 300 } } }}
          >
            <Box sx={{ px: 2, pt: 1.5, pb: 1.5 }}>
              <Typography variant="body2" color="text.secondary">
                Signed in as
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                {userName}
              </Typography>
            </Box>
            <Divider />
            <MenuList
              id="account-menu"
              aria-labelledby="account-button"
              autoFocusItem
              onKeyDown={(e) => {
                if (e.key === 'Tab') closeMenu();
              }}
            >
              <MenuItem onClick={signOut} disabled={signingOut}>
                <ListItemIcon>
                  <Logout fontSize="small" />
                </ListItemIcon>
                {signingOut ? 'Signing out…' : 'Sign out'}
              </MenuItem>
            </MenuList>
            {signOutError && (
              <Typography role="alert" variant="body2" color="error" sx={{ px: 2, pb: 1.5, maxWidth: 260 }}>
                Sign-out failed. Check your connection and try again.
              </Typography>
            )}
          </Popover>
        </Toolbar>
      </AppBar>
      <Box
        component="main"
        sx={(theme) => ({
          ...pagePadding(theme),
          pt: 2,
          // Room for the docked panel, which slides in over this margin.
          mr: TODAY_PANEL_SPACE,
          // Room below the last card for the bottom-right Today's classes button (40 + 16 inset + margin)
          // where it is always shown (not on the calendar, which has no button); on phones the last card
          // clears the bottom nav and the button beside it.
          pb: { xs: PHONE_NAV_CLEARANCE, sm: 3 },
          ...(showsTodayPanel(pathname) && { [BOTTOM_FAB_MEDIA]: { pb: 9 } }),
          [theme.breakpoints.down('sm')]: { pb: PHONE_NAV_CLEARANCE },
          // Content is capped and centred; a page header still spans the full width (see PageHeader).
          [`& > :not([${PAGE_HEADER_ATTR}])`]: { maxWidth: CONTENT_MAX_PX, mx: 'auto' },
          // A page header sits flush under the app bar and sets the content's top spacing itself.
          [`&:has([${PAGE_HEADER_ATTR}])`]: { pt: 0 },
        })}
      >
        {children}
      </Box>
      {panel}
    </Box>
  );
  // The bar's Refresh also reloads an open assignment pop-up, which lives in the page content.
  return <RefreshProvider>{shell}</RefreshProvider>;
}
