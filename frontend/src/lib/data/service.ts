import 'server-only';
import { cookies, headers } from 'next/headers';
import { sanitizeInstructions } from '../sanitize';
import { SESSION_COOKIE, decodeSession } from '../session-cookie';
import type { Assignment, AssignmentDetail, ClassEvent, Comment, Course, FileRef } from '../types';
import { AssignmentNotFound, ServiceError, SessionEnded, YunguUnavailable } from './errors';
import type { SignInResult, StoredFile, YunguData } from './index';

/** Set to `1` on a request (cookie, or the `X-Refresh: 1` header) to have the service skip its read cache. */
export const REFRESH_COOKIE = 'yl_refresh';
const REFRESH_HEADER = 'x-refresh';
const DEFAULT_URL = 'http://127.0.0.1:8100';
const GENERIC_ERROR = 'Something went wrong. Try again.';

const baseUrl = () => (process.env.YUNGU_API_URL || DEFAULT_URL).replace(/\/+$/, '');

async function errorText(res: Response): Promise<string | null> {
  const body: unknown = await res.json().catch(() => null);
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : null;
}

/** One call to the service; a non-2xx answer or no answer at all becomes the matching error type. */
async function send(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, { ...init, cache: 'no-store' });
  } catch {
    throw new YunguUnavailable();
  }
  if (res.ok) return res;
  const message = await errorText(res);
  if (res.status === 401) throw new SessionEnded(message ?? undefined);
  if (res.status >= 500) throw new YunguUnavailable(res.status === 502 && message ? message : undefined);
  throw new ServiceError(res.status, message ?? GENERIC_ERROR);
}

/** A call as the signed-in student: our session token from the request cookie as the Bearer token. */
async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const store = await cookies();
  const session = decodeSession(store.get(SESSION_COOKIE)?.value);
  if (!session) throw new SessionEnded();
  const sent = new Headers(init.headers);
  sent.set('Authorization', `Bearer ${session.token}`);
  const method = init.method ?? 'GET';
  if (method === 'GET') {
    const refresh = store.get(REFRESH_COOKIE)?.value === '1' || (await headers()).get(REFRESH_HEADER) === '1';
    if (refresh) sent.set('X-Refresh', '1');
  }
  return send(path, { ...init, method, headers: sent });
}

async function body<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new YunguUnavailable();
  }
}

const get = async <T>(path: string): Promise<T> => body<T>(await authed(path));

const jsonInit = (method: string, payload: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/** A write keyed by an assignment id: the service's 404 means it does not know that id. */
async function write(path: string, init: RequestInit): Promise<Response> {
  try {
    return await authed(path, init);
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) throw new AssignmentNotFound(error.message);
    throw error;
  }
}

/** Null on a 404; every other failure is thrown. */
async function orNull<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) return null;
    throw error;
  }
}

/** The Yungu service (`api/`, Task 2 of the real-data plan): server-only, token from our session cookie. */
export const serviceData: YunguData = {
  getTodo: () => get<Assignment[]>('/todo'),
  getSubmitted: () => get<Assignment[]>('/submitted'),
  getWeek: (weekStart) => get<ClassEvent[]>(`/week?start=${encodeURIComponent(weekStart)}`),
  getCourses: () => get<Course[]>('/courses'),
  async getAssignmentDetail(id) {
    const detail = await orNull(() => get<AssignmentDetail>(`/assignments/${id}`));
    // The service passes Yungu's own HTML through; it is sanitised here, before it reaches a page.
    return detail && { ...detail, instructionsHtml: sanitizeInstructions(detail.instructionsHtml ?? '') };
  },
  async uploadFile(name, mime, bytes) {
    const form = new FormData();
    form.append('file', new Blob([bytes as BlobPart], { type: mime }), name);
    return body<FileRef>(await authed('/files', { method: 'POST', body: form }));
  },
  async getFile(id, opts) {
    const path = `/files/${encodeURIComponent(id)}?preview=${opts?.preview ? 1 : 0}`;
    const file = await orNull(() => get<{ redirect: string }>(path));
    return file && ({ redirect: file.redirect } satisfies StoredFile);
  },
  async saveDraft(id, fileIds) {
    await write(`/assignments/${id}/draft`, jsonInit('PUT', { fileIds }));
  },
  async submit(id, fileIds) {
    return body<{ submittedAt: number }>(await write(`/assignments/${id}/submit`, jsonInit('POST', { fileIds })));
  },
  async addComment(id, text) {
    return body<Comment>(await write(`/assignments/${id}/comments`, jsonInit('POST', { text })));
  },
  async deleteComment(id, commentId) {
    await write(`/assignments/${id}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
  },
  async refresh() {
    await authed('/refresh', { method: 'POST' });
  },
  async signIn(loginId, password): Promise<SignInResult> {
    let answer: { ok?: unknown; displayName?: unknown; token?: unknown; error?: unknown };
    try {
      answer = await body(await send('/session', jsonInit('POST', { loginId, password })));
    } catch (error) {
      // Yungu down (502), or any other refusal: a message on the sign-in form, not a crash.
      if (error instanceof ServiceError) return { ok: false, error: error.message };
      throw error;
    }
    if (answer.ok === true && typeof answer.displayName === 'string' && typeof answer.token === 'string') {
      return { ok: true, displayName: answer.displayName, token: answer.token };
    }
    return { ok: false, error: typeof answer.error === 'string' ? answer.error : GENERIC_ERROR };
  },
  async signOut(token) {
    try {
      await send('/session', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      // The token is already gone on the service side: nothing left to end.
      if (!(error instanceof SessionEnded)) throw error;
    }
  },
};
