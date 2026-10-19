import { NextResponse } from 'next/server';
import { requireSession, withServiceErrors } from '@/lib/api-auth';
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

/**
 * The request body, read until it passes `limit` bytes: null then (and the rest is never read). Holds
 * a body without a Content-Length, or with one that understates it, to the same limit as a declared one.
 */
async function readCapped(request: Request, limit: number): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
