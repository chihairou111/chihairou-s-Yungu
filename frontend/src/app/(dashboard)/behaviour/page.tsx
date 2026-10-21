import { io } from 'next/cache';
import BehaviourView from '@/components/BehaviourView';
import ServiceUnavailable from '@/components/ServiceUnavailable';
import { YunguUnavailable, data } from '@/lib/data';
import { parseMonthParam } from '@/lib/behaviour';
import { loadPageData } from '@/lib/page-data';

/** Reads the clock once per request, so "this month" and the month shown agree. */
async function loadMonth(monthParam: string | undefined) {
  await io();
  const now = Date.now();
  // Kept to the months the page steps through (never the future), so the service never answers a 400.
  const behaviour = await data.getBehaviour(parseMonthParam(monthParam, now));
  return { now, behaviour };
}

export default async function BehaviourPage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const { month } = await searchParams;
  const loaded = await loadPageData(() => loadMonth(typeof month === 'string' ? month : undefined));
  if (loaded instanceof YunguUnavailable) return <ServiceUnavailable message={loaded.message} />;
  return <BehaviourView behaviour={loaded.behaviour} now={loaded.now} />;
}
