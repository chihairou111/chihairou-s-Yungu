/**
 * The app's session cookie, as the frontend writes it (`frontend/src/lib/session-cookie.ts`, pinned by a
 * test): `yl_session` = base64url(JSON {name, token}). The shell sets it after the startup sign-in.
 */
export const SESSION_COOKIE = 'yl_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
/** The sign-in page's notice; `password` reads "Sign in again — your Yungu password may have changed." */
export const SIGN_IN_NOTICE_COOKIE = 'yl_signin_notice';
/** The notice values the shell sets (the frontend's `NOTICES` keys, pinned by a test). */
export const NOTICE_PASSWORD = 'password';
/** "Can't reach Yungu right now — trying again.": the startup sign-in is being retried. */
export const NOTICE_UNREACHABLE = 'unreachable';
export const NOTICE_MAX_AGE = 5 * 60;
/** The per-launch lock cookie; its value is `YUNGU_LOCAL_SECRET`. */
export const LOCAL_COOKIE = 'yl_local';

export function encodeSession(name: string, token: string): string {
  return Buffer.from(JSON.stringify({ name, token })).toString('base64url');
}
