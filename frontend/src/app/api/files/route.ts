import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/api-auth';
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

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  // Refuse an oversized body before buffering it; a body without a length is still checked after parsing.
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES + MULTIPART_SLACK) {
    return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  }
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    file = null;
  }
  if (typeof file === 'string' || file === null) return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  return NextResponse.json(await data.uploadFile(file.name, baseMime(file.type), bytes));
}
