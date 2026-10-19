import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/api-auth';
import { data } from '@/lib/data';

const ACTIVE_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'application/javascript',
  'text/javascript',
]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const file = await data.getFile((await params).id);
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  const baseType = file.ref.mime.split(';')[0].trim().toLowerCase();
  const active = ACTIVE_TYPES.has(baseType);
  const disposition = active || new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline';
  return new Response(file.bytes as BodyInit, {
    headers: {
      'Content-Type': active ? 'application/octet-stream' : file.ref.mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Content-Length': String(file.bytes.length),
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.ref.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    },
  });
}
