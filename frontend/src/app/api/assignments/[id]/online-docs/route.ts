import { NextResponse } from 'next/server';
import { NOT_FOUND_ASSIGNMENT, parseId, readOnlineDoc, requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

/**
 * Saves a new Yungu online document `{ title, content }` (content: Quill delta JSON) and answers with
 * its FileRef. Only the body's shape is checked here; a blank title (400), Yungu's size limit (413) and
 * Yungu's refusals (502) are the data layer's, and their messages reach the browser unchanged.
 */
export const POST = withServiceErrors(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireSession();
  if (denied) return denied;
  const id = parseId((await params).id);
  if (id === null) return NextResponse.json({ error: NOT_FOUND_ASSIGNMENT }, { status: 400 });
  const doc = await readOnlineDoc(request);
  if (doc instanceof Response) return doc;
  return NextResponse.json(await data.createOnlineDoc(id, doc.title, doc.content));
});
