import 'server-only';
import { cookies, headers } from 'next/headers';
import { sanitizeInstructions } from '../sanitize';
import { SESSION_COOKIE, decodeSession } from '../session-cookie';
import { BAD_AUTHORIZE_REQUEST, isWebRedirect, type AuthorizeDecision, type AuthorizeParams } from '../oauth';
import type {
  AgentAccess,
  Assignment,
  AssignmentDetail,
  AuthorizeCheck,
  AuthorizeOutcome,
  Behaviour,
  ClassEvent,
  Comment,
  Course,
  FileRef,
  NewAgentToken,
  NotificationPage,
  TodoistStatus,
} from '../types';
import { AssignmentNotFound, CommentNotFound, DocumentHandedIn, DocumentTooLong, ServiceError, SessionEnded, YunguUnavailable } from './errors';
import type { SignInResult, StoredFile, YunguData } from './index';
import { NOTIFICATION_PAGE_SIZE } from './messages';

/** Set to `1` on a request (cookie, or the `X-Refresh: 1` header) to have the service skip its read cache. */
export const REFRESH_COOKIE = 'yl_refresh';
const REFRESH_HEADER = 'x-refresh';
const DEFAULT_URL = 'http://127.0.0.1:8100';
const GENERIC_ERROR = 'Something went wrong. Try again.';
/** The service's 404 message when a comment to delete is not the student's own (`COMMENT_NOT_FOUND` in api/service/app.py). */
const SERVICE_COMMENT_NOT_FOUND = 'Comment not found.';

/**
 * How long one call to the service may take, body included, before it counts as "Can't reach Yungu"
 * (without one, fetch waits about 5 minutes for a hung service). The service gives each Yungu socket
 * operation 15 s; a cold read is a handful of sequential Yungu calls, a sign-in or re-login five more.
 * Writes get twice the read budget: one that runs out may still go through on Yungu, so the budget is
 * generous, and if it does run out the pop-up shows its usual inline error (never a false success)
 * and its next load shows what Yungu really holds. Uploads also carry the file on to OSS (up to 50 MB).
 */
export const READ_TIMEOUT_MS = 45_000;
export const WRITE_TIMEOUT_MS = 90_000;
export const UPLOAD_TIMEOUT_MS = 300_000;

const baseUrl = () => (process.env.YUNGU_API_URL || DEFAULT_URL).replace(/\/+$/, '');

async function errorText(res: Response): Promise<string | null> {
  const body: unknown = await res.json().catch(() => null);
  return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : null;
}

/**
 * One call to the service; a non-2xx answer, no answer at all, or no answer within `timeoutMs` (a GET
 * defaults to the read budget, anything else to the write budget) becomes the matching error type. The
 * budget covers the body too: a body that stops arriving fails its `res.json()`, which `body()` and
 * `errorText()` treat as unavailable. Statuses in `answers` come back as responses instead (the consent
 * API's refusals carry more than a message).
 */
async function send(path: string, init: RequestInit, timeoutMs?: number, answers: readonly number[] = []): Promise<Response> {
  const budget = timeoutMs ?? ((init.method ?? 'GET') === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, { ...init, cache: 'no-store', signal: AbortSignal.timeout(budget) });
  } catch {
    throw new YunguUnavailable();
  }
  if (res.ok || answers.includes(res.status)) return res;
  const message = await errorText(res);
  if (res.status === 401) throw new SessionEnded(message ?? undefined);
  // The service's own 503 ("Todoist isn't set up on this server."), not a proxy's page: kept as is.
  if (res.status === 503 && message) throw new ServiceError(503, message);
  if (res.status >= 500) throw new YunguUnavailable(res.status === 502 && message ? message : undefined);
  throw new ServiceError(res.status, message ?? GENERIC_ERROR);
}

