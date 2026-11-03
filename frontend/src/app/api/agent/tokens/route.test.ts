import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSession } from '@/lib/auth';
import { ServiceError, SessionEnded, data } from '@/lib/data';

vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getSession).mockResolvedValue({ name: 'Ada', token: 't' });
});

import { GET, POST } from './route';
import { DELETE as revoke } from './[id]/route';
import { DELETE as disconnect } from '../clients/[id]/route';

const get = () => GET(new Request('http://localhost/api/agent/tokens'));
const create = (body: unknown) =>
  POST(new Request('http://localhost/api/agent/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const del = (path: string) => new Request(`http://localhost${path}`, { method: 'DELETE' });

describe('/api/agent/tokens', () => {
  it('401s without a session and touches nothing', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const spies = [vi.spyOn(data, 'getAgentAccess'), vi.spyOn(data, 'createAgentToken'), vi.spyOn(data, 'revokeAgentToken'), vi.spyOn(data, 'disconnectAgent')];
    expect((await get()).status).toBe(401);
    expect((await create({ name: 'x' })).status).toBe(401);
    expect((await revoke(del('/api/agent/tokens/a'), ctx('a'))).status).toBe(401);
    expect((await disconnect(del('/api/agent/clients/a'), ctx('a'))).status).toBe(401);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('lists tokens and connected agents, uncached', async () => {
    const access = { personal: [{ id: 't1', name: 'Laptop', createdAt: 1, lastUsedAt: null }], clients: [] };
    vi.spyOn(data, 'getAgentAccess').mockResolvedValue(access);
    const res = await get();
    expect(await res.json()).toEqual(access);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('creates a token and answers it once, never cached', async () => {
    const make = vi.spyOn(data, 'createAgentToken').mockResolvedValue({ id: 't1', name: 'Laptop', token: 'ylp_secret' });
    const res = await create({ name: 'Laptop' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 't1', name: 'Laptop', token: 'ylp_secret' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(make).toHaveBeenCalledWith('Laptop');
  });

  it("passes the service's refusal on, and a missing name as ''", async () => {
    const make = vi.spyOn(data, 'createAgentToken').mockRejectedValue(new ServiceError(400, 'Give the token a name.'));
    const res = await create({});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Give the token a name.' });
    expect(make).toHaveBeenCalledWith('');
  });

  it('revokes a token and disconnects an agent by id', async () => {
    const off = vi.spyOn(data, 'revokeAgentToken').mockResolvedValue();
    const gone = vi.spyOn(data, 'disconnectAgent').mockResolvedValue();
    expect((await revoke(del('/api/agent/tokens/t1'), ctx('t1'))).status).toBe(204);
    expect((await disconnect(del('/api/agent/clients/g1'), ctx('g1'))).status).toBe(204);
    expect(off).toHaveBeenCalledWith('t1');
    expect(gone).toHaveBeenCalledWith('g1');
  });

  it('answers 404 for an unknown id and ends the session on a 401', async () => {
    vi.spyOn(data, 'revokeAgentToken').mockRejectedValue(new ServiceError(404, 'Not found.'));
    expect((await revoke(del('/api/agent/tokens/x'), ctx('x'))).status).toBe(404);
    vi.spyOn(data, 'getAgentAccess').mockRejectedValue(new SessionEnded());
    const res = await get();
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().find((c) => c.startsWith('yl_session='))).toMatch(/Max-Age=0/);
  });
});
