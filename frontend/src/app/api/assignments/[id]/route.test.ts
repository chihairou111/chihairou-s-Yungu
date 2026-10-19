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
import { SessionEnded, YunguUnavailable, data } from '@/lib/data';

describe('GET /api/assignments/[id]', () => {
  it('401s without a session', async () => {
    signedOut();
    const res = await GET(new Request('http://localhost/x'), ctx({ id: '101' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(SIGN_IN);
  });
  it('returns the detail', async () => {
    const res = await GET(new Request('http://localhost/x'), ctx({ id: '102' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attachments).toHaveLength(4);
    expect(body.submittedFileIds).toEqual([]);
  });
  it('404s for an unknown id', async () => {
    const res = await GET(new Request('http://localhost/x'), ctx({ id: '999999' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Assignment not found' });
  });
  it('400s for a non-numeric id', async () => {
    const res = await GET(new Request('http://localhost/x'), ctx({ id: 'abc' }));
    expect(res.status).toBe(400);
  });
  it("502s with the service's message when Yungu is down", async () => {
    const spy = vi.spyOn(data, 'getAssignmentDetail').mockRejectedValueOnce(new YunguUnavailable());
    const res = await GET(new Request('http://localhost/x'), ctx({ id: '101' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Can't reach Yungu right now. Try again." });
    spy.mockRestore();
  });
  it('401s with the service message, clears the session and leaves the notice for the sign-in page', async () => {
    const spy = vi.spyOn(data, 'getAssignmentDetail').mockRejectedValueOnce(new SessionEnded('Sign in again — your Yungu password may have changed.'));
    const res = await GET(new Request('http://localhost/x'), ctx({ id: '101' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Sign in again — your Yungu password may have changed.' });
    const cookies = res.headers.getSetCookie();
    expect(cookies.find((c) => c.startsWith('yl_session='))).toMatch(/Max-Age=0/);
    expect(cookies.find((c) => c.startsWith('yl_signin_notice='))).toMatch(/^yl_signin_notice=password;/);
    spy.mockRestore();
  });
});
