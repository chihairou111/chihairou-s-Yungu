import { NextResponse } from 'next/server';
import { readJson, requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Agent access: this account's personal tokens and connected agents (never a token), uncached. */
export const GET = withServiceErrors(async () => {
  const denied = await requireSession();
  if (denied) return denied;
  return NextResponse.json(await data.getAgentAccess(), { headers: NO_STORE });
});

/** A new personal token: the answer is the only place its secret ever appears, so it is never cached. */
export const POST = withServiceErrors(async (request: Request) => {
  const denied = await requireSession();
  if (denied) return denied;
  const { name } = await readJson(request);
  // The service trims the name and says what is wrong with it.
  const created = await data.createAgentToken(typeof name === 'string' ? name : '');
  return NextResponse.json(created, { status: 201, headers: NO_STORE });
});
