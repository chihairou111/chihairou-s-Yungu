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
import { PILL_GAP, PILL_WIDTH } from './PillNav';

/** Left inset that keeps content and the title clear of the collapsed pill nav. */
const CONTENT_INSET = { xs: `${8 + PILL_WIDTH + 12}px`, sm: `${PILL_GAP + PILL_WIDTH + 24}px` };

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
}

/** White Material app bar (section title + account menu) over the page content. */
export default function AppShell({ userName, children }: AppShellProps) {
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

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
      <AppBar position="sticky">
        <Toolbar sx={{ pl: CONTENT_INSET, pr: { xs: 2, sm: 3 } }}>
          <Typography variant="h1" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
            {title}
          </Typography>
          <IconButton
            id="account-button"
            aria-label={`Account: ${userName}`}
            aria-haspopup="menu"
            aria-controls={menuAnchor ? 'account-menu' : undefined}
            aria-expanded={menuAnchor ? 'true' : undefined}
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            sx={{ p: 0.5 }}
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
      <Box component="main" sx={{ pl: CONTENT_INSET, pr: { xs: 2, sm: 3 }, pt: 2, pb: 3 }}>
        {children}
      </Box>
    </Box>
  );
}
