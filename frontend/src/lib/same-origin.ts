/**
 * Writes come only from this site's own pages: the check every non-GET `/api/*` request passes (the proxy
 * runs it) before any Route Handler sees it. The session cookie is SameSite=Lax, which already keeps it
 * off cross-site POSTs; this is the second lock, so a same-site page elsewhere, or a browser that sends
 * the cookie anyway, can't make a token, hand in or comment on the student's behalf.
 *
 * - `Sec-Fetch-Site`, when the browser sends it, must be `same-origin`.
 * - `Origin`, when sent, must name this host (as nginx passes it on: `X-Forwarded-Host`, else `Host`).
 * - The body must be JSON, or none at all. A form or a `text/plain` post (what another page can send
 *   without a CORS preflight) is refused. `multipart/form-data` (the dashboard's file uploads) is let
 *   through only when the browser vouches for it: `Sec-Fetch-Site: same-origin` and a matching `Origin`.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface WriteCheck {
  /** Also refuse multipart (the consent page's Allow / Deny takes JSON only). */
  jsonOnly?: boolean;
}

function ownHost(request: Request): string {
  return request.headers.get('x-forwarded-host')?.split(',')[0].trim() || request.headers.get('host') || new URL(request.url).host;
}

function originMatches(origin: string, request: Request): boolean {
  try {
    return new URL(origin).host === ownHost(request);
  } catch {
    return false; // includes `Origin: null`
  }
}

/** True when the request may go ahead: a read, or a write from this site's own pages. */
export function isSameOriginWrite(request: Request, { jsonOnly = false }: WriteCheck = {}): boolean {
  if (SAFE_METHODS.has((request.method ?? 'POST').toUpperCase())) return true;
  const site = request.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (origin !== null && !originMatches(origin, request)) return false;
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  if (type === 'application/json') return true;
  if (type === '') return !jsonOnly && !hasBody(request);
  if (type === 'multipart/form-data') return !jsonOnly && site === 'same-origin' && origin !== null;
  return false;
}

/** A body is on its way (declared length above zero, or chunked). */
function hasBody(request: Request): boolean {
  const length = request.headers.get('content-length');
  if (request.headers.has('transfer-encoding')) return true;
  return length !== null && length !== '0';
}
