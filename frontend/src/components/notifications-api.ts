import type { NotificationPage } from '@/lib/types';
import { request } from './detail/api';

/** The unread count behind the app bar's dot; throws `ApiError`. */
export async function fetchUnreadCount(signal?: AbortSignal): Promise<number> {
  const body = await request<{ unread?: unknown } | null>('/api/notifications/count', { signal });
  if (typeof body?.unread !== 'number') throw new Error('No count in the answer');
  return body.unread;
}

/** One page (from 1) of unread or read notifications, newest first; throws `ApiError`. */
export function fetchNotifications(read: boolean, page: number, signal?: AbortSignal): Promise<NotificationPage> {
  return request(`/api/notifications?read=${read}&page=${page}`, { signal });
}

/** Marks one notification read on Yungu; throws `ApiError`. */
export async function markNotificationRead(id: string): Promise<void> {
  await request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}
