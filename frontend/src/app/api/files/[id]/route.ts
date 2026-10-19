import { NextResponse } from 'next/server';
import { requireSession, withServiceErrors } from '@/lib/api-auth';
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

export const GET = withServiceErrors(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireSession();
  if (denied) return denied;
  const preview = new URL(request.url).searchParams.get('preview') === '1';
  const file = await data.getFile((await params).id, { preview });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  if ('redirect' in file) {
    // The real service hands back a short-lived signed OSS link; the browser fetches (and ranges) from there.
    return new Response(null, {
      status: 302,
      headers: { Location: file.redirect, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' },
    });
  }
  const baseType = file.ref.mime.split(';')[0].trim().toLowerCase();
  const active = ACTIVE_TYPES.has(baseType);
  const disposition = active || new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline';
  // Chrome will not show a PDF in its viewer under a sandbox CSP, and passive media cannot run script.
  const passive = !active && /^(application\/pdf$|image\/|video\/|audio\/)/.test(baseType);
  const headers: Record<string, string> = {
    ...(passive ? {} : { 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox" }),
    'Content-Type': active ? 'application/octet-stream' : file.ref.mime,
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(file.ref.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
  };
  const size = file.bytes.length;
  const range = parseRange(request.headers.get('range'), size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  }
  if (range) {
    const [start, end] = range;
    return new Response(file.bytes.slice(start, end + 1) as BodyInit, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(file.bytes as BodyInit, { headers: { ...headers, 'Content-Length': String(size) } });
});

/**
 * A single `bytes=` range (`start-end`, `start-`, `-suffix`) clamped to the file, as inclusive offsets.
 * `null` serves the whole file (no header, or one this route does not honour, such as several ranges or
 * another unit, which RFC 9110 lets a server ignore); `'unsatisfiable'` answers 416.
 */
function parseRange(header: string | null, size: number): [number, number] | 'unsatisfiable' | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match) return null;
  const [, first, last] = match;
  if (first === '' && last === '') return null;
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return [Math.max(0, size - suffix), size - 1];
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (last !== '' && Number(last) < start) return null; // malformed: ignore, serve everything
  if (start >= size) return 'unsatisfiable';
  return [start, end];
}
