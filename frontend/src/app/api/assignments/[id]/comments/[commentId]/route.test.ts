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

import { DELETE } from './route';
import { AssignmentNotFound, data } from '@/lib/data';

const req = () => new Request('http://localhost/x', { method: 'DELETE' });

describe('DELETE comment', () => {
  it('401s without a session', async () => {
    signedOut();
    const res = await DELETE(req(), ctx({ id: '101', commentId: 'c' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(SIGN_IN);
  });
  it('deletes my own comment', async () => {
    const c = await data.addComment(101, 'mine');
    const res = await DELETE(req(), ctx({ id: '101', commentId: c.id }));
    expect(res.status).toBe(200);
    expect((await data.getAssignmentDetail(101))?.comments.some((x) => x.id === c.id)).toBe(false);
  });
  it('404s for a comment that is not mine or does not exist', async () => {
    const theirs = (await data.getAssignmentDetail(101))!.comments.find((x) => !x.mine)!;
    for (const commentId of [theirs.id, 'nope']) {
      const res = await DELETE(req(), ctx({ id: '101', commentId }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Comment not found' });
    }
    expect((await DELETE(req(), ctx({ id: '999999', commentId: 'x' }))).status).toBe(404);
    expect((await DELETE(req(), ctx({ id: 'abc', commentId: 'x' }))).status).toBe(400);
  });
  it('404s like an unknown assignment when the service no longer knows the id', async () => {
    const c = await data.addComment(101, 'mine');
    const spy = vi.spyOn(data, 'deleteComment').mockRejectedValueOnce(new AssignmentNotFound());
    const res = await DELETE(req(), ctx({ id: '101', commentId: c.id }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Assignment not found' });
    spy.mockRestore();
  });
});
