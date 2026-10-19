import { NextResponse } from 'next/server';
import { readJson, requireSession } from '@/lib/api-auth';
import { data } from '@/lib/data';
import { renderPdf } from '@/lib/pdf';
import { sanitizeEditorHtml } from '@/lib/sanitize';

const MAX_HTML_CHARS = 1024 * 1024;

/** Characters that are unsafe or awkward in a filename. */
const fileSafe = (title: string) => title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 100);

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const body = await readJson(request);
  const rawHtml = typeof body.html === 'string' ? body.html : '';
  if (rawHtml.length > MAX_HTML_CHARS) return NextResponse.json({ error: 'That document is too long.' }, { status: 413 });
  const html = sanitizeEditorHtml(rawHtml);
  if (html.replace(/<[^>]*>|&nbsp;|\s/g, '') === '') return NextResponse.json({ error: 'Nothing to export yet.' }, { status: 400 });
  const title = fileSafe(typeof body.title === 'string' ? body.title : '') || 'Writing';
  try {
    const bytes = await renderPdf(title, html);
    return NextResponse.json(await data.uploadFile(`${title}.pdf`, 'application/pdf', bytes));
  } catch {
    return NextResponse.json({ error: 'Could not create the PDF. Try again.' }, { status: 500 });
  }
}
