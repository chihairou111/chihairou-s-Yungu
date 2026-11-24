/** What the Yungu service answers when our session token is no longer valid. */
export const SIGN_IN_AGAIN = 'Sign in again.';
/** The service's 401 when an automatic re-login was rejected; it has forgotten the saved password. */
export const PASSWORD_CHANGED = 'Sign in again — your Yungu password may have changed.';
/** Yungu (or the service in front of it) is down, slow or answering nonsense. */
export const YUNGU_UNAVAILABLE = "Can't reach Yungu right now. Try again.";
/** The desktop app's sign-in page while its startup sign-in cannot reach Yungu and keeps trying by itself. */
export const SIGN_IN_RETRYING = "Can't reach Yungu right now — trying again.";
/** The local app could not reach Yungu's OSS file storage (a network that blocks it). */
export const FILE_STORAGE_UNREACHABLE = "Can't reach Yungu's file storage from this network.";

/** A failed call to the Yungu service: its HTTP status and the message to show. */
export class ServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
  }
}

/** 401: our session is over (signed out, or the saved Yungu password stopped working); sign in again. */
export class SessionEnded extends ServiceError {
  constructor(message: string = SIGN_IN_AGAIN) {
    super(401, message);
    this.name = 'SessionEnded';
  }
}

/** 502: the service could not reach Yungu, or we could not reach the service. */
export class YunguUnavailable extends ServiceError {
  constructor(message: string = YUNGU_UNAVAILABLE) {
    super(502, message);
    this.name = 'YunguUnavailable';
  }
}

/**
 * The desktop app's Suspension Mode refused (or cut off) a Yungu request: the Mac is on a Wi-Fi that is
 * not allowed. A YunguUnavailable, so pages show their usual "Can't reach Yungu" state under the
 * Suspension Mode screen, never a file-storage or sign-in message.
 */
export class Suspended extends YunguUnavailable {
  constructor() {
    super();
    this.name = 'Suspended';
  }
}

/** True for the desktop shell's fetch-gate error (`name: 'Suspended'`), itself or as an error's cause. */
export function isSuspension(e: unknown): boolean {
  for (let cur = e, depth = 0; cur && typeof cur === 'object' && depth < 5; cur = (cur as { cause?: unknown }).cause, depth++) {
    if ((cur as { name?: unknown }).name === 'Suspended') return true;
  }
  return false;
}

/** 404 on deleting a comment that is not the student's own (someone else's, or none by that id). */
export class CommentNotFound extends ServiceError {
  constructor() {
    super(404, 'Comment not found');
    this.name = 'CommentNotFound';
  }
}

/** 404 on a write keyed by an assignment id the service does not know. */
export class AssignmentNotFound extends ServiceError {
  constructor(message = 'Not found.') {
    super(404, message);
    this.name = 'AssignmentNotFound';
  }
}

/** 409 on updating an online document that was handed in: the teacher's copy is never edited in place. */
export class DocumentHandedIn extends ServiceError {
  constructor(message = 'This document was handed in — save it as a new one.') {
    super(409, message);
    this.name = 'DocumentHandedIn';
  }
}

/** 413 on an online document over Yungu's limit; the message says about how much to cut. */
export class DocumentTooLong extends ServiceError {
  constructor(message: string) {
    super(413, message);
    this.name = 'DocumentTooLong';
  }
}
