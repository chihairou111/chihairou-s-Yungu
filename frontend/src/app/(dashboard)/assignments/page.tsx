import type { Metadata } from 'next';
import { io } from 'next/cache';
import AssignmentsView from '@/components/AssignmentsView';
import { data } from '@/lib/data';
import { dayIndex, weekStartOf } from '@/lib/time';

export const metadata: Metadata = { title: 'Assignments' };

/** Reads the clock once per request (kept out of the static shell) so every card agrees on `now`. */
async function loadAssignments() {
  await io();
  const now = Date.now();
  const weekStart = weekStartOf(now);
  const [todo, submitted, week] = await Promise.all([data.getTodo(), data.getSubmitted(), data.getWeek(weekStart)]);
  const today = dayIndex(now, weekStart);
  const todayClasses = week.filter((e) => e.isClass && dayIndex(e.start, weekStart) === today);
  return { now, todo, submitted, todayClasses };
}

export default async function AssignmentsPage() {
  const { now, todo, submitted, todayClasses } = await loadAssignments();
  return <AssignmentsView todo={todo} submitted={submitted} todayClasses={todayClasses} now={now} />;
}
