import type { AgentAccess, NewAgentToken } from '@/lib/types';
import { request } from './detail/api';

/** The agent endpoint, as an agent is told to connect to it (the service's own resource identifier). */
export const MCP_URL = 'https://yungu.chihairou.dev/mcp';

/** This account's personal tokens and connected agents; throws `ApiError`. */
export function fetchAgentAccess(signal?: AbortSignal): Promise<AgentAccess> {
  return request('/api/agent/tokens', { signal });
}

/** A new personal token, its secret in this answer only; throws `ApiError` (the service's sentence for a bad name or the cap). */
export function createAgentToken(name: string): Promise<NewAgentToken> {
  return request('/api/agent/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}

export async function revokeAgentToken(id: string): Promise<void> {
  await request(`/api/agent/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function disconnectAgent(id: string): Promise<void> {
  await request(`/api/agent/clients/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
