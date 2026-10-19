import { NextResponse } from 'next/server';
import { NOT_FOUND_ASSIGNMENT, parseId, readJson, requireSession, toFileIds, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

export const PUT = withServiceErrors(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireSession();
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 400 });
  const fileIds = toFileIds((await readJson(request)).fileIds);
  if (!fileIds) return NextResponse.json({ error: 'fileIds must be a list of file ids.' }, { status: 400 });
  await data.saveDraft(id, fileIds);
  return NextResponse.json({ ok: true });
});
