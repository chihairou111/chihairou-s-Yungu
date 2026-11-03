/**
 * Where the sign-in page may send the browser afterwards (`/login?next=…`): a path on this site only.
 * Anything that could leave it is refused: an absolute URL or a scheme, `//host` and `/\host` (which
 * browsers read as another host), any backslash, whitespace or control character (the URL parser drops
 * tabs and newlines, so `/\t/host` would become `//host`). The sign-in page itself and Route Handlers are
 * refused too: neither is a page to come back to.
 */
const MAX_NEXT_CHARS = 8192;
const BASE = 'https://same-origin.invalid';

export function safeNext(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_NEXT_CHARS) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  if (url.pathname === '/login' || url.pathname === '/api' || url.pathname.startsWith('/api/')) return null;
  return raw;
}

/** The sign-in page, coming back to `next` afterwards when that is a safe path. */
export function loginPath(next: unknown): string {
  const safe = safeNext(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : '/login';
}
