// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { resetMockStore } from '@/lib/data/store';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
const signedIn = () => vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });
const signedOut = () => vi.mocked(getSession).mockResolvedValue(null);
const SIGN_IN = { error: 'Sign in again.' };
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const post = (body: unknown) =>
  new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(() => {
  resetMockStore();
  signedIn();
});

import { POST } from './route';
import { DocumentTooLong, ServiceError, YunguUnavailable, data } from '@/lib/data';

const DELTA = '{"ops":[{"insert":"研究 \\"quoted\\"\\n"}]}';
/** The abuse guard on the raw body: four times Yungu's limit plus 64 KiB. */
const BODY_LIMIT = 4 * 65_535 + 64 * 1024;

describe('POST online document', () => {
  it('401s without a session, before reading anything', async () => {
    signedOut();
    const spy = vi.spyOn(data, 'createOnlineDoc');
    const res = await POST(post({ title: 'T', content: DELTA }), ctx({ id: '103' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(SIGN_IN);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('400s on an id that is not a number', async () => {
    const res = await POST(post({ title: 'T', content: DELTA }), ctx({ id: 'abc' }));
    expect(res.status).toBe(400);
  });

  it.each([
    ['no title', { content: DELTA }],
    ['a numeric title', { title: 1, content: DELTA }],
    ['no content', { title: 'T' }],
    ['object content', { title: 'T', content: { ops: [] } }],
    ['an array body', [1]],
    ['a body that is not JSON', 'not json'],
  ])('400s "Bad request." on %s without calling the data layer', async (_case, body) => {
    const spy = vi.spyOn(data, 'createOnlineDoc');
    const res = await POST(post(body), ctx({ id: '103' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Bad request.' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('creates the document with the title and content verbatim and returns its FileRef', async () => {
    const spy = vi.spyOn(data, 'createOnlineDoc');
    const res = await POST(post({ title: ' 研究 ', content: DELTA }), ctx({ id: '103' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: '研究', online: true, content: DELTA, url: expect.stringMatching(/^\/api\/files\//) });
    expect(spy).toHaveBeenCalledWith(103, ' 研究 ', DELTA);
    spy.mockRestore();
  });

  it("passes the data layer's 400 and 413 through with their messages (one message, not the route's own)", async () => {
    const blank = await POST(post({ title: '  ', content: DELTA }), ctx({ id: '103' }));
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: 'Give the document a title.' });
    const long = await POST(post({ title: 'T', content: '研'.repeat(22_000) }), ctx({ id: '103' }));
    expect(long.status).toBe(413);
    expect(await long.json()).toEqual({ error: 'Too long for Yungu — cut about 155 characters.' });
  });

  it("lets content at Yungu's limit through even when JSON escaping doubles it", async () => {
    // 65 535 bytes of quotes: about 131 kB on the wire.
    const res = await POST(post({ title: 'T', content: '"'.repeat(65_535) }), ctx({ id: '103' }));
    expect(res.status).toBe(200);
  });

  it('passes service failures through: 502 with its message, other statuses as they are', async () => {
    const spy = vi
      .spyOn(data, 'createOnlineDoc')
      .mockRejectedValueOnce(new YunguUnavailable("Yungu couldn't save the document. Try again."))
      .mockRejectedValueOnce(new DocumentTooLong('Too long for Yungu — cut about 2 characters.'))
      .mockRejectedValueOnce(new ServiceError(400, 'Give the document a title.'));
    const down = await POST(post({ title: 'T', content: DELTA }), ctx({ id: '103' }));
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ error: "Yungu couldn't save the document. Try again." });
    const long = await POST(post({ title: 'T', content: DELTA }), ctx({ id: '103' }));
    expect(long.status).toBe(413);
    expect(await long.json()).toEqual({ error: 'Too long for Yungu — cut about 2 characters.' });
    const blank = await POST(post({ title: 'T', content: DELTA }), ctx({ id: '103' }));
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: 'Give the document a title.' });
    spy.mockRestore();
  });

  it('413s a declared body over the abuse limit without reading it', async () => {
    const json = vi.fn();
    const request = { headers: new Headers({ 'content-length': String(BODY_LIMIT + 1) }), json, body: null } as unknown as Request;
    const res = await POST(request, ctx({ id: '103' }));
    expect(res.status).toBe(413);
    expect(json).not.toHaveBeenCalled();
  });

  it('413s a streamed body over the abuse limit, stopping early', async () => {
    const seen = { pulled: 0, cancelled: false };
    const chunk = new Uint8Array(64 * 1024).fill(97);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (seen.pulled >= 10 * 1024 * 1024) return controller.close();
        controller.enqueue(chunk);
        seen.pulled += chunk.length;
      },
      cancel() {
        seen.cancelled = true;
      },
    });
    const spy = vi.spyOn(data, 'createOnlineDoc');
    const request = { headers: new Headers({ 'content-type': 'application/json', 'content-length': '10' }), body } as unknown as Request;
    const res = await POST(request, ctx({ id: '103' }));
    expect(res.status).toBe(413);
    expect(seen.cancelled).toBe(true);
    expect(seen.pulled).toBeLessThanOrEqual(BODY_LIMIT + 4 * chunk.length);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
