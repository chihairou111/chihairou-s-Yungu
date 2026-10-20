import type { AssignmentDetail, Comment, FileRef } from '@/lib/types';

/** A failed API call: the HTTP status (0 when the request never reached the server) and a message to show. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** A 401: the session cookie is gone or expired, so the user has to sign in again. */
export function isSessionEnded(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** A same-origin JSON call; failures become `ApiError` (an abort is rethrown as is). */
export async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'No connection. Try again.');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Something went wrong. Try again.';
    throw new ApiError(res.status, message);
  }
  return body as T;
}

function json(method: string, body: unknown, signal?: AbortSignal): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
}

export function fetchDetail(id: number, signal?: AbortSignal): Promise<AssignmentDetail> {
  return request(`/api/assignments/${id}`, { signal });
}

export function uploadFile(file: File, signal?: AbortSignal): Promise<FileRef> {
  const form = new FormData();
  form.append('file', file);
  return request('/api/files', { method: 'POST', body: form, signal });
}

export async function saveDraft(id: number, fileIds: string[]): Promise<void> {
  await request(`/api/assignments/${id}/draft`, json('PUT', { fileIds }));
}

/** Hands the files in; an empty list is "Mark as submitted" (the server refuses it unless allowed). */
export function submit(id: number, fileIds: string[]): Promise<{ submittedAt: number }> {
  return request(`/api/assignments/${id}/submit`, json('POST', { fileIds }));
}

/** Saves a new Yungu online document (`content`: Quill delta JSON) and returns its FileRef; it is not in the draft until saved there. */
export function createOnlineDoc(id: number, title: string, content: string): Promise<FileRef> {
  return request(`/api/assignments/${id}/online-docs`, json('POST', { title, content }));
}

/** Saves an online document in place; a handed-in one fails with a 409 ApiError (save it as a new one instead). */
export function updateOnlineDoc(id: number, fileId: string, title: string, content: string): Promise<FileRef> {
  return request(`/api/assignments/${id}/online-docs/${encodeURIComponent(fileId)}`, json('PUT', { title, content }));
}

export function addComment(id: number, text: string): Promise<Comment> {
  return request(`/api/assignments/${id}/comments`, json('POST', { text }));
}

export async function deleteComment(id: number, commentId: string): Promise<void> {
  await request(`/api/assignments/${id}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
}

