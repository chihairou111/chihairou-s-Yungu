import { io } from 'next/cache';
import AssignmentsView from '@/components/AssignmentsView';
import ServiceUnavailable from '@/components/ServiceUnavailable';
import { YunguUnavailable, data } from '@/lib/data';
import { loadPageData } from '@/lib/page-data';

/** Reads the clock once per request (kept out of the static shell) so every card agrees on `now`. */
async function loadAssignments() {
  await io();
  const now = Date.now();
  const [todo, submitted] = await Promise.all([data.getTodo(), data.getSubmitted()]);
  return { now, todo, submitted };
}

export default async function AssignmentsPage() {
  const loaded = await loadPageData(loadAssignments);
  if (loaded instanceof YunguUnavailable) return <ServiceUnavailable message={loaded.message} />;
  const { now, todo, submitted } = loaded;
  return <AssignmentsView todo={todo} submitted={submitted} now={now} />;
}
