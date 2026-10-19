import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, addComment, fetchDetail, uploadFile } from './api';

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
});
