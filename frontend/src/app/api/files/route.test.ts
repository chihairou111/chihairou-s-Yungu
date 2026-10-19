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

const upload = (file: File | null) => {
  const form = new FormData();
  if (file) form.set('file', file);
  return new Request('http://localhost/api/files', { method: 'POST', body: form });
};

describe('POST /api/files', () => {
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
  it('keeps a Chinese file name', async () => {
    const res = await POST(upload(new File(['hello'], '作业.txt', { type: 'text/plain' })));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: '作业.txt', mime: 'text/plain', size: 5 });
  });
});
