/** What the Yungu service answers when our session token is no longer valid. */
export const SIGN_IN_AGAIN = 'Sign in again.';
/** The service's 401 when an automatic re-login was rejected; it has forgotten the saved password. */
export const PASSWORD_CHANGED = 'Sign in again — your Yungu password may have changed.';
/** Yungu (or the service in front of it) is down, slow or answering nonsense. */
export const YUNGU_UNAVAILABLE = "Can't reach Yungu right now. Try again.";

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

/** 404 on a write keyed by an assignment id the service does not know. */
export class AssignmentNotFound extends ServiceError {
  constructor(message = 'Not found.') {
    super(404, message);
    this.name = 'AssignmentNotFound';
  }
}
