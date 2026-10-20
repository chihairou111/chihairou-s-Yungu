import { NextResponse } from 'next/server';
import { readCapped, requireSession, withServiceErrors } from '@/lib/api-auth';
import { data } from '@/lib/data';

const MAX_BYTES = 50 * 1024 * 1024;
/** Room for the multipart boundaries and part headers around a file of the largest allowed size. */
const MULTIPART_SLACK = 64 * 1024;
const TOO_LARGE = 'Files up to 50 MB.';

/** A plain `type/subtype` with any `;parameters` dropped, or octet-stream when it is not one. */
function baseMime(type: string): string {
  const base = type.split(';')[0].trim();
  return /^[A-Za-z0-9]+\/[A-Za-z0-9+.-]+$/.test(base) ? base : 'application/octet-stream';
}

export const POST = withServiceErrors(async (request: Request) => {
  const denied = await requireSession();
  if (denied) return denied;
  const limit = MAX_BYTES + MULTIPART_SLACK;
  // Refuse a declared oversized body without reading it; any other body is read only up to the limit.
  if (Number(request.headers.get('content-length') ?? 0) > limit) {
    return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  }
  const body = await readCapped(request, limit);
  if (!body) return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  let file: FormDataEntryValue | null;
  try {
    const parsed = new Response(body as BodyInit, { headers: { 'content-type': request.headers.get('content-type') ?? '' } });
    file = (await parsed.formData()).get('file');
  } catch {
    file = null;
  }
  if (typeof file === 'string' || file === null) return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  return NextResponse.json(await data.uploadFile(file.name, baseMime(file.type), bytes));
});
