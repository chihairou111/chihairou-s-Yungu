import type { Metadata } from 'next';
import { io } from 'next/cache';
import AssignmentsView from '@/components/AssignmentsView';
import { data } from '@/lib/data';
import { todaysClasses } from '@/lib/schedule';
import { weekStartOf } from '@/lib/time';

export const metadata: Metadata = { title: 'Assignments' };

/** Reads the clock once per request (kept out of the static shell) so every card agrees on `now`. */
async function loadAssignments() {
  await io();
  const now = Date.now();
  const weekStart = weekStartOf(now);
  const [todo, submitted, week] = await Promise.all([data.getTodo(), data.getSubmitted(), data.getWeek(weekStart)]);
  return { now, todo, submitted, todayClasses: todaysClasses(week, now) };
}

export default async function AssignmentsPage() {
  const { now, todo, submitted, todayClasses } = await loadAssignments();
  return <AssignmentsView todo={todo} submitted={submitted} todayClasses={todayClasses} now={now} />;
}
