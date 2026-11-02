import { NextResponse } from 'next/server';
import { requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

/** The app bar's Todoist icon and menu: this account's sync status (never the token), uncached. */
export const GET = withServiceErrors(async () => {
  const denied = await requireSession();
  if (denied) return denied;
  return NextResponse.json(await data.getTodoist(), { headers: { 'Cache-Control': 'no-store' } });
});

/** Disconnect: forgets the Todoist token and stops syncing; tasks already in Todoist stay. */
export const DELETE = withServiceErrors(async () => {
  const denied = await requireSession();
  if (denied) return denied;
  await data.disconnectTodoist();
  return new Response(null, { status: 204 });
});
