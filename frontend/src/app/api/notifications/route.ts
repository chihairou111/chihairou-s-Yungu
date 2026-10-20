import { NextResponse } from 'next/server';
import { requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

const BAD_REQUEST = 'Bad request.';

/** `?read=true|false&page=N` (N from 1, default 1): one page of notifications, `{ items, hasMore }`. */
export const GET = withServiceErrors(async (request: Request) => {
  const denied = await requireSession();
  if (denied) return denied;
  const query = new URL(request.url).searchParams;
  const read = query.get('read');
  const page = query.get('page') ?? '1';
  if ((read !== 'true' && read !== 'false') || !/^[1-9]\d{0,5}$/.test(page)) {
    return NextResponse.json({ error: BAD_REQUEST }, { status: 400 });
  }
  return NextResponse.json(await data.getNotifications(read === 'true', Number(page)));
});
