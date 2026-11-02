import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { ServiceError, SessionEnded, YunguUnavailable, data } from '@/lib/data';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });
});

import { GET } from './route';

const AUTHORIZE = 'https://app.todoist.com/oauth/authorize?client_id=c&scope=data%3Aread_write&state=s&response_type=code';
const get = () => GET(new Request('http://localhost/api/todoist/connect'));

describe('GET /api/todoist/connect', () => {
  it('sends a signed-out visitor to sign in, without asking the service', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const connect = vi.spyOn(data, 'connectTodoist');
    const res = await get();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login');
    expect(connect).not.toHaveBeenCalled();
  });

  it("goes on to Todoist's authorize page, uncached", async () => {
    vi.spyOn(data, 'connectTodoist').mockResolvedValue(AUTHORIZE);
    const res = await get();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(AUTHORIZE);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['setup', new ServiceError(503, "Todoist isn't set up on this server.")],
    ['failed', new YunguUnavailable()],
  ])('comes back to Assignments with why=%s when the service cannot start it', async (why, error) => {
    vi.spyOn(data, 'connectTodoist').mockRejectedValue(error);
    const res = await get();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/assignments?todoist=error&why=${why}`);
  });

  it('ends the session on a 401 from the service and goes to sign in', async () => {
    vi.spyOn(data, 'connectTodoist').mockRejectedValue(new SessionEnded());
    const res = await get();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login');
    expect(res.headers.getSetCookie().find((c) => c.startsWith('yl_session='))).toMatch(/Max-Age=0/);
  });
});
