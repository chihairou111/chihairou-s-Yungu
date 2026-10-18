import type SvgIcon from '@mui/material/SvgIcon';
import AssignmentTurnedIn from '@mui/icons-material/AssignmentTurnedIn';
import AssignmentTurnedInOutlined from '@mui/icons-material/AssignmentTurnedInOutlined';
import CalendarMonth from '@mui/icons-material/CalendarMonth';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';

export interface NavItem {
  href: '/assignments' | '/calendar';
  label: string;
  /** Outlined icon for the resting state, filled icon when active. */
  Icon: typeof SvgIcon;
  ActiveIcon: typeof SvgIcon;
}

/** Dashboard sections, top to bottom in the nav rail. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/assignments', label: 'Assignments', Icon: AssignmentTurnedInOutlined, ActiveIcon: AssignmentTurnedIn },
  { href: '/calendar', label: 'Calendar', Icon: CalendarMonthOutlined, ActiveIcon: CalendarMonth },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The section the pathname belongs to, if any. */
export function sectionFor(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isActive(pathname, item.href));
}
