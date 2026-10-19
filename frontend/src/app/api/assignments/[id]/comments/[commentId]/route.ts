import { NextResponse } from 'next/server';
import { NOT_FOUND_ASSIGNMENT, parseId, requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

export const DELETE = withServiceErrors(async (request: Request, { params }: { params: Promise<{ id: string; commentId: string }> }) => {
  const denied = await requireSession();
  if (denied) return denied;
  const { id: rawId, commentId } = await params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 400 });
  // Unknown assignment → AssignmentNotFound, not the student's comment → CommentNotFound: both 404s.
  await data.deleteComment(id, commentId);
  return NextResponse.json({ ok: true });
});
