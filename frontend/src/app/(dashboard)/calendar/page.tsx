import type { Metadata } from 'next';
import { io } from 'next/cache';
import ServiceUnavailable from '@/components/ServiceUnavailable';
import WeekCalendar from '@/components/WeekCalendar';
import { YunguUnavailable, data } from '@/lib/data';
import { loadPageData } from '@/lib/page-data';
import { parseWeekParam } from '@/lib/time';

export const metadata: Metadata = { title: 'Calendar' };

/** Reads the clock once per request so "today" and the default week agree. */
async function loadWeek(weekParam: string | undefined) {
  await io();
  const now = Date.now();
  const weekStart = parseWeekParam(weekParam, now);
  const [events, courses] = await Promise.all([data.getWeek(weekStart), data.getCourses()]);
  return { now, weekStart, events, courses };
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const { week } = await searchParams;
  const loaded = await loadPageData(() => loadWeek(typeof week === 'string' ? week : undefined));
  if (loaded instanceof YunguUnavailable) return <ServiceUnavailable message={loaded.message} />;
  const { now, weekStart, events, courses } = loaded;
  return <WeekCalendar weekStart={weekStart} events={events} courses={courses} now={now} />;
}
