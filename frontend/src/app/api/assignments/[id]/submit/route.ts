import { NextResponse } from 'next/server';
import { NOT_FOUND_ASSIGNMENT, parseId, readJson, requireSession, toFileIds } from '@/lib/api-auth';
import { data } from '@/lib/data';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 400 });
  const fileIds = toFileIds((await readJson(request)).fileIds);
  if (!fileIds || fileIds.length === 0) return NextResponse.json({ error: 'Add at least one file.' }, { status: 400 });
  if (!(await data.getAssignmentDetail(id))) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 404 });
  return NextResponse.json(await data.submit(id, fileIds));
}
