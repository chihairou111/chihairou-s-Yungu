import type { ReactNode } from 'react';
import { io } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { data } from '@/lib/data';
import { loadPanelClasses } from '@/lib/schedule';
import { TODAY_PANEL_COOKIE, parseTodayPanel } from '@/lib/today-panel';
import AppShell from '@/components/AppShell';
import NavRail from '@/components/NavRail';
import TodayDrawer from '@/components/TodayDrawer';

// The session gate reads the request cookie, so this segment renders per
// request and may block navigation into it (reading a cookie is instant).
export const instant = false;

/** Today's and the next school day's classes for the shell's panel; the clock is read once per request. */
async function loadToday() {
  await io();
  const now = Date.now();
  const [courses, events] = await Promise.all([data.getCourses(), loadPanelClasses(now, (weekStart) => data.getWeek(weekStart))]);
  return { now, courses, events };
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const [{ now, courses, events }, cookieStore] = await Promise.all([loadToday(), cookies()]);
  // Read on the server, so a reload paints the panel in its stored state with no flash or slide.
  // The layout persists across pages, so moving between them never re-animates the panel. The panel
  // itself leaves out the calendar (from the pathname, also on the server), keeping this state.
  const panelOpen = parseTodayPanel(cookieStore.get(TODAY_PANEL_COOKIE)?.value);

  return (
    <>
      {/* Nav first in DOM order so keyboard users reach it before the page content. */}
      <NavRail />
      <AppShell
        userName={session.name}
        panel={<TodayDrawer events={events} now={now} courses={courses} initialPanelOpen={panelOpen} />}
      >
        {children}
      </AppShell>
    </>
  );
}
