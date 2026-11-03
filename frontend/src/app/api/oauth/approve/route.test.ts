import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { SessionEnded, YunguUnavailable, data } from '@/lib/data';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });
});

import { POST } from './route';

const PARAMS = {
  response_type: 'code',
  client_id: 'ylc_1',
  redirect_uri: 'https://claude.ai/cb',
  state: 's',
  code_challenge: 'c'.repeat(43),
  code_challenge_method: 'S256',
  scope: 'read',
  resource: 'https://yungu.chihairou.dev/mcp',
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request('http://localhost/api/oauth/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'yungu.chihairou.dev', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

describe('POST /api/oauth/approve', () => {
  it('401s without a session and asks nothing of the service', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const decide = vi.spyOn(data, 'decideAuthorize');
    expect((await post({ ...PARAMS, decision: 'allow' })).status).toBe(401);
    expect(decide).not.toHaveBeenCalled();
  });

  it('passes the request on field for field with the decision and answers where to go', async () => {
    const decide = vi.spyOn(data, 'decideAuthorize').mockResolvedValue({ ok: true, redirect: 'https://claude.ai/cb?code=c&state=s' });
    const res = await post({ ...PARAMS, decision: 'allow', extra: 'x' }, { origin: 'https://yungu.chihairou.dev', 'sec-fetch-site': 'same-origin' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect: 'https://claude.ai/cb?code=c&state=s' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(decide).toHaveBeenCalledWith(PARAMS, 'allow');
  });

  it('never takes a redirect from the browser: only the service says where to go', async () => {
    const decide = vi.spyOn(data, 'decideAuthorize').mockResolvedValue({ ok: false, error: 'You can connect up to 20 agents. Disconnect one in Agent access first.' });
    const res = await post({ ...PARAMS, decision: 'deny', redirect: 'https://evil.example/' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'You can connect up to 20 agents. Disconnect one in Agent access first.' });
    expect(decide).toHaveBeenCalledWith(PARAMS, 'deny');
  });

  it("keeps a refusal's redirect from the service", async () => {
    vi.spyOn(data, 'decideAuthorize').mockResolvedValue({ ok: false, error: 'No PKCE.', redirect: 'https://claude.ai/cb?error=invalid_request' });
    const res = await post({ ...PARAMS, decision: 'allow' });
    expect(await res.json()).toEqual({ error: 'No PKCE.', redirect: 'https://claude.ai/cb?error=invalid_request' });
  });

  it.each([
    ['no decision', { ...PARAMS }],
    ['an unknown decision', { ...PARAMS, decision: 'maybe' }],
    ['a field given as a list', { ...PARAMS, client_id: ['a', 'b'], decision: 'allow' }],
    ['a field that is not text', { ...PARAMS, state: 5, decision: 'allow' }],
    ['a body that is not JSON', 'nope'],
  ])('refuses %s without asking the service', async (_, body) => {
    const decide = vi.spyOn(data, 'decideAuthorize');
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).not.toHaveProperty('redirect');
    expect(decide).not.toHaveBeenCalled();
  });

  it.each([
    ['another site', { origin: 'https://evil.example' }],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['a form post', { 'content-type': 'application/x-www-form-urlencoded' }],
    ['a text/plain post', { 'content-type': 'text/plain' }],
  ])('refuses a request from %s (no consent on someone else’s behalf)', async (_, headers) => {
    const decide = vi.spyOn(data, 'decideAuthorize');
    const res = await post({ ...PARAMS, decision: 'allow' }, headers);
    expect(res.status).toBe(403);
    expect(decide).not.toHaveBeenCalled();
  });

  it('ends the session on a 401 from the service and passes an outage on', async () => {
    vi.spyOn(data, 'decideAuthorize').mockRejectedValueOnce(new SessionEnded());
    const ended = await post({ ...PARAMS, decision: 'allow' });
    expect(ended.status).toBe(401);
    expect(ended.headers.getSetCookie().find((c) => c.startsWith('yl_session='))).toMatch(/Max-Age=0/);
    vi.spyOn(data, 'decideAuthorize').mockRejectedValueOnce(new YunguUnavailable());
    expect((await post({ ...PARAMS, decision: 'allow' })).status).toBe(502);
  });
});
