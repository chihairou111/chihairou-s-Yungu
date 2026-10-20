import { NextResponse } from 'next/server';
import { requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

/** The app bar's notification dot: `{ unread }`. */
export const GET = withServiceErrors(async () => {
  const denied = await requireSession();
  if (denied) return denied;
  return NextResponse.json({ unread: await data.getUnreadCount() });
});
