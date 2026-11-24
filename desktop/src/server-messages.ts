/** What the server's credentials bridge (`frontend/src/lib/yungu/bridge.ts`) posts to the main process. */
export type ServerMessage =
  | { type: 'signed-in'; name: string; token: string }
  | { type: 'sign-in-failed'; reason: 'wrong-password' | 'unreachable' }
  | { type: 'save-credentials'; loginId: string; password: string }
  | { type: 'forget-credentials' };

const str = (v: unknown): v is string => typeof v === 'string';

/** The message, checked; null for anything else. */
export function parseServerMessage(data: unknown): ServerMessage | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  switch (m.type) {
    case 'signed-in':
      return str(m.name) && str(m.token) ? { type: 'signed-in', name: m.name, token: m.token } : null;
    case 'sign-in-failed':
      return m.reason === 'wrong-password' || m.reason === 'unreachable' ? { type: 'sign-in-failed', reason: m.reason } : null;
    case 'save-credentials':
      return str(m.loginId) && str(m.password)
        ? { type: 'save-credentials', loginId: m.loginId, password: m.password }
        : null;
    case 'forget-credentials':
      return { type: 'forget-credentials' };
    default:
      return null;
  }
}
