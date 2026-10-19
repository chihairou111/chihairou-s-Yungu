import type { Metadata } from 'next';
import { io } from 'next/cache';
import AssignmentsView from '@/components/AssignmentsView';
import { data } from '@/lib/data';

export const metadata: Metadata = { title: 'Assignments' };

/** Reads the clock once per request (kept out of the static shell) so every card agrees on `now`. */
async function loadAssignments() {
  await io();
  const now = Date.now();
  const [todo, submitted] = await Promise.all([data.getTodo(), data.getSubmitted()]);
  return { now, todo, submitted };
}

export default async function AssignmentsPage() {
  const { now, todo, submitted } = await loadAssignments();
  return <AssignmentsView todo={todo} submitted={submitted} now={now} />;
}
