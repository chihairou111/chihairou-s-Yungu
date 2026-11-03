// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { resetMockStore } from '@/lib/data/store';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
const signedIn = () => vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });
const signedOut = () => vi.mocked(getSession).mockResolvedValue(null);
const SIGN_IN = { error: 'Sign in again.' };

beforeEach(() => {
  resetMockStore();
  signedIn();
});

import { POST } from './route';
import { ServiceError, data } from '@/lib/data';

/** What a browser sends with the dashboard's own upload (a same-origin fetch). */
const OWN = { host: 'localhost', origin: 'http://localhost', 'sec-fetch-site': 'same-origin' };

const upload = (file: File | null, headers: Record<string, string> = OWN) => {
  const form = new FormData();
  if (file) form.set('file', file);
  return new Request('http://localhost/api/files', { method: 'POST', body: form, headers });
};

describe('POST /api/files', () => {
  it.each([
    ['another origin', { ...OWN, origin: 'https://evil.example' }],
    ['a cross-site fetch', { ...OWN, 'sec-fetch-site': 'cross-site' }],
    ['a browser that does not vouch for it (no Sec-Fetch-Site)', { host: 'localhost', origin: 'http://localhost' }],
    ['no Origin', { host: 'localhost', 'sec-fetch-site': 'same-origin' }],
  ])('refuses a multipart post from %s before reading anything', async (_case, headers) => {
    const spy = vi.spyOn(data, 'uploadFile');
    const res = await POST(upload(new File(['x'], 'a.txt'), headers));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden.' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('refuses a text/plain post', async () => {
    const res = await POST(new Request('http://localhost/api/files', { method: 'POST', headers: { ...OWN, 'content-type': 'text/plain' }, body: 'x' }));
    expect(res.status).toBe(403);
  });

  it('takes a 12 MB file streamed in, byte for byte (past the proxy\'s 10 MB body clone, which this route is outside)', async () => {
    const bytes = new Uint8Array(12 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i += 4096) bytes[i] = (i / 4096) % 251;
    const real = upload(new File([bytes], 'big.bin', { type: 'application/octet-stream' }));
    const raw = new Uint8Array(await real.arrayBuffer());
    // Arrives in 64 KiB pieces, as a socket would deliver it.
    let at = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= raw.length) return controller.close();
        controller.enqueue(raw.slice(at, at + 65536));
        at += 65536;
      },
    });
    const spy = vi.spyOn(data, 'uploadFile');
    const request = new Request('http://localhost/api/files', {
      method: 'POST',
      headers: { ...OWN, 'content-type': real.headers.get('content-type')! },
      body,
      duplex: 'half',
    } as RequestInit);
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'big.bin', size: bytes.length });
    const sent = spy.mock.calls[0][2];
    expect(sent.length).toBe(bytes.length);
    expect(Buffer.compare(Buffer.from(sent), Buffer.from(bytes))).toBe(0);
    spy.mockRestore();
  });

  it('401s without a session', async () => {
    signedOut();
    const res = await POST(upload(new File(['x'], 'a.txt')));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(SIGN_IN);
  });
  it('400s on an empty file', async () => {
    const res = await POST(upload(new File([], 'a.txt')));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'That file is empty.' });
  });
  it('400s when no file is sent', async () => {
    expect((await POST(upload(null))).status).toBe(400);
  });
  it('413s over 50 MB', async () => {
    const res = await POST(upload(new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'big.bin')));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Files up to 50 MB.' });
  });
  it('413s on a declared body over the limit without reading it', async () => {
    const formData = vi.fn();
    const request = { headers: new Headers({ ...OWN, 'content-type': 'multipart/form-data; boundary=b', 'content-length': String(50 * 1024 * 1024 + 64 * 1024 + 1) }), formData } as unknown as Request;
    const res = await POST(request);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Files up to 50 MB.' });
    expect(formData).not.toHaveBeenCalled();
  });
  it('reads a declared body within the multipart slack', async () => {
    const real = upload(new File(['x'], 'a.txt', { type: 'text/plain' }));
    const request = {
      headers: new Headers({ ...OWN, 'content-length': String(50 * 1024 * 1024 + 64 * 1024), 'content-type': real.headers.get('content-type')! }),
      body: real.body,
    } as unknown as Request;
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'a.txt', size: 1 });
  });

  /** A multipart body of about `total` bytes in 1 MiB chunks, counting what the route pulls from it. */
  function streamedBody(total: number) {
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    const head = new TextEncoder().encode('--b\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\n\r\n');
    const seen = { pulled: 0, cancelled: false };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(head);
        seen.pulled += head.length;
      },
      pull(controller) {
        if (seen.pulled >= total) return controller.close();
        controller.enqueue(chunk);
        seen.pulled += chunk.length;
      },
      cancel() {
        seen.cancelled = true;
      },
    });
    return { body, seen };
  }
  const LIMIT = 50 * 1024 * 1024 + 64 * 1024;

  it.each([
    ['without a Content-Length (chunked)', {}],
    ['with a Content-Length that understates it', { 'content-length': '1000' }],
  ])('413s a body over the limit sent %s, without buffering all of it', async (_case, extra) => {
    const { body, seen } = streamedBody(200 * 1024 * 1024);
    const request = { headers: new Headers({ ...OWN, 'content-type': 'multipart/form-data; boundary=b', ...extra }), body } as unknown as Request;
    const res = await POST(request);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Files up to 50 MB.' });
    // Stopped within one chunk past the limit (plus the stream's own read-ahead), not at 200 MiB.
    expect(seen.pulled).toBeLessThanOrEqual(LIMIT + 3 * 1024 * 1024);
    expect(seen.cancelled).toBe(true);
  });
  it('keeps a Chinese file name', async () => {
    const res = await POST(upload(new File(['hello'], '作业.txt', { type: 'text/plain' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: '作业.txt', mime: 'text/plain', size: 5 });
  });
  it('strips MIME parameters before checking the type', async () => {
    const res = await POST(upload(new File(['x'], 'a.txt', { type: 'text/plain;charset=utf-8' })));
    expect(res.status).toBe(200);
    expect((await res.json()).mime).toBe('text/plain');
    const spaced = await POST(upload(new File(['x'], 'a.csv', { type: 'text/csv ; charset=UTF-8' })));
    expect((await spaced.json()).mime).toBe('text/csv');
  });
  it('stores an invalid MIME type as application/octet-stream', async () => {
    const res = await POST(upload(new File(['x'], 'a.txt', { type: 'text/plain\r\nX: y' })));
    expect(res.status).toBe(200);
    expect((await res.json()).mime).toBe('application/octet-stream');
  });
  it("passes the service's 413 through, with the name sent verbatim", async () => {
    const spy = vi.spyOn(data, 'uploadFile').mockRejectedValueOnce(new ServiceError(413, 'Files up to 50 MB.'));
    const res = await POST(upload(new File(['hello'], '作业 一（终稿）.pdf', { type: 'application/pdf' })));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Files up to 50 MB.' });
    expect(spy).toHaveBeenCalledWith('作业 一（终稿）.pdf', 'application/pdf', new TextEncoder().encode('hello'));
    spy.mockRestore();
  });
});
