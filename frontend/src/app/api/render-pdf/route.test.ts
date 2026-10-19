// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { resetMockStore } from '@/lib/data/store';
import { renderPdf } from '@/lib/pdf';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/pdf', () => ({ renderPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])) }));
const signedIn = () => vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });

beforeEach(() => {
  resetMockStore();
  signedIn();
  vi.mocked(renderPdf).mockClear();
});

import { POST } from './route';

const post = (body: unknown) =>
  new Request('http://localhost/api/render-pdf', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('POST /api/render-pdf', () => {
  it('401s without a session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await POST(post({ title: 'a', html: '<p>x</p>' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Sign in again.' });
  });
  it.each(['', '   ', '<p> </p>', '<script>x</script>'])('400s on empty html %j', async (html) => {
    const res = await POST(post({ title: 'a', html }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Nothing to export yet.' });
  });
  it('400s on a malformed body', async () => {
    expect((await POST(post('nope'))).status).toBe(400);
  });
  it('413s on html over 1 MB', async () => {
    const res = await POST(post({ title: 'a', html: '<p>' + 'x'.repeat(1024 * 1024) + '</p>' }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'That document is too long.' });
  });
  it('returns a pdf FileRef named after the title and renders sanitised html', async () => {
    const res = await POST(post({ title: '观察记录', html: '<p onclick="x">你好</p><script>bad()</script>' }));
    expect(res.status).toBe(200);
    const ref = await res.json();
    expect(ref.name).toBe('观察记录.pdf');
    expect(ref.kind).toBe('pdf');
    expect(renderPdf).toHaveBeenCalledWith('观察记录', '<p>你好</p>');
  });
  it('sanitises the title for filenames and defaults to Writing', async () => {
    expect((await (await POST(post({ title: 'a/b\\c:d?', html: '<p>x</p>' }))).json()).name).toBe('abcd.pdf');
    expect((await (await POST(post({ html: '<p>x</p>' }))).json()).name).toBe('Writing.pdf');
  });
  it('500s with a readable error when rendering fails', async () => {
    vi.mocked(renderPdf).mockRejectedValueOnce(new Error('boom'));
    const res = await POST(post({ title: 'a', html: '<p>x</p>' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Could not create the PDF. Try again.' });
  });
});
