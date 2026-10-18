import type { Metadata } from 'next';
import { io } from 'next/cache';
import WeekCalendar from '@/components/WeekCalendar';
import { data } from '@/lib/data';
import { parseWeekParam } from '@/lib/time';

export const metadata: Metadata = { title: 'Calendar' };

/** Reads the clock once per request so "today" and the default week agree. */
async function loadWeek(weekParam: string | undefined) {
  await io();
  const now = Date.now();
  const weekStart = parseWeekParam(weekParam, now);
  const events = await data.getWeek(weekStart);
  return { now, weekStart, events };
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const { week } = await searchParams;
  const { now, weekStart, events } = await loadWeek(typeof week === 'string' ? week : undefined);
  return <WeekCalendar weekStart={weekStart} events={events} now={now} />;
}
