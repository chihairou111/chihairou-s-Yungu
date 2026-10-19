import { NextResponse } from 'next/server';
import { NOT_FOUND_ASSIGNMENT, parseId, requireSession } from '@/lib/api-auth';
import { data } from '@/lib/data';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; commentId: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id: rawId, commentId } = await params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 400 });
  const detail = await data.getAssignmentDetail(id);
  if (!detail) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 404 });
  if (!detail.comments.some((c) => c.id === commentId && c.mine)) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }
  await data.deleteComment(id, commentId);
  return NextResponse.json({ ok: true });
}
