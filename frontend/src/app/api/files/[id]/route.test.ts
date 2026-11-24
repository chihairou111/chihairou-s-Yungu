import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { resetMockStore } from '@/lib/data/store';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
const signedIn = () => vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });
const signedOut = () => vi.mocked(getSession).mockResolvedValue(null);
const SIGN_IN = { error: 'Sign in again.' };
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  resetMockStore();
  signedIn();
});

import { GET } from './route';
import { YunguUnavailable, data } from '@/lib/data';

describe('GET /api/files/[id]', () => {
  it('401s without a session', async () => {
    signedOut();
    const res = await GET(new Request('http://localhost/x'), ctx({ id: 'a' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(SIGN_IN);
  });
  it('404s for an unknown file', async () => {
    const res = await GET(new Request('http://localhost/x'), ctx({ id: 'nope' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'File not found' });
  });
  it('serves bytes inline with type and UTF-8 filename', async () => {
    const f = await data.uploadFile('作业.txt', 'text/plain', new TextEncoder().encode('hello'));
    const res = await GET(new Request('http://localhost/x'), ctx({ id: f.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain');
    expect(res.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''" + encodeURIComponent('作业.txt'));
    expect(await res.text()).toBe('hello');
  });
  it('?download=1 forces an attachment', async () => {
    const f = await data.uploadFile('a.txt', 'text/plain', new Uint8Array([1]));
    const res = await GET(new Request('http://localhost/x?download=1'), ctx({ id: f.id }));
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename\*=UTF-8/);
  });
  it('serves an html upload as a sandboxed octet-stream attachment', async () => {
    const f = await data.uploadFile('x.html', 'text/html', new TextEncoder().encode('<script>1</script>'));
    const res = await GET(new Request('http://localhost/x'), ctx({ id: f.id }));
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
  });
  it('still serves a pdf inline with nosniff', async () => {
    const f = await data.uploadFile('a.pdf', 'application/pdf', new Uint8Array([1]));
    const res = await GET(new Request('http://localhost/x'), ctx({ id: f.id }));
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBeNull();
  });
  it('sandboxes text/plain', async () => {
    const f = await data.uploadFile('a.txt', 'text/plain', new Uint8Array([1]));
    const res = await GET(new Request('http://localhost/x'), ctx({ id: f.id }));
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  describe('a file the service hands back as a signed link', () => {
    const SIGNED = 'https://yungu-common.oss-cn-hangzhou.aliyuncs.com/taskFile/1_a.pdf?Expires=1&OSSAccessKeyId=k&Signature=s';
    const ref = { id: '11128597', name: 'a.pdf', kind: 'pdf' as const, mime: 'application/pdf', size: 9, url: '/api/files/11128597', createdAt: 0 };

    it('302s to the signed link, with nosniff and no caching, ranges left to the store', async () => {
      const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
      try {
        const res = await GET(new Request('http://localhost/x', { headers: { range: 'bytes=0-1' } }), ctx({ id: ref.id }));
        expect(spy).toHaveBeenCalledWith('11128597', { preview: false });
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe(SIGNED);
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(res.headers.get('cache-control')).toBe('private, no-store');
        expect(await res.text()).toBe('');
      } finally {
        spy.mockRestore();
      }
    });

    it('asks for the preview link with ?preview=1', async () => {
      const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
      try {
        const res = await GET(new Request('http://localhost/x?preview=1'), ctx({ id: ref.id }));
        expect(spy).toHaveBeenCalledWith('11128597', { preview: true });
        expect(res.status).toBe(302);
      } finally {
        spy.mockRestore();
      }
    });

    describe('?view=pdf (the viewer\'s PDF frame): OSS serves every file as multipart/form-data, so Chrome would download it', () => {
      const upstream = (body: string, init: ResponseInit) => vi.fn<typeof fetch>(async () => new Response(body, init));
      afterEach(() => vi.unstubAllGlobals());

      it('streams the signed link back as an inline PDF, keeping the name', async () => {
        const name = 'W6D1-1.8-Guided Notes 讲义.pdf';
        const fetchMock = upstream('%PDF-1.7 body', {
          status: 200,
          headers: {
            'content-type': 'multipart/form-data',
            'content-length': '13',
            // OSS sends the raw UTF-8 bytes; fetch exposes them as latin1 code units.
            'content-disposition': `filename=${Buffer.from(name, 'utf8').toString('latin1')}`,
          },
        });
        vi.stubGlobal('fetch', fetchMock);
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
        try {
          const res = await GET(new Request('http://localhost/x?view=pdf'), ctx({ id: ref.id }));
          expect(spy).toHaveBeenCalledWith('11128597', { preview: false });
          expect(fetchMock).toHaveBeenCalledTimes(1);
          expect(fetchMock.mock.calls[0][0]).toBe(SIGNED);
          expect(res.status).toBe(200);
          expect(res.headers.get('content-type')).toBe('application/pdf');
          expect(res.headers.get('content-disposition')).toBe(`inline; filename*=UTF-8''${encodeURIComponent(name)}`);
          expect(res.headers.get('x-content-type-options')).toBe('nosniff');
          expect(res.headers.get('cache-control')).toBe('private, no-store');
          expect(res.headers.get('accept-ranges')).toBe('bytes');
          expect(res.headers.get('content-length')).toBe('13');
          // Chrome will not show a PDF under a sandbox CSP.
          expect(res.headers.get('content-security-policy')).toBeNull();
          expect(await res.text()).toBe('%PDF-1.7 body');
        } finally {
          spy.mockRestore();
        }
      });

      it("passes the viewer's byte range through and answers 206", async () => {
        const fetchMock = upstream('PDF', { status: 206, headers: { 'content-range': 'bytes 0-2/100', 'content-length': '3' } });
        vi.stubGlobal('fetch', fetchMock);
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
        try {
          const res = await GET(new Request('http://localhost/x?view=pdf', { headers: { range: 'bytes=0-2' } }), ctx({ id: ref.id }));
          const init = fetchMock.mock.calls[0][1] as RequestInit;
          expect(new Headers(init.headers).get('range')).toBe('bytes=0-2');
          expect(res.status).toBe(206);
          expect(res.headers.get('content-range')).toBe('bytes 0-2/100');
          expect(res.headers.get('content-type')).toBe('application/pdf');
          expect(res.headers.get('content-disposition')).toBe('inline');
        } finally {
          spy.mockRestore();
        }
      });

      it('works for the PDF rendition of an Office file (?preview=1&view=pdf)', async () => {
        vi.stubGlobal('fetch', upstream('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }));
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
        try {
          const res = await GET(new Request('http://localhost/x?preview=1&view=pdf'), ctx({ id: ref.id }));
          expect(spy).toHaveBeenCalledWith('11128597', { preview: true });
          expect(res.status).toBe(200);
          expect(res.headers.get('content-type')).toBe('application/pdf');
        } finally {
          spy.mockRestore();
        }
      });

      it("502s with the service's message when the store refuses (an expired link)", async () => {
        vi.stubGlobal('fetch', upstream('<Error/>', { status: 403, headers: { 'content-type': 'application/xml' } }));
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
        try {
          const res = await GET(new Request('http://localhost/x?view=pdf'), ctx({ id: ref.id }));
          expect(res.status).toBe(502);
          expect(await res.json()).toEqual({ error: "Can't reach Yungu right now. Try again." });
        } finally {
          spy.mockRestore();
        }
      });

      it("502s with the file-storage sentence when the OSS fetch throws", async () => {
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new TypeError('fetch failed'); }));
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
        try {
          const res = await GET(new Request('http://localhost/x?view=pdf'), ctx({ id: ref.id }));
          expect(res.status).toBe(502);
          expect(await res.json()).toEqual({ error: "Can't reach Yungu's file storage from this network." });
        } finally {
          spy.mockRestore();
        }
      });

      it("502s with the usual Yungu sentence, not the file-storage one, while Suspension Mode refuses", async () => {
        const suspended = Object.assign(new Error('Suspension Mode'), { name: 'Suspended' });
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw suspended; }));
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
        try {
          const res = await GET(new Request('http://localhost/x?view=pdf'), ctx({ id: ref.id }));
          expect(res.status).toBe(502);
          expect(await res.json()).toEqual({ error: "Can't reach Yungu right now. Try again." });
        } finally {
          spy.mockRestore();
        }
      });

      it('fetches through the desktop shell fetch when it is installed', async () => {
        const shell = upstream('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } });
        const plain = vi.fn<typeof fetch>(async () => { throw new Error('should not be used'); });
        vi.stubGlobal('fetch', plain);
        (globalThis as { __yunguFetch?: typeof fetch }).__yunguFetch = shell;
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
        try {
          const res = await GET(new Request('http://localhost/x?view=pdf'), ctx({ id: ref.id }));
          expect(res.status).toBe(200);
          expect(shell).toHaveBeenCalledTimes(1);
          expect(plain).not.toHaveBeenCalled();
        } finally {
          delete (globalThis as { __yunguFetch?: typeof fetch }).__yunguFetch;
          spy.mockRestore();
        }
      });

      it('502s when the store cannot be reached', async () => {
        vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new TypeError('fetch failed'); }));
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
        try {
          const res = await GET(new Request('http://localhost/x?view=pdf'), ctx({ id: ref.id }));
          expect(res.status).toBe(502);
        } finally {
          spy.mockRestore();
        }
      });

      it('never fetches a link that is not https', async () => {
        const fetchMock = upstream('x', { status: 200 });
        vi.stubGlobal('fetch', fetchMock);
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: 'http://169.254.169.254/latest' });
        try {
          const res = await GET(new Request('http://localhost/x?view=pdf'), ctx({ id: ref.id }));
          expect(fetchMock).not.toHaveBeenCalled();
          expect(res.status).toBe(502);
        } finally {
          spy.mockRestore();
        }
      });

      it('asks OSS for unencoded bytes, refuses redirects, and passes the browser abort on', async () => {
        const fetchMock = upstream('%PDF', { status: 200, headers: { 'content-length': '4' } });
        vi.stubGlobal('fetch', fetchMock);
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
        const browser = new AbortController();
        try {
          const res = await GET(new Request('http://localhost/x?view=pdf', { signal: browser.signal }), ctx({ id: ref.id }));
          expect(res.status).toBe(200);
          const init = fetchMock.mock.calls[0][1] as RequestInit;
          // A redirect could lead anywhere (plain http included); and content-length / content-range are
          // only right for the bytes as stored, so OSS must not compress them on the way.
          expect(init.redirect).toBe('error');
          expect(new Headers(init.headers).get('accept-encoding')).toBe('identity');
          expect(init.signal?.aborted).toBe(false);
          browser.abort();
          expect(init.signal?.aborted).toBe(true);
        } finally {
          spy.mockRestore();
        }
      });

      it('502s when OSS answers with a redirect (fetch refuses to follow it)', async () => {
        const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
          if (init?.redirect === 'error') throw new TypeError('fetch failed: unexpected redirect');
          return new Response('%PDF', { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
        try {
          const res = await GET(new Request('http://localhost/x?view=pdf'), ctx({ id: ref.id }));
          expect(res.status).toBe(502);
          expect(await res.json()).toEqual({ error: "Can't reach Yungu right now. Try again." });
        } finally {
          spy.mockRestore();
        }
      });

      it('502s after 45 s when OSS sends no answer', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const fetchMock = vi.fn<typeof fetch>(
          (_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))),
        );
        vi.stubGlobal('fetch', fetchMock);
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
        try {
          let settled = false;
          const pending = GET(new Request('http://localhost/x?view=pdf'), ctx({ id: ref.id })).finally(() => (settled = true));
          await vi.advanceTimersByTimeAsync(44_999);
          expect(settled).toBe(false);
          await vi.advanceTimersByTimeAsync(1);
          const res = await pending;
          expect(res.status).toBe(502);
          expect(await res.json()).toEqual({ error: "Can't reach Yungu right now. Try again." });
        } finally {
          spy.mockRestore();
          vi.useRealTimers();
        }
      });

      it('leaves a download alone: ?download=1 still redirects', async () => {
        const fetchMock = upstream('x', { status: 200 });
        vi.stubGlobal('fetch', fetchMock);
        const spy = vi.spyOn(data, 'getFile').mockResolvedValueOnce({ redirect: SIGNED });
        try {
          const res = await GET(new Request('http://localhost/x?view=pdf&download=1'), ctx({ id: ref.id }));
          expect(fetchMock).not.toHaveBeenCalled();
          expect(res.status).toBe(302);
        } finally {
          spy.mockRestore();
        }
      });
    });

    it("502s with the service's message when Yungu is down", async () => {
      const spy = vi.spyOn(data, 'getFile').mockRejectedValueOnce(new YunguUnavailable());
      try {
        const res = await GET(new Request('http://localhost/x'), ctx({ id: ref.id }));
        expect(res.status).toBe(502);
        expect(await res.json()).toEqual({ error: "Can't reach Yungu right now. Try again." });
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('byte ranges', () => {
    const upload = () => data.uploadFile('clip.mp4', 'video/mp4', new TextEncoder().encode('0123456789'));
    const get = (id: string, range?: string) =>
      GET(new Request('http://localhost/x', range ? { headers: { range } } : undefined), ctx({ id }));

    it('serves the whole file with 200 and advertises ranges when none is asked for', async () => {
      const f = await upload();
      const res = await get(f.id);
      expect(res.status).toBe(200);
      expect(res.headers.get('accept-ranges')).toBe('bytes');
      expect(res.headers.get('content-length')).toBe('10');
      expect(res.headers.get('content-range')).toBeNull();
      expect(await res.text()).toBe('0123456789');
    });

    it('answers start-end and start- with 206 and the slice', async () => {
      const f = await upload();
      const res = await get(f.id, 'bytes=2-5');
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
      expect(res.headers.get('content-length')).toBe('4');
      expect(await res.text()).toBe('2345');
      const open = await get(f.id, 'bytes=7-');
      expect(open.headers.get('content-range')).toBe('bytes 7-9/10');
      expect(await open.text()).toBe('789');
      const past = await get(f.id, 'bytes=8-99');
      expect(past.headers.get('content-range')).toBe('bytes 8-9/10');
    });

    it('answers a suffix range with the last bytes', async () => {
      const f = await upload();
      const res = await get(f.id, 'bytes=-3');
      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe('bytes 7-9/10');
      expect(await res.text()).toBe('789');
    });

    it('416s a range past the end, keeping the security headers', async () => {
      const f = await upload();
      const res = await get(f.id, 'bytes=10-');
      expect(res.status).toBe(416);
      expect(res.headers.get('content-range')).toBe('bytes */10');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
    });

    it('keeps the sandbox on a partial response of an active type', async () => {
      const f = await data.uploadFile('x.html', 'text/html', new TextEncoder().encode('<p>hi</p>'));
      const res = await get(f.id, 'bytes=0-1');
      expect(res.status).toBe(206);
      expect(res.headers.get('content-security-policy')).toContain('sandbox');
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    });

    it('ignores several ranges or other units and serves everything', async () => {
      const f = await upload();
      expect((await get(f.id, 'bytes=0-1,4-5')).status).toBe(200);
      expect((await get(f.id, 'items=0-1')).status).toBe(200);
    });
  });
});
