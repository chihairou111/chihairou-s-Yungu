import { timingSafeEqual } from 'node:crypto';

/** The cookie the desktop shell sets in its window; its value is the per-launch `YUNGU_LOCAL_SECRET`. */
export const LOCAL_COOKIE = 'yl_local';

/** True when the local lock is on (the desktop shell sets the secret; hosted and tests do not). */
export function localLockOn(): boolean {
  return !!process.env.YUNGU_LOCAL_SECRET;
}

/** Whether `value` is the launch secret. Always true when the lock is off. Compared in constant time. */
export function localUnlocked(value: string | undefined | null): boolean {
  const secret = process.env.YUNGU_LOCAL_SECRET;
  if (!secret) return true;
  if (!value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `yl_local`'s value in a `Cookie` header, or undefined. */
export function localCookieFrom(header: string | null | undefined): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === LOCAL_COOKIE) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** For a Route Handler the proxy cannot cover (the upload route): same check, from the raw request. */
export function localLockDenied(request: Request): boolean {
  return !localUnlocked(localCookieFrom(request.headers.get('cookie')));
}
