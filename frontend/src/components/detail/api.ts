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

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
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

export function submit(id: number, fileIds: string[]): Promise<{ submittedAt: number }> {
  return request(`/api/assignments/${id}/submit`, json('POST', { fileIds }));
}

export function addComment(id: number, text: string): Promise<Comment> {
  return request(`/api/assignments/${id}/comments`, json('POST', { text }));
}

export async function deleteComment(id: number, commentId: string): Promise<void> {
  await request(`/api/assignments/${id}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
}

/** Renders written work (editor HTML) to a PDF on the server and stores it like an upload. */
export function renderPdf(title: string, html: string, signal?: AbortSignal): Promise<FileRef> {
  return request('/api/render-pdf', json('POST', { title, html }, signal));
}
