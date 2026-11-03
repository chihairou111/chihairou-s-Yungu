/**
 * The consent page's shared rules (`/oauth/authorize`, the approve route): which query fields an agent's
 * authorization request carries on to the service, and where the browser may be sent afterwards. The
 * service checks the request itself (client, registered redirect URI, PKCE, resource); nothing here
 * decides that a request is valid, only that nothing unchecked is ever followed.
 */
export const AUTHORIZE_FIELDS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'state',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'resource',
] as const;

export type AuthorizeField = (typeof AUTHORIZE_FIELDS)[number];
/** The authorization request as the agent sent it; a field it left out is ''. */
export type AuthorizeParams = Record<AuthorizeField, string>;
export type AuthorizeDecision = 'allow' | 'deny';

/** The agent's request is malformed in a way that must not be passed on (a field twice, or not text). */
export const BAD_AUTHORIZE_REQUEST = "This agent's request isn't valid. Start connecting again from the agent.";

type Query = URLSearchParams | Record<string, unknown>;

/**
 * The authorization fields of a query (page `searchParams`, or a request body), each passed on as is;
 * null when one is given twice (RFC 6749 §3.1: parameters must not repeat) or is not a string.
 */
export function authorizeParams(query: Query): AuthorizeParams | null {
  const params = {} as AuthorizeParams;
  for (const field of AUTHORIZE_FIELDS) {
    let value: unknown;
    if (query instanceof URLSearchParams) {
      const all = query.getAll(field);
      if (all.length > 1) return null;
      value = all[0];
    } else {
      value = Object.hasOwn(query, field) ? query[field] : undefined;
    }
    if (value === undefined) value = '';
    if (typeof value !== 'string') return null;
    params[field] = value;
  }
  return params;
}

/** The host a URL sends the browser to, as the service names it (lowercase, IPv6 without brackets); null if it is no URL. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
  } catch {
    return null;
  }
}

/** The redirect goes to the host the consent page showed. */
export function sameHost(url: string, host: string): boolean {
  const target = hostOf(url);
  return target !== null && target === host.toLowerCase();
}

/** An absolute http(s) URL: the only kind of place the consent page ever sends the browser. */
export function isWebRedirect(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** The consent question, word for word. */
export function consentText(clientName: string): string {
  return `Allow ${clientName} to read your Yungu assignments, schedule, feedback, points and notifications? It can't hand in, comment or change anything.`;
}
