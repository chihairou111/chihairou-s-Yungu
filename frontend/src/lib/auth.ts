import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'yl_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export interface Session {
  name: string;
}

/** Mock session cookie value: base64url(JSON {name, token}). */
export function encodeSession(name: string): string {
  return Buffer.from(JSON.stringify({ name, token: crypto.randomUUID() })).toString('base64url');
}

export function decodeSession(value: string | undefined): Session | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object' && 'name' in parsed && typeof parsed.name === 'string') {
      return { name: parsed.name };
    }
  } catch {
    // fall through: malformed cookie means no session
  }
  return null;
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}
