import { NextResponse } from 'next/server';
import { NOT_FOUND_ASSIGNMENT, parseId, requireSession } from '@/lib/api-auth';
import { data } from '@/lib/data';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 400 });
  const detail = await data.getAssignmentDetail(id);
  if (!detail) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 404 });
  return NextResponse.json(detail);
}
