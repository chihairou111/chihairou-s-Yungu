import { NextResponse } from 'next/server';
import { NOT_FOUND_ASSIGNMENT, parseId, readOnlineDoc, requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

/**
 * Saves an online document in place, `{ title, content }`, and answers with its FileRef. A document
 * that was handed in is refused with the data layer's 409 (save it as a new one); the other refusals
 * pass through as for creating one.
 */
export const PUT = withServiceErrors(async (request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) => {
  const denied = await requireSession();
  if (denied) return denied;
  const { id: rawId, fileId } = await params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 400 });
  const doc = await readOnlineDoc(request);
  if (doc instanceof Response) return doc;
  return NextResponse.json(await data.updateOnlineDoc(id, fileId, doc.title, doc.content));
});
