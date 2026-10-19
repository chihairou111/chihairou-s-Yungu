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
});
