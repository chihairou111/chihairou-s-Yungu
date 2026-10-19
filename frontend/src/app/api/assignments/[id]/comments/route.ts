import { NextResponse } from 'next/server';
import { NOT_FOUND_ASSIGNMENT, parseId, readJson, requireSession } from '@/lib/api-auth';
import { data } from '@/lib/data';
import { COMMENT_TOO_LONG, MAX_COMMENT } from '@/lib/limits';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 400 });
  const { text } = await readJson(request);
  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'Write a comment first.' }, { status: 400 });
  }
  if (text.trim().length > MAX_COMMENT) return NextResponse.json({ error: COMMENT_TOO_LONG }, { status: 400 });
  if (!(await data.getAssignmentDetail(id))) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 404 });
  return NextResponse.json(await data.addComment(id, text.trim()));
}
