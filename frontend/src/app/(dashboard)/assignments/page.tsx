import type { Metadata } from 'next';
import { io } from 'next/cache';
import { cookies } from 'next/headers';
import AssignmentsView from '@/components/AssignmentsView';
import { data } from '@/lib/data';
import { todaysClasses } from '@/lib/schedule';
import { TODAY_PANEL_COOKIE, parseTodayPanel } from '@/lib/today-panel';
import { weekStartOf } from '@/lib/time';

export const metadata: Metadata = { title: 'Assignments' };

/** Reads the clock once per request (kept out of the static shell) so every card agrees on `now`. */
async function loadAssignments() {
  await io();
  const now = Date.now();
  const weekStart = weekStartOf(now);
  const [todo, submitted, courses, week] = await Promise.all([
    data.getTodo(),
    data.getSubmitted(),
    data.getCourses(),
    data.getWeek(weekStart),
  ]);
  return { now, todo, submitted, courses, todayClasses: todaysClasses(week, now) };
}

export default async function AssignmentsPage() {
  const [{ now, todo, submitted, courses, todayClasses }, cookieStore] = await Promise.all([loadAssignments(), cookies()]);
  // Read on the server, so a reload paints the panel in its stored state with no flash or slide.
  const panelOpen = parseTodayPanel(cookieStore.get(TODAY_PANEL_COOKIE)?.value);
  return (
    <AssignmentsView
      todo={todo}
      submitted={submitted}
      courses={courses}
      todayClasses={todayClasses}
      now={now}
      initialPanelOpen={panelOpen}
    />
  );
}
