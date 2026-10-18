import { cookies } from 'next/headers';
import { SESSION_COOKIE, decodeSession, type Session } from './session-cookie';

export { SESSION_COOKIE, SESSION_MAX_AGE, decodeSession, encodeSession } from './session-cookie';
export type { Session } from './session-cookie';

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}
