import { NextResponse } from 'next/server';
import { NOT_FOUND_ASSIGNMENT, parseId, readJson, requireSession, toFileIds, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

export const POST = withServiceErrors(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireSession();
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 400 });
  const fileIds = toFileIds((await readJson(request)).fileIds);
  if (!fileIds) return NextResponse.json({ error: 'Add at least one file.' }, { status: 400 });
  // An empty list is Mark as submitted: the data layer decides whether it is allowed (400 when it is not).
  return NextResponse.json(await data.submit(id, fileIds));
});
