import 'server-only';
import type { AuthorizeDecision, AuthorizeParams } from '../oauth';
import type { AgentAccess, AuthorizeCheck, AuthorizeOutcome, NewAgentToken } from '../types';
import { ServiceError } from './errors';
import { mockAgents } from './store';

/**
 * Agent access against the mock: one registered agent, "Claude", returning to claude.ai (the end-to-end
 * run intercepts that address), checked in the service's order with its sentences (api/service/oauth_server.py,
 * app.py). Nothing here issues a usable token: codes and tokens are placeholders.
 */
export const MOCK_AGENT = { clientId: 'ylc_mock_claude', name: 'Claude', redirectUri: 'https://claude.ai/api/mcp/auth_callback' } as const;
export const MCP_RESOURCE = 'https://yungu.chihairou.dev/mcp';
const ISSUER = 'https://yungu.chihairou.dev';
const MAX_TOKENS = 20;
const MAX_NAME = 64;

const UNKNOWN_CLIENT = "This agent isn't registered here, or its registration expired. Start connecting again from the agent.";
const WRONG_REDIRECT = "This agent's return address doesn't match its registration. Start connecting again from the agent.";
const BAD_RESPONSE_TYPE = "This agent asked for a kind of sign-in this service doesn't offer.";
const NO_PKCE = "This agent's request is missing its security check (PKCE with S256).";
const BAD_RESOURCE = "This agent asked for access to something other than this service's agent endpoint.";

/** The client's redirect URI with the answer's parameters (and the state and issuer) on it. */
function back(uri: string, pairs: [string, string][], state: string): string {
  const query = new URLSearchParams(pairs);
  if (state) query.set('state', state);
  query.set('iss', ISSUER);
  return `${uri}${uri.includes('?') ? '&' : '?'}${query}`;
}

type Checked = { ok: true; uri: string } | { ok: false; error: string; redirect?: string };

function check(p: AuthorizeParams): Checked {
  if (p.client_id !== MOCK_AGENT.clientId) return { ok: false, error: UNKNOWN_CLIENT };
  if (p.redirect_uri !== MOCK_AGENT.redirectUri) return { ok: false, error: WRONG_REDIRECT };
  const refuse = (error: string, code: string): Checked => ({ ok: false, error, redirect: back(p.redirect_uri, [['error', code]], p.state) });
  if (p.response_type && p.response_type !== 'code') return refuse(BAD_RESPONSE_TYPE, 'unsupported_response_type');
  if (p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) return refuse(NO_PKCE, 'invalid_request');
  if (p.resource && p.resource.replace(/^HTTPS:\/\/YUNGU\.CHIHAIROU\.DEV/i, ISSUER) !== MCP_RESOURCE) return refuse(BAD_RESOURCE, 'invalid_target');
  return { ok: true, uri: p.redirect_uri };
}

export function mockCheckAuthorize(p: AuthorizeParams): AuthorizeCheck {
  const checked = check(p);
  if (!checked.ok) return { valid: false, error: checked.error, ...(checked.redirect && { redirect: checked.redirect }) };
  return { valid: true, client: { name: MOCK_AGENT.name, redirectHost: new URL(checked.uri).hostname } };
}

export function mockDecideAuthorize(p: AuthorizeParams, decision: AuthorizeDecision, now: number): AuthorizeOutcome {
  const checked = check(p);
  if (!checked.ok) return { ok: false, error: checked.error, ...(checked.redirect && { redirect: checked.redirect }) };
  if (decision === 'deny') return { ok: true, redirect: back(checked.uri, [['error', 'access_denied']], p.state) };
  // Connecting again replaces the agent's earlier connection, as the service's token exchange does.
  const agents = mockAgents();
  agents.clients = agents.clients.filter((c) => c.clientId !== MOCK_AGENT.clientId);
  agents.clients.push({ id: crypto.randomUUID(), clientId: MOCK_AGENT.clientId, name: MOCK_AGENT.name, connectedAt: now, lastUsedAt: null });
  return { ok: true, redirect: back(checked.uri, [['code', `mock-code-${crypto.randomUUID()}`]], p.state) };
}

export function mockAgentAccess(): AgentAccess {
  const { personal, clients } = mockAgents();
  return {
    personal: personal.map((t) => ({ ...t })),
    clients: clients.map(({ id, name, connectedAt, lastUsedAt }) => ({ id, name, connectedAt, lastUsedAt })),
  };
}

export function mockCreateToken(raw: string, now: number): NewAgentToken {
  const name = raw.trim();
  if (!name) throw new ServiceError(400, 'Give the token a name.');
  if (name.length > MAX_NAME) throw new ServiceError(400, `Use a name of up to ${MAX_NAME} characters.`);
  const agents = mockAgents();
  if (agents.personal.length >= MAX_TOKENS) throw new ServiceError(400, `You can have up to ${MAX_TOKENS} tokens. Revoke one first.`);
  const id = crypto.randomUUID();
  agents.personal.push({ id, name, createdAt: now, lastUsedAt: null });
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  return { id, name, token: `ylp_${secret}` };
}

/** Removes one row by id; the service's 404 when there is none. */
function remove<T extends { id: string }>(rows: T[], id: string): T[] {
  if (!rows.some((r) => r.id === id)) throw new ServiceError(404, 'Not found.');
  return rows.filter((r) => r.id !== id);
}

export function mockRevokeToken(id: string): void {
  const agents = mockAgents();
  agents.personal = remove(agents.personal, id);
}

export function mockDisconnect(id: string): void {
  const agents = mockAgents();
  agents.clients = remove(agents.clients, id);
}
