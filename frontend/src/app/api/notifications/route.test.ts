import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { SessionEnded, YunguUnavailable, data } from '@/lib/data';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });
});

import { GET as list } from './route';
import { GET as count } from './count/route';
import { POST as markRead } from './[id]/read/route';

const PAGE = { items: [{ id: '1', title: 't', body: 'b', createdAt: 1, read: false, taskId: 203 }], hasMore: true };
const get = (query: string) => list(new Request(`http://localhost/api/notifications${query}`));
const mark = (id: string) =>
  markRead(new Request(`http://localhost/api/notifications/${id}/read`, { method: 'POST' }), { params: Promise.resolve({ id }) });

describe('notification routes', () => {
  it('401 without a session, never touching the data layer', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const spies = [vi.spyOn(data, 'getUnreadCount'), vi.spyOn(data, 'getNotifications'), vi.spyOn(data, 'markNotificationRead')];
    for (const res of [await count(new Request('http://localhost/api/notifications/count')), await get('?read=false'), await mark('1')]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Sign in again.' });
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('GET /count answers { unread }', async () => {
    vi.spyOn(data, 'getUnreadCount').mockResolvedValue(4);
    const res = await count(new Request('http://localhost/api/notifications/count'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unread: 4 });
  });

  it('GET lists one page, read or unread, page 1 by default', async () => {
    const spy = vi.spyOn(data, 'getNotifications').mockResolvedValue(PAGE);
    expect(await (await get('?read=false')).json()).toEqual(PAGE);
    await get('?read=true&page=3');
    expect(spy.mock.calls).toEqual([
      [false, 1],
      [true, 3],
    ]);
  });

  it.each(['', '?read=yes', '?read=true&page=0', '?read=true&page=x', '?read=true&page=-1', '?read=true&page=1234567'])(
    'GET %s is a 400',
    async (query) => {
      const spy = vi.spyOn(data, 'getNotifications');
      const res = await get(query);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Bad request.' });
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it('POST /[id]/read marks it and answers 204', async () => {
    const spy = vi.spyOn(data, 'markNotificationRead').mockResolvedValue();
    const res = await mark('5180327');
    expect(res.status).toBe(204);
    expect(spy).toHaveBeenCalledWith('5180327');
  });

  it('POST /[id]/read 404s on a non-numeric id', async () => {
    const spy = vi.spyOn(data, 'markNotificationRead');
    expect((await mark('abc')).status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it("passes Yungu's 502 on and ends the session on a 401", async () => {
    vi.spyOn(data, 'markNotificationRead').mockRejectedValue(new YunguUnavailable());
    const res = await mark('1');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Can't reach Yungu right now. Try again." });
    vi.spyOn(data, 'getUnreadCount').mockRejectedValue(new SessionEnded());
    const ended = await count(new Request('http://localhost/api/notifications/count'));
    expect(ended.status).toBe(401);
    expect(ended.headers.getSetCookie().find((c) => c.startsWith('yl_session='))).toMatch(/Max-Age=0/);
  });
});
