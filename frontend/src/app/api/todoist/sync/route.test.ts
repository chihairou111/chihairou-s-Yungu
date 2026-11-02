import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { ServiceError, data } from '@/lib/data';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });
});

import { POST } from './route';

const post = () => POST(new Request('http://localhost/api/todoist/sync', { method: 'POST' }));

describe('POST /api/todoist/sync', () => {
  it('401s without a session', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const sync = vi.spyOn(data, 'syncTodoist');
    expect((await post()).status).toBe(401);
    expect(sync).not.toHaveBeenCalled();
  });

  it('starts a sync and answers 202 at once', async () => {
    const sync = vi.spyOn(data, 'syncTodoist').mockResolvedValue();
    const res = await post();
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
    expect(sync).toHaveBeenCalledOnce();
  });

  it("passes the service's 409 on", async () => {
    vi.spyOn(data, 'syncTodoist').mockRejectedValue(new ServiceError(409, 'Connect Todoist first.'));
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Connect Todoist first.' });
  });
});
