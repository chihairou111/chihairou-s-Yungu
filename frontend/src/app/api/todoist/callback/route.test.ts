import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { ServiceError, SessionEnded, YunguUnavailable, data } from '@/lib/data';
import type { TodoistStatus } from '@/lib/types';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });
});

import { GET } from './route';

const get = (query = '?code=the-code&state=the-state') => GET(new Request(`http://localhost/api/todoist/callback${query}`));
const EXPIRED = new ServiceError(400, 'That Todoist link expired. Try connecting again.');
const CONNECTED = '/assignments?todoist=connected';
const failed = (why: string) => `/assignments?todoist=error&why=${why}`;

describe('GET /api/todoist/callback', () => {
  it('sends a signed-out visitor to sign in, and hands nothing to the service', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const finish = vi.spyOn(data, 'finishTodoist');
    const res = await get();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/login');
    expect(finish).not.toHaveBeenCalled();
  });

  it('hands the code and state to the service and lands on Assignments, connected', async () => {
    const finish = vi.spyOn(data, 'finishTodoist').mockResolvedValue();
    const res = await get();
    expect(finish).toHaveBeenCalledWith('the-code', 'the-state');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(CONNECTED);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('a page reload after connecting (the link used up, the account connected) still lands as connected', async () => {
    vi.spyOn(data, 'finishTodoist').mockRejectedValue(EXPIRED);
    for (const state of ['ok', 'syncing'] as const) {
      vi.spyOn(data, 'getTodoist').mockResolvedValue({ connected: true, account: 'Ada', state });
      expect((await get()).headers.get('location')).toBe(CONNECTED);
    }
  });

  it.each<[string, TodoistStatus]>([
    ['not connected', { connected: false, state: 'ok' }],
    ['connected but asking to connect again', { connected: true, state: 'error', error: { code: 'reauth', message: 'Todoist needs you to connect again.' } }],
  ])('an expired link while %s comes back with why=expired', async (_name, status) => {
    vi.spyOn(data, 'finishTodoist').mockRejectedValue(EXPIRED);
    vi.spyOn(data, 'getTodoist').mockResolvedValue(status);
    expect((await get()).headers.get('location')).toBe(failed('expired'));
  });

  it('an expired link whose status cannot be read is still expired', async () => {
    vi.spyOn(data, 'finishTodoist').mockRejectedValue(EXPIRED);
    vi.spyOn(data, 'getTodoist').mockRejectedValue(new YunguUnavailable());
    expect((await get()).headers.get('location')).toBe(failed('expired'));
  });

  it.each([
    ['refused', new YunguUnavailable("Todoist didn't accept the connection. Try again.")],
    ['unreachable', new YunguUnavailable("Can't reach Todoist right now. Try again.")],
    ['setup', new ServiceError(503, "Todoist isn't set up on this server.")],
    ['failed', new YunguUnavailable()],
    ['failed', new ServiceError(422, 'Bad request.')],
  ])('comes back with why=%s', async (why, error) => {
    vi.spyOn(data, 'finishTodoist').mockRejectedValue(error);
    vi.spyOn(data, 'getTodoist').mockResolvedValue({ connected: false, state: 'ok' });
    expect((await get()).headers.get('location')).toBe(failed(why));
  });

  it('a refusal on Todoist (Cancel) comes back with why=denied, and nothing is sent on', async () => {
    const finish = vi.spyOn(data, 'finishTodoist');
    const res = await get('?error=access_denied&state=the-state');
    expect(res.headers.get('location')).toBe(failed('denied'));
    expect(finish).not.toHaveBeenCalled();
  });

  it('a callback without code or state still asks the service (which uses nothing up and refuses it)', async () => {
    const finish = vi.spyOn(data, 'finishTodoist').mockRejectedValue(EXPIRED);
    vi.spyOn(data, 'getTodoist').mockResolvedValue({ connected: false, state: 'ok' });
    expect((await get('')).headers.get('location')).toBe(failed('expired'));
    expect(finish).toHaveBeenCalledWith('', '');
  });

  it('ends the session on a 401 from the service and goes to sign in', async () => {
    vi.spyOn(data, 'finishTodoist').mockRejectedValue(new SessionEnded());
    const res = await get();
    expect(res.headers.get('location')).toBe('/login');
    expect(res.headers.getSetCookie().find((c) => c.startsWith('yl_session='))).toMatch(/Max-Age=0/);
  });

  it('never puts the code or state into where it sends the browser', async () => {
    vi.spyOn(data, 'finishTodoist').mockRejectedValue(new YunguUnavailable());
    vi.spyOn(data, 'getTodoist').mockResolvedValue({ connected: false, state: 'ok' });
    const location = (await get()).headers.get('location')!;
    expect(location).not.toMatch(/the-code|the-state/);
  });
});
