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

import { POST } from './route';
import { AssignmentNotFound, YunguUnavailable, data } from '@/lib/data';

describe('POST submit', () => {
  it('401s without a session', async () => {
    signedOut();
    const res = await POST(json({ fileIds: ['a'] }, 'POST'), ctx({ id: '101' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(SIGN_IN);
  });
  it('400s with no files', async () => {
    const res = await POST(json({ fileIds: [] }, 'POST'), ctx({ id: '101' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Add at least one file.' });
  });
  it('404s on an unknown assignment', async () => {
    const res = await POST(json({ fileIds: ['a'] }, 'POST'), ctx({ id: '999999' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Assignment not found' });
  });
  it('submits and returns submittedAt', async () => {
    const f = await data.uploadFile('a.txt', 'text/plain', new Uint8Array([1]));
    const res = await POST(json({ fileIds: [f.id] }, 'POST'), ctx({ id: '101' }));
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).submittedAt).toBe('number');
    expect((await data.getAssignmentDetail(101))?.submitted).toBe(true);
  });
  it('passes service failures on: 502, and 404 for an id the service does not know', async () => {
    const f = await data.uploadFile('a.txt', 'text/plain', new Uint8Array([1]));
    const spy = vi.spyOn(data, 'submit').mockRejectedValueOnce(new YunguUnavailable()).mockRejectedValueOnce(new AssignmentNotFound());
    const down = await POST(json({ fileIds: [f.id] }, 'POST'), ctx({ id: '101' }));
    expect(down.status).toBe(502);
    expect(await down.json()).toEqual({ error: "Can't reach Yungu right now. Try again." });
    const gone = await POST(json({ fileIds: [f.id] }, 'POST'), ctx({ id: '101' }));
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: 'Assignment not found' });
    spy.mockRestore();
  });
  it('submits without loading the assignment detail first (the data layer knows unknown ids)', async () => {
    const f = await data.uploadFile('a.txt', 'text/plain', new Uint8Array([1]));
    const spy = vi.spyOn(data, 'getAssignmentDetail');
    try {
      expect((await POST(json({ fileIds: [f.id] }, 'POST'), ctx({ id: '101' }))).status).toBe(200);
      expect((await POST(json({ fileIds: [f.id] }, 'POST'), ctx({ id: '999999' }))).status).toBe(404);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
