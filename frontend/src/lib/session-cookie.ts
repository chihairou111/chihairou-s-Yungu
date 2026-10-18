// Cookie format helpers with no next/headers import, so the proxy can use them too.

export const SESSION_COOKIE = 'yl_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** Our own session: the display name plus the opaque token the data layer issued at sign-in. */
export interface Session {
  name: string;
  token: string;
}

/** Session cookie value: base64url(JSON {name, token}). */
export function encodeSession(name: string, token: string): string {
  return Buffer.from(JSON.stringify({ name, token })).toString('base64url');
}

export function decodeSession(value: string | undefined): Session | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      parsed &&
      typeof parsed === 'object' &&
      'name' in parsed &&
      typeof parsed.name === 'string' &&
      'token' in parsed &&
      typeof parsed.token === 'string'
    ) {
      return { name: parsed.name, token: parsed.token };
    }
  } catch {
    // fall through: malformed cookie means no session
  }
  return null;
}

/** True when the browser reached us over HTTPS, directly or through a TLS-terminating proxy. */
function isHttps(request: Request): boolean {
  if (new URL(request.url).protocol === 'https:') return true;
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return forwarded === 'https';
}

/** Options for setting (maxAge > 0) or clearing (maxAge 0) the session cookie. */
export function sessionCookieOptions(request: Request, maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
    secure: isHttps(request),
  };
}
