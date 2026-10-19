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
import { MAX_COMMENT } from '@/lib/limits';

describe('POST comments', () => {
  it('401s without a session', async () => {
    signedOut();
    const res = await POST(json({ text: 'hi' }, 'POST'), ctx({ id: '101' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(SIGN_IN);
  });
  it('400s on blank text', async () => {
    const res = await POST(json({ text: '   ' }, 'POST'), ctx({ id: '101' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Write a comment first.' });
  });
  it('404s on an unknown assignment', async () => {
    const res = await POST(json({ text: 'hi' }, 'POST'), ctx({ id: '999999' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Assignment not found' });
  });
  it('400s on a comment over 2,000 characters, the same limit the form has', async () => {
    expect(MAX_COMMENT).toBe(2000);
    const res = await POST(json({ text: 'x'.repeat(MAX_COMMENT + 1) }, 'POST'), ctx({ id: '103' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Comments up to 2,000 characters.' });
    const atLimit = await POST(json({ text: 'x'.repeat(MAX_COMMENT) }, 'POST'), ctx({ id: '103' }));
    expect(atLimit.status).toBe(200);
  });
  it('adds a trimmed comment', async () => {
    const res = await POST(json({ text: ' hello ' }, 'POST'), ctx({ id: '103' }));
    expect(res.status).toBe(200);
    const c = await res.json();
    expect(c).toMatchObject({ text: 'hello', mine: true });
  });
});
