import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, addComment, createOnlineDoc, fetchDetail, submit, updateOnlineDoc, uploadFile } from './api';

function respond(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('detail api', () => {
  it('returns the parsed body on success', async () => {
    const fetchMock = respond(200, { id: 101, title: 'Essay' });
    await expect(fetchDetail(101)).resolves.toMatchObject({ id: 101, title: 'Essay' });
    expect(fetchMock).toHaveBeenCalledWith('/api/assignments/101', expect.objectContaining({ cache: 'no-store' }));
  });

  it("throws ApiError with the server's status and message", async () => {
    respond(401, { error: 'Sign in again.' });
    const error = await fetchDetail(101).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: 'Sign in again.' });
  });

  it('falls back to a plain message when the error body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(fetchDetail(101)).rejects.toMatchObject({ status: 502, message: 'Something went wrong. Try again.' });
  });

  it('reports a network failure as status 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(addComment(101, 'Hi')).rejects.toMatchObject({ status: 0, message: 'No connection. Try again.' });
  });

  it('sends uploads as multipart with the file under "file"', async () => {
    const fetchMock = respond(200, { id: 'f1' });
    const file = new File(['abc'], '作业 1.pdf', { type: 'application/pdf' });
    await uploadFile(file);
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.method).toBe('POST');
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('createOnlineDoc POSTs the title and content as JSON and returns the FileRef', async () => {
    const delta = '{"ops":[{"insert":"研究\\n"}]}';
    const fetchMock = respond(200, { id: '11138501', online: true, content: delta });
    await expect(createOnlineDoc(60417, '研究', delta)).resolves.toMatchObject({ id: '11138501', content: delta });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/assignments/60417/online-docs');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init!.body))).toEqual({ title: '研究', content: delta });
  });

  it('updateOnlineDoc PUTs to the encoded document id', async () => {
    const fetchMock = respond(200, { id: 'a/b' });
    await updateOnlineDoc(60417, 'a/b', 'T', '{"ops":[]}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/assignments/60417/online-docs/a%2Fb');
    expect(init!.method).toBe('PUT');
    expect(JSON.parse(String(init!.body))).toEqual({ title: 'T', content: '{"ops":[]}' });
  });

  it("surfaces the server's 409 and 413 messages as ApiError", async () => {
    respond(409, { error: 'This document was handed in — save it as a new one.' });
    await expect(updateOnlineDoc(1, '2', 'T', '{}')).rejects.toMatchObject({ status: 409, message: 'This document was handed in — save it as a new one.' });
    respond(413, { error: 'Too long for Yungu — cut about 3 characters.' });
    await expect(createOnlineDoc(1, 'T', '{}')).rejects.toMatchObject({ status: 413, message: 'Too long for Yungu — cut about 3 characters.' });
  });

  it('submit sends an empty list for Mark as submitted', async () => {
    const fetchMock = respond(200, { submittedAt: 1 });
    await expect(submit(95257, [])).resolves.toEqual({ submittedAt: 1 });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({ fileIds: [] });
  });
});
