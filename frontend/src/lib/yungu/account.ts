import { randomUUID } from 'node:crypto';
import { PASSWORD_CHANGED, ServiceError, SessionEnded, YunguUnavailable } from '../data/errors';
import { YunguClient } from './client';
import { YunguError, sessionExpired, type Fetch } from './http';
import { LocalState } from './state';

/**
 * The one local Yungu account: its session, saved credentials (in memory; Task 6's bridge keeps them in
 * the keychain via `onCredentials`), read cache, known file ids and hand-in record. Port of the owner's
 * session in `api/service/yungu.py` (`OwnerSession`, `is_expired`, `_rejected`) and `ReadCache` in
 * `api/service/cache.py`, for one account: no tokens on disk, no throttling, no other accounts.
 */

export const WRONG_LOGIN = 'Wrong student ID or password.';
/** After a failed re-login no new one is tried for this long: an outage never becomes a login per request. */
export const LOGIN_RETRY_MS = 30_000;
export const CACHE_TTL_MS = 60_000;
export const CACHE_MAX_ENTRIES = 300;

export type Credentials = { loginId: string; password: string };
type MakeClient = (loginId: string, password: string, fetch: Fetch) => YunguClient;

/** The sign-in itself was turned away: wrong student ID or password. */
export class SignInRefused extends Error {
  constructor() {
    super(WRONG_LOGIN);
    this.name = 'SignInRefused';
  }
}

/** Thrown by callers that spot expiry themselves (a file link that points at the login page). */
export class SessionExpired extends Error {
  constructor() {
    super('Yungu session expired');
    this.name = 'SessionExpired';
  }
}

/** Yungu's login page (where it sends a session it no longer knows). Port of `is_login_url`. */
export function isLoginUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  return host.startsWith('login.') || path.includes('/cas/login') || path.replace(/\/+$/, '').endsWith('/login');
}

/** Yungu says the session is gone: `ifLogin: false` / `code: 1000` in a body, or a redirect to the login page. */
export function isExpired(e: unknown): boolean {
  if (e instanceof SessionExpired) return true;
  if (!(e instanceof YunguError)) return false;
  if (e.status !== undefined && e.status >= 300 && e.status < 400) return e.redirect !== undefined && isLoginUrl(e.redirect);
  return sessionExpired(e.body);
}

/** The CAS login answered, well-formed (2xx JSON), without success: wrong ID or password. Port of `_rejected`. */
function rejected(e: unknown): boolean {
  if (!(e instanceof YunguError) || !e.message.startsWith('login failed')) return false;
  if (e.status === undefined || e.status < 200 || e.status >= 300) return false;
  const body = e.body;
  return typeof body === 'object' && body !== null && !Array.isArray(body) && !(body as { success?: unknown }).success;
}

/** Yungu's JSON `code` behind a YunguError (an HTTP 200 answer with code != 0), else undefined. */
export function errorCode(e: unknown): unknown {
  if (!(e instanceof YunguError)) return undefined;
  const body = e.body;
  return typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
}

/** Any failure that is not already one of ours becomes "Can't reach Yungu" (502). */
export function asServiceError(e: unknown): ServiceError {
  return e instanceof ServiceError ? e : new YunguUnavailable();
}

