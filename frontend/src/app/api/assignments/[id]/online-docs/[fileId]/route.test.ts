// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { resetMockStore } from '@/lib/data/store';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
const signedIn = () => vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });
const signedOut = () => vi.mocked(getSession).mockResolvedValue(null);
const SIGN_IN = { error: 'Sign in again.' };
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const put = (body: unknown) =>
  new Request('http://localhost/x', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(() => {
  resetMockStore();
  signedIn();
});

import { PUT } from './route';
import { DocumentHandedIn, YunguUnavailable, data } from '@/lib/data';

const DELTA = '{"ops":[{"insert":"Changed\\n"}]}';
const BODY_LIMIT = 4 * 65_535 + 64 * 1024;

describe('PUT online document', () => {
  it('401s without a session', async () => {
    signedOut();
    const res = await PUT(put({ title: 'T', content: DELTA }), ctx({ id: '103', fileId: '1' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(SIGN_IN);
  });

  it('400s on an id that is not a number', async () => {
    expect((await PUT(put({ title: 'T', content: DELTA }), ctx({ id: '1x', fileId: '1' }))).status).toBe(400);
  });

  it.each([
    ['no title', { content: DELTA }],
    ['a null content', { title: 'T', content: null }],
    ['a body that is not JSON', '{'],
  ])('400s "Bad request." on %s', async (_case, body) => {
    const spy = vi.spyOn(data, 'updateOnlineDoc');
    const res = await PUT(put(body), ctx({ id: '103', fileId: '1' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Bad request.' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('updates a draft document and returns its FileRef', async () => {
    const ref = await data.createOnlineDoc(103, 'Notes', '{"ops":[{"insert":"x\\n"}]}');
    const spy = vi.spyOn(data, 'updateOnlineDoc');
    const res = await PUT(put({ title: 'Notes v2', content: DELTA }), ctx({ id: '103', fileId: ref.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: ref.id, name: 'Notes v2', content: DELTA, online: true });
    expect(spy).toHaveBeenCalledWith(103, ref.id, 'Notes v2', DELTA);
    spy.mockRestore();
  });

  it('409s with the message for a handed-in document', async () => {
    const handedIn = (await data.getAssignmentDetail(208))!.myFiles.find((f) => f.online)!;
    const res = await PUT(put({ title: 'Edited', content: DELTA }), ctx({ id: '208', fileId: handedIn.id }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This document was handed in — save it as a new one.' });
  });

  it('passes 400, 413, 404 and 502 through', async () => {
    const ref = await data.createOnlineDoc(103, 'Notes', DELTA);
    const blank = await PUT(put({ title: '', content: DELTA }), ctx({ id: '103', fileId: ref.id }));
    expect([blank.status, await blank.json()]).toEqual([400, { error: 'Give the document a title.' }]);
    const long = await PUT(put({ title: 'T', content: 'a'.repeat(65_536) }), ctx({ id: '103', fileId: ref.id }));
    expect([long.status, await long.json()]).toEqual([413, { error: 'Too long for Yungu — cut about 1 character.' }]);
    const gone = await PUT(put({ title: 'T', content: DELTA }), ctx({ id: '999999', fileId: ref.id }));
    expect(gone.status).toBe(404);
    const spy = vi
      .spyOn(data, 'updateOnlineDoc')
      .mockRejectedValueOnce(new YunguUnavailable("Yungu couldn't save the document. Try again."))
      .mockRejectedValueOnce(new DocumentHandedIn('This document was handed in — save it as a new one.'));
    const down = await PUT(put({ title: 'T', content: DELTA }), ctx({ id: '103', fileId: ref.id }));
    expect([down.status, await down.json()]).toEqual([502, { error: "Yungu couldn't save the document. Try again." }]);
    const handed = await PUT(put({ title: 'T', content: DELTA }), ctx({ id: '103', fileId: ref.id }));
    expect([handed.status, await handed.json()]).toEqual([409, { error: 'This document was handed in — save it as a new one.' }]);
    spy.mockRestore();
  });

  it('413s a declared body over the abuse limit without reading it', async () => {
    const json = vi.fn();
    const request = { headers: new Headers({ 'content-length': String(BODY_LIMIT + 1) }), json, body: null } as unknown as Request;
    const res = await PUT(request, ctx({ id: '103', fileId: '1' }));
    expect(res.status).toBe(413);
    expect(json).not.toHaveBeenCalled();
  });
});
