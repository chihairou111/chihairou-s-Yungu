/** Transport pieces for the Yungu client: the fetch shape, a small cookie jar, the error type. */

/** The subset of `fetch` the client needs. Node's `fetch` and Electron's `net.fetch` both fit. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** A failed Yungu call. `redirect` is set when Yungu answered with a redirect (usually to the login page). */
export class YunguError extends Error {
  status?: number;
  body?: unknown;
  redirect?: string;

  constructor(message: string, extra: { status?: number; body?: unknown; redirect?: string } = {}) {
    super(message);
    this.name = 'YunguError';
    this.status = extra.status;
    this.body = extra.body;
    this.redirect = extra.redirect;
  }
}

/**
 * True if a task.yungu.org JSON body says the login session is gone: `ifLogin: false` or `code: 1000`,
 * or the message service's `unauthorized: true`. Port of `yungu_task.session_expired`.
 */
export function sessionExpired(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const b = body as Record<string, unknown>;
  return b.ifLogin === false || b.code === 1000 || b.unauthorized === true;
}

type Cookie = { name: string; value: string; domain: string; hostOnly: boolean; path: string; expires?: number };

function defaultPath(pathname: string): string {
  if (!pathname.startsWith('/')) return '/';
  const i = pathname.lastIndexOf('/');
  return i <= 0 ? '/' : pathname.slice(0, i);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

function domainMatches(host: string, c: Cookie): boolean {
  return c.hostOnly ? host === c.domain : host === c.domain || host.endsWith('.' + c.domain);
}

/** Set-Cookie values of a response. Falls back to splitting a combined header where `getSetCookie` is empty. */
function setCookies(res: Response): string[] {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (list.length > 0) return list;
  const combined = res.headers.get('set-cookie');
  // Split on commas that start a new `name=` pair, not the comma inside `Expires=Wed, 01 Jan ...`.
  return combined ? combined.split(/,(?=\s*[^;,=\s]+=)/) : [];
}

/** Host- and path-scoped cookies. Enough for Yungu's CAS and SESSION cookies; not a full RFC 6265 jar. */
export class CookieJar {
  private cookies: Cookie[] = [];

  store(url: string, res: Response): void {
    const u = new URL(url);
    for (const raw of setCookies(res)) {
      const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const cookie: Cookie = {
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
        domain: u.hostname,
        hostOnly: true,
        path: defaultPath(u.pathname),
      };
      let maxAge: number | undefined;
      let expires: number | undefined;
      for (const attr of attrs) {
        const j = attr.indexOf('=');
        const key = (j < 0 ? attr : attr.slice(0, j)).toLowerCase();
        const val = j < 0 ? '' : attr.slice(j + 1);
        if (key === 'domain' && val) {
          const d = val.replace(/^\./, '').toLowerCase();
          if (u.hostname === d || u.hostname.endsWith('.' + d)) {
            cookie.domain = d;
            cookie.hostOnly = false;
          } else {
            cookie.name = ''; // a domain the host may not set: drop the cookie
          }
        } else if (key === 'path' && val.startsWith('/')) cookie.path = val;
        else if (key === 'max-age' && /^-?\d+$/.test(val)) maxAge = Number(val);
        else if (key === 'expires') {
          const t = Date.parse(val);
          if (!Number.isNaN(t)) expires = t;
        }
      }
      if (!cookie.name) continue;
      // Max-Age wins over Expires.
      if (maxAge !== undefined) cookie.expires = maxAge <= 0 ? 0 : Date.now() + maxAge * 1000;
      else if (expires !== undefined) cookie.expires = expires;
      this.cookies = this.cookies.filter(
        (c) => !(c.name === cookie.name && c.domain === cookie.domain && c.hostOnly === cookie.hostOnly && c.path === cookie.path),
      );
      if (cookie.expires === undefined || cookie.expires > Date.now()) this.cookies.push(cookie);
    }
  }

  /** The `Cookie` request header value for `url`, or '' when none applies. */
  header(url: string): string {
    const u = new URL(url);
    const now = Date.now();
    this.cookies = this.cookies.filter((c) => c.expires === undefined || c.expires > now);
    return this.cookies
      .filter((c) => domainMatches(u.hostname, c) && pathMatches(u.pathname || '/', c.path))
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  clear(): void {
    this.cookies = [];
  }
}
