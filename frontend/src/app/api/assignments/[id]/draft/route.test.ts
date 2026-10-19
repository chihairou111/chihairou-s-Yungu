import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { resetMockStore } from '@/lib/data/store';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
const signedIn = () => vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });
const signedOut = () => vi.mocked(getSession).mockResolvedValue(null);
const SIGN_IN = { error: 'Sign in again.' };
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const json = (body: unknown, method: string) =>
  new Request('http://localhost/x', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  resetMockStore();
  signedIn();
});

import { PUT } from './route';
import { data } from '@/lib/data';

describe('PUT draft', () => {
  it('401s without a session', async () => {
    signedOut();
    const res = await PUT(json({ fileIds: [] }, 'PUT'), ctx({ id: '101' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(SIGN_IN);
  });
  it('saves the draft file list', async () => {
    const f = await data.uploadFile('a.txt', 'text/plain', new Uint8Array([1]));
    const res = await PUT(json({ fileIds: [f.id] }, 'PUT'), ctx({ id: '101' }));
    expect(res.status).toBe(200);
    expect((await data.getAssignmentDetail(101))?.myFiles.map((x) => x.id)).toEqual([f.id]);
  });
  it('400s on a malformed body, 404s on an unknown assignment', async () => {
    expect((await PUT(json({ fileIds: 'x' }, 'PUT'), ctx({ id: '101' }))).status).toBe(400);
    expect((await PUT(json({ fileIds: [] }, 'PUT'), ctx({ id: 'abc' }))).status).toBe(400);
    const res = await PUT(json({ fileIds: [] }, 'PUT'), ctx({ id: '999999' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Assignment not found' });
  });
});
