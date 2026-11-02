import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { SessionEnded, YunguUnavailable, data } from '@/lib/data';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });
});

import { DELETE, GET } from './route';

const get = () => GET(new Request('http://localhost/api/todoist'));
const del = () => DELETE(new Request('http://localhost/api/todoist', { method: 'DELETE' }));

describe('GET /api/todoist', () => {
  it('401s without a session and does not touch the data layer', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const status = vi.spyOn(data, 'getTodoist');
    const res = await get();
    expect(res.status).toBe(401);
    expect(status).not.toHaveBeenCalled();
  });

  it("answers the account's sync status, uncached", async () => {
    const status = { connected: true, account: 'Ada', state: 'error', error: { code: 'reauth', message: 'Todoist needs you to connect again.' } } as const;
    vi.spyOn(data, 'getTodoist').mockResolvedValue(status);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it("passes a 502 on with the service's message", async () => {
    vi.spyOn(data, 'getTodoist').mockRejectedValue(new YunguUnavailable());
    const res = await get();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Can't reach Yungu right now. Try again." });
  });
});

describe('DELETE /api/todoist', () => {
  it('401s without a session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const off = vi.spyOn(data, 'disconnectTodoist');
    expect((await del()).status).toBe(401);
    expect(off).not.toHaveBeenCalled();
  });

  it('disconnects and answers 204', async () => {
    const off = vi.spyOn(data, 'disconnectTodoist').mockResolvedValue();
    const res = await del();
    expect(res.status).toBe(204);
    expect(off).toHaveBeenCalledOnce();
  });

  it('ends the session on a 401 from the service', async () => {
    vi.spyOn(data, 'disconnectTodoist').mockRejectedValue(new SessionEnded());
    const res = await del();
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().find((c) => c.startsWith('yl_session='))).toMatch(/Max-Age=0/);
  });
});
