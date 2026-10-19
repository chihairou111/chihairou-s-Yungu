import { NextResponse } from 'next/server';
import { readJson, requireSession } from '@/lib/api-auth';
import { data } from '@/lib/data';
import { renderPdf } from '@/lib/pdf';
import { sanitizeEditorHtml } from '@/lib/sanitize';

/** The editor's html, in UTF-8 bytes (Chinese text is three bytes a character). */
const MAX_HTML_BYTES = 1024 * 1024;
/** The whole JSON body, refused from its Content-Length before it is read. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TOO_LONG = 'That document is too long.';

/** Characters that are unsafe or awkward in a filename. */
const fileSafe = (title: string) => title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 100);

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: TOO_LONG }, { status: 413 });
  }
  const body = await readJson(request);
  const rawHtml = typeof body.html === 'string' ? body.html : '';
  if (new TextEncoder().encode(rawHtml).byteLength > MAX_HTML_BYTES) return NextResponse.json({ error: TOO_LONG }, { status: 413 });
  const html = sanitizeEditorHtml(rawHtml);
  if (html.replace(/<[^>]*>|&nbsp;|\s/g, '') === '') return NextResponse.json({ error: 'Nothing to export yet.' }, { status: 400 });
  const title = fileSafe(typeof body.title === 'string' ? body.title : '') || 'Writing';
  try {
    const bytes = await renderPdf(title, html);
    return NextResponse.json(await data.uploadFile(`${title}.pdf`, 'application/pdf', bytes));
  } catch (error) {
    console.error('render-pdf: rendering failed', error);
    return NextResponse.json({ error: 'Could not create the PDF. Try again.' }, { status: 500 });
  }
}