function displayName(user: Record<string, unknown>, loginId: string): string {
  for (const key of ['eName', 'userEname', 'englishName', 'userName', 'name']) {
    const value = user[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return loginId;
}

/**
 * Read cache: one entry per key, 60 s, cleared by any write or Refresh. A value computed across a
 * `clear()` is returned but not stored, so a read racing a write cannot put pre-write data back. Expired
 * entries go whenever a value is stored, and it never holds more than `max` (closest to expiry go first).
 */
export class ReadCache {
  private items = new Map<string, { expires: number; value: unknown }>();
  private generation = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly max = CACHE_MAX_ENTRIES,
  ) {}

  async get<T>(key: string, compute: () => Promise<T>, refresh = false): Promise<T> {
    const generation = this.generation;
    const hit = refresh ? undefined : this.items.get(key);
    if (hit && hit.expires > this.now()) return hit.value as T;
    const value = await compute();
    if (this.generation === generation) {
      const now = this.now();
      for (const [k, v] of this.items) if (v.expires <= now || k === key) this.items.delete(k);
      while (this.items.size >= this.max) {
        let oldest: string | null = null;
        let at = Infinity;
        for (const [k, v] of this.items) if (v.expires < at) [oldest, at] = [k, v.expires];
        this.items.delete(oldest!);
      }
      this.items.set(key, { expires: now + CACHE_TTL_MS, value });
    }
    return value;
  }

  get size(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
    this.generation += 1;
  }
}

export class LocalAccount {
  readonly cache: ReadCache;
  /** File ids this account was shown (its own reads) or made (uploads, documents): the only ones it may use. */
  readonly knownFiles = new Set<string>();
  readonly state: LocalState;
  /** Called with the credentials after a sign-in, and with null when they must be forgotten. */
  onCredentials?: (c: Credentials | null) => void;

  private readonly fetch: Fetch;
  /** The clock (ms) every timestamp this account makes comes from. */
  readonly now: () => number;
  private readonly makeClient: MakeClient;
  private creds: Credentials | null = null;
  private client: YunguClient | null = null;
  private userId: number | null = null;
  private displayName: string | null = null;
  private sessionToken: string | null = null;
  private relogin: Promise<YunguClient> | null = null;
  private failedAt: number | null = null; // last re-login that failed (not a rejection)
  private passwordRejected = false;
  private epoch = 0; // bumped by sign-in / sign-out: a re-login started before is void

  constructor(opts: { fetch: Fetch; stateDir: string; now?: () => number; makeClient?: MakeClient }) {
    this.fetch = opts.fetch;
    this.now = opts.now ?? Date.now;
    this.makeClient = opts.makeClient ?? ((id, pw, f) => new YunguClient(id, pw, f, { now: this.now }));
    this.cache = new ReadCache(this.now);
    this.state = new LocalState(opts.stateDir);
  }

  token(): string | null {
    return this.sessionToken;
  }

  name(): string | null {
    return this.displayName;
  }

  /** Log in with a fresh client. A wrong ID or password is SignInRefused, anything else YunguUnavailable. */
  async signIn(loginId: string, password: string): Promise<{ name: string; token: string }> {
    const client = this.makeClient(loginId, password, this.fetch);
    let user: Record<string, unknown>;
    let userId: number;
    try {
      user = ((await client.login()) ?? {}) as Record<string, unknown>;
      userId = await client.userId();
    } catch (e) {
      if (rejected(e)) throw new SignInRefused();
      throw new YunguUnavailable();
    }
    if (this.userId !== userId) this.knownFiles.clear(); // another account's files are not this one's
    this.epoch += 1;
    this.creds = { loginId, password };
    this.client = client;
    this.userId = userId;
    this.displayName = displayName(user, loginId);
    this.sessionToken = randomUUID();
    this.relogin = null;
    this.failedAt = null;
    this.passwordRejected = false;
    this.cache.clear();
    this.onCredentials?.({ loginId, password });
    return { name: this.displayName, token: this.sessionToken };
  }

  /** Forget the account: credentials, session, cache and known files. The hand-in record stays on disk. */
  signOut(): void {
    this.forget();
    this.passwordRejected = false;
    this.onCredentials?.(null);
  }

  private forget(): void {
    this.epoch += 1;
    this.creds = null;
    this.client = null;
    this.sessionToken = null;
    this.displayName = null;
    this.relogin = null;
    this.failedAt = null;
    this.cache.clear();
    this.knownFiles.clear();
  }

  /**
   * Run `fn` with the current client. If Yungu says the session is gone, log in again (once, shared by
   * every caller that saw the expiry) and retry `fn` once. A rejected password signs out and throws
   * SessionEnded(PASSWORD_CHANGED); any other failure is YunguUnavailable. ServiceErrors pass through.
   */
  async call<T>(fn: (c: YunguClient) => Promise<T>): Promise<T> {
    const client = this.client;
    if (!client) throw new SessionEnded(this.passwordRejected ? PASSWORD_CHANGED : undefined);
    try {
      return await fn(client);
    } catch (e) {
      if (!isExpired(e)) throw asServiceError(e);
    }
    const fresh = await this.loginAgain(client);
    try {
      return await fn(fresh);
    } catch (e) {
      throw asServiceError(e); // expired again right after a login: not retried again
    }
  }

  /** A working client for a caller whose `stale` client was turned away. */
  private loginAgain(stale: YunguClient): Promise<YunguClient> {
    if (this.client && this.client !== stale) return Promise.resolve(this.client); // someone already did
    if (this.relogin) return this.relogin;
    if (!this.client || !this.creds) {
      return Promise.reject(new SessionEnded(this.passwordRejected ? PASSWORD_CHANGED : undefined));
    }
    if (this.failedAt !== null && this.now() - this.failedAt < LOGIN_RETRY_MS) return Promise.reject(new YunguUnavailable());
    const attempt = this.attempt(this.creds, this.epoch);
    this.relogin = attempt;
    const done = () => {
      if (this.relogin === attempt) this.relogin = null;
    };
    attempt.then(done, done);
    return attempt;
  }

  private async attempt(creds: Credentials, epoch: number): Promise<YunguClient> {
    // A new client, never the old one's jar cleared: a call still running on it keeps its cookies.
    const client = this.makeClient(creds.loginId, creds.password, this.fetch);
    let failure: ServiceError | null = null;
    let wasRejected = false;
    try {
      await client.login();
      if ((await client.userId()) !== this.userId) failure = new YunguUnavailable(); // someone else's login: never use it
    } catch (e) {
      wasRejected = rejected(e);
      failure = wasRejected ? new SessionEnded(PASSWORD_CHANGED) : new YunguUnavailable();
    }
    if (epoch !== this.epoch) {
      // Signed in or out meanwhile: this result is void.
      if (!this.client) throw new SessionEnded();
      return this.client;
    }
    if (!failure) {
      this.client = client;
      this.failedAt = null;
      return client;
    }
    if (wasRejected) {
      this.forget();
      this.passwordRejected = true;
      this.onCredentials?.(null);
    } else {
      this.failedAt = this.now();
    }
    throw failure;
  }
}
