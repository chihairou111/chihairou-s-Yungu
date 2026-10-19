import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { SessionEnded, YunguUnavailable, data } from '@/lib/data';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));
const signedIn = () => vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });

beforeEach(() => {
  vi.restoreAllMocks();
  signedIn();
});

import { POST } from './route';

const post = () => POST(new Request('http://localhost/api/refresh', { method: 'POST' }));

describe('POST /api/refresh', () => {
  it('401s without a session and does not touch the data layer', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const refresh = vi.spyOn(data, 'refresh');
    const res = await post();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Sign in again.' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('drops the cached reads and answers 204', async () => {
    const refresh = vi.spyOn(data, 'refresh');
    const res = await post();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("passes a 502 on with the service's message", async () => {
    vi.spyOn(data, 'refresh').mockRejectedValue(new YunguUnavailable());
    const res = await post();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Can't reach Yungu right now. Try again." });
  });

  it('ends the session on a 401 from the service', async () => {
    vi.spyOn(data, 'refresh').mockRejectedValue(new SessionEnded());
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().find((c) => c.startsWith('yl_session='))).toMatch(/Max-Age=0/);
  });
});
