import { beforeEach, describe, expect, it, vi } from 'vitest';
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
import { data } from '@/lib/data';

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
