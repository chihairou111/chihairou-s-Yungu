/**
 * Where the window may go. Only the local server's own pages load inside it; ordinary web links open in
 * the user's browser; every other scheme (file:, javascript:, smb:, custom protocols…) goes nowhere.
 */

/** True when `url` is a page of the app: the same scheme and port as `origin`, on 127.0.0.1. */
export function isAppUrl(url: string, origin: string): boolean {
  let u: URL;
  let o: URL;
  try {
    u = new URL(url);
    o = new URL(origin);
  } catch {
    return false;
  }
  return (
    u.protocol === o.protocol &&
    u.hostname === '127.0.0.1' &&
    u.port === o.port &&
    u.port !== '' &&
    u.username === '' &&
    u.password === ''
  );
}

/**
 * This machine itself: 127.0.0.0/8, `localhost` (and `*.localhost`), `[::1]`, `0.0.0.0`. `hostname` is
 * WHATWG-normalised (lower case, IPv4 shorthands expanded, IPv6 in brackets).
 */
function isLoopback(hostname: string): boolean {
  return (
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0'
  );
}

/**
 * For a link that is not an app page: open it in the browser (http/https) or do nothing. Other servers
 * on this machine are blocked too: a link must not reach them through the browser.
 */
export function externalTarget(url: string): 'browser' | 'block' {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return 'block';
    return isLoopback(hostname) ? 'block' : 'browser';
  } catch {
    return 'block';
  }
}

/** Yungu's own file storage, where a file link (`/api/files/<id>`) redirects to a signed address. */
const FILE_STORAGE_HOSTS = new Set(['yungu-common.oss-cn-hangzhou.aliyuncs.com', 'yungu-public.oss-cn-hangzhou.aliyuncs.com']);

/**
 * Where a window's redirect may go: on within the app (`app`); a signed file address on Yungu's file
 * storage is downloaded (`download`: the Save dialog, and Suspension Mode's gate); any other address
 * leaves the window for the browser or goes nowhere, as `externalTarget` says.
 */
export function redirectTarget(url: string, origin: string): 'app' | 'download' | 'browser' | 'block' {
  if (isAppUrl(url, origin)) return 'app';
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && FILE_STORAGE_HOSTS.has(u.hostname) && u.username === '' && u.password === '' && u.port === '') {
      return 'download';
    }
  } catch {
    return 'block';
  }
  return externalTarget(url);
}
