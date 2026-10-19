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
    expect((await res.json()).attachments).toHaveLength(4);
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
});
