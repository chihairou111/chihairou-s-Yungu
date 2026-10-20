import { NextResponse } from 'next/server';
import { requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

/** Marks one notification read on Yungu; 204. Ids are Yungu's numeric messageIds. */
export const POST = withServiceErrors(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  await data.markNotificationRead(id);
  return new Response(null, { status: 204 });
});
