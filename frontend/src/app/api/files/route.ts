import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/api-auth';
import { data } from '@/lib/data';

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get('file');
  } catch {
    file = null;
  }
  if (typeof file === 'string' || file === null) return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Files up to 50 MB.' }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  return NextResponse.json(await data.uploadFile(file.name, file.type || 'application/octet-stream', bytes));
}
