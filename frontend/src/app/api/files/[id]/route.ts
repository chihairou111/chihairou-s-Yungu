import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/api-auth';
import { data } from '@/lib/data';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const file = await data.getFile((await params).id);
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  const disposition = new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline';
  return new Response(file.bytes as BodyInit, {
    headers: {
      'Content-Type': file.ref.mime,
      'Content-Length': String(file.bytes.length),
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.ref.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    },
  });
}
