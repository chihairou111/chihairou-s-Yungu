import type { TodoistStatus } from '@/lib/types';
import { request } from './detail/api';

export { TODOIST_CONNECT_PATH } from '@/lib/todoist';
/** "Sign in again" for a sync stopped by an ended Yungu session: clears ours, then the sign-in page. */
export const SIGN_IN_AGAIN_PATH = '/api/session/ended';

/** The account's Todoist sync status behind the app bar's icon; throws `ApiError`. */
export function fetchTodoistStatus(signal?: AbortSignal): Promise<TodoistStatus> {
  return request('/api/todoist', { signal });
}

/** "Try again": starts a sync (the answer comes before it ends); throws `ApiError`. */
export async function syncTodoist(): Promise<void> {
  await request('/api/todoist/sync', { method: 'POST' });
}

/** Forgets the Todoist connection; throws `ApiError`. */
export async function disconnectTodoist(): Promise<void> {
  await request('/api/todoist', { method: 'DELETE' });
}