/** A call as the signed-in student: our session token from the request cookie as the Bearer token. */
async function authed(path: string, init: RequestInit = {}, timeoutMs?: number, answers?: readonly number[]): Promise<Response> {
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
  return send(path, { ...init, method, headers: sent }, timeoutMs, answers);
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

/** An online-document write: the service's 409 (handed in) and 413 (too long) become their own types, message kept. */
async function docWrite(path: string, init: RequestInit): Promise<FileRef> {
  try {
    return await body<FileRef>(await write(path, init));
  } catch (error) {
    if (error instanceof ServiceError && error.status === 409) throw new DocumentHandedIn(error.message);
    if (error instanceof ServiceError && error.status === 413) throw new DocumentTooLong(error.message);
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

/**
 * A consent-API call (`/oauth/authorize/request` or `/approve`): the 200 body, or the refusal. A 400 is
 * the service's refusal with its sentence and, when it trusts the client's return address, a redirect;
 * a 422 is a field over the service's length limit, a request that isn't valid. A redirect that is not
 * an http(s) URL is never passed on.
 */
async function consent(path: string, payload: unknown): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string; redirect?: string }> {
  const res = await authed(path, jsonInit('POST', payload), undefined, [400, 422]);
  const answer = await body<unknown>(res);
  const fields = answer && typeof answer === 'object' ? (answer as Record<string, unknown>) : {};
  if (res.ok) return { ok: true, body: fields };
  if (res.status === 422) return { ok: false, error: BAD_AUTHORIZE_REQUEST };
  const error = typeof fields.error === 'string' && fields.error ? fields.error : BAD_AUTHORIZE_REQUEST;
  return isWebRedirect(fields.redirect) ? { ok: false, error, redirect: fields.redirect } : { ok: false, error };
}

/** The Yungu service (`api/`, Task 2 of the real-data plan): server-only, token from our session cookie. */
export const serviceData: YunguData = {
  getTodo: () => get<Assignment[]>('/todo'),
  getSubmitted: () => get<Assignment[]>('/submitted'),
  getWeek: (weekStart) => get<ClassEvent[]>(`/week?start=${encodeURIComponent(weekStart)}`),
  getCourses: () => get<Course[]>('/courses'),
  getBehaviour: (month) => get<Behaviour>(`/behaviour?month=${encodeURIComponent(month)}`),
  async getAssignmentDetail(id) {
    const detail = await orNull(() => get<AssignmentDetail>(`/assignments/${id}`));
    // The service passes Yungu's own HTML through; it is sanitised here, before it reaches a page.
    return detail && { ...detail, instructionsHtml: sanitizeInstructions(detail.instructionsHtml ?? '') };
  },
  async uploadFile(name, mime, bytes) {
    const form = new FormData();
    form.append('file', new Blob([bytes as BlobPart], { type: mime }), name);
    return body<FileRef>(await authed('/files', { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS));
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
    // An empty list is Mark as submitted; the service decides whether it is allowed.
    return body<{ submittedAt: number }>(await write(`/assignments/${id}/submit`, jsonInit('POST', { fileIds })));
  },
  createOnlineDoc: (id, title, content) => docWrite(`/assignments/${id}/online-docs`, jsonInit('POST', { title, content })),
  updateOnlineDoc: (id, fileId, title, content) =>
    docWrite(`/assignments/${id}/online-docs/${encodeURIComponent(fileId)}`, jsonInit('PUT', { title, content })),
  async addComment(id, text) {
    return body<Comment>(await write(`/assignments/${id}/comments`, jsonInit('POST', { text })));
  },
  async deleteComment(id, commentId) {
    try {
      await write(`/assignments/${id}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' });
    } catch (error) {
      // Both 404s arrive as AssignmentNotFound; the service's message tells the comment one apart.
      if (error instanceof AssignmentNotFound && error.message === SERVICE_COMMENT_NOT_FOUND) throw new CommentNotFound();
      throw error;
    }
  },
  async getUnreadCount() {
    const { unread } = await get<{ unread: number }>('/notifications/count');
    return unread;
  },
  getNotifications: (read, page) =>
    get<NotificationPage>(`/notifications?read=${read}&page=${encodeURIComponent(page)}&size=${NOTIFICATION_PAGE_SIZE}`),
  async markNotificationRead(id) {
    await authed(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  },
  async refresh() {
    await authed('/refresh', { method: 'POST' });
  },
  getTodoist: () => get<TodoistStatus>('/todoist'),
  async connectTodoist() {
    const { authorizeUrl } = await body<{ authorizeUrl?: unknown }>(await authed('/todoist/connect', { method: 'POST' }));
    if (typeof authorizeUrl !== 'string' || !authorizeUrl) throw new YunguUnavailable();
    return authorizeUrl;
  },
  async finishTodoist(code, state) {
    await authed('/todoist/callback', jsonInit('POST', { code, state }));
  },
  async syncTodoist() {
    await authed('/todoist/sync', { method: 'POST' });
  },
  async disconnectTodoist() {
    await authed('/todoist', { method: 'DELETE' });
  },
  getAgentAccess: () => get<AgentAccess>('/agent/tokens'),
  async createAgentToken(name) {
    return body<NewAgentToken>(await authed('/agent/tokens', jsonInit('POST', { name })));
  },
  async revokeAgentToken(id) {
    await authed(`/agent/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async disconnectAgent(id) {
    await authed(`/agent/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async checkAuthorize(params): Promise<AuthorizeCheck> {
    const answer = await consent('/oauth/authorize/request', params);
    if (!answer.ok) return { valid: false, error: answer.error, ...(answer.redirect && { redirect: answer.redirect }) };
    const client = answer.body.client as { name?: unknown; redirectHost?: unknown } | undefined;
    if (answer.body.valid !== true || typeof client?.name !== 'string' || typeof client.redirectHost !== 'string') throw new YunguUnavailable();
    return { valid: true, client: { name: client.name, redirectHost: client.redirectHost } };
  },
  async decideAuthorize(params: AuthorizeParams, decision: AuthorizeDecision): Promise<AuthorizeOutcome> {
    const answer = await consent('/oauth/authorize/approve', { ...params, decision });
    if (!answer.ok) return { ok: false, error: answer.error, ...(answer.redirect && { redirect: answer.redirect }) };
    if (!isWebRedirect(answer.body.redirect)) throw new YunguUnavailable();
    return { ok: true, redirect: answer.body.redirect };
  },
  async signIn(loginId, password): Promise<SignInResult> {
    let answer: { ok?: unknown; displayName?: unknown; token?: unknown; error?: unknown };
    // The browser's address as nginx set it (it replaces any the browser sent): the service counts
    // refused sign-ins per address as well as per student ID. It only ever sees us, at 127.0.0.1.
    const init = jsonInit('POST', { loginId, password });
    const address = (await headers()).get('x-real-ip');
    if (address) init.headers = { ...(init.headers as Record<string, string>), 'X-Real-IP': address };
    try {
      answer = await body(await send('/session', init));
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
