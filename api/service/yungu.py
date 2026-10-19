"""The one Yungu session the service shares, with single-flight automatic re-login.

Every Yungu call goes through `Yungu.call(fn)`: fn gets the current client. If Yungu says the session
is gone (`ifLogin: false`, `code: 1000`, or a redirect to the login page), the service signs in again
with the saved password, once, under one lock (concurrent callers that saw the same expiry wait and
reuse the new session), and retries fn once. If Yungu rejects the saved password, the password and
every dashboard token are dropped and the caller gets PasswordChanged; nothing is retried.
Any other failure (network, 5xx, non-JSON, an unexpected payload) becomes Unavailable (HTTP 502).
"""
import logging
import threading
import time
from typing import Callable, TypeVar
from urllib.parse import urlparse

from yungu_task import YunguError, session_expired

from .auth import Auth

log = logging.getLogger("yungu_lms.yungu")
T = TypeVar("T")

SIGN_IN_AGAIN = "Sign in again."
PASSWORD_CHANGED = "Sign in again — your Yungu password may have changed."
UNREACHABLE = "Can't reach Yungu right now. Try again."
ANOTHER_ACCOUNT = "This dashboard belongs to another account."
WRONG_LOGIN = "Wrong student ID or password."
LOGIN_RETRY_SECONDS = 30.0


class ServiceError(Exception):
    """An error with its HTTP status and the message the dashboard shows."""
    status = 500

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class SignInAgain(ServiceError):
    status = 401

    def __init__(self, message: str = SIGN_IN_AGAIN):
        super().__init__(message)


class PasswordChanged(SignInAgain):
    def __init__(self):
        super().__init__(PASSWORD_CHANGED)


class Unavailable(ServiceError):
    status = 502

    def __init__(self):
        super().__init__(UNREACHABLE)


class SignInRefused(Exception):
    """POST /session answered with {ok: false, error: message}."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class SessionExpired(Exception):
    """Raised by callers that spot expiry themselves (a file link that points at the login page)."""


# ------------------------------------------------------------ classification
def is_login_url(url: str) -> bool:
    p = urlparse(url or "")
    host = (p.hostname or "").lower()
    path = p.path.lower()
    return host.startswith("login.") or "/cas/login" in path or path.rstrip("/").endswith("/login")


def checked_redirect(url: str) -> str:
    """A preview/download Location, or SessionExpired when Yungu sent us to its login page instead."""
    if is_login_url(url):
        raise SessionExpired()
    return url


def _body(e: Exception):
    resp = getattr(e, "resp", None) if isinstance(e, YunguError) else None
    if resp is None:
        return None
    try:
        return resp.json()
    except ValueError:
        return None


def error_code(e: Exception):
    """Yungu's JSON `code` behind a YunguError (HTTP 200 answers with code != 0), else None."""
    body = _body(e)
    return body.get("code") if isinstance(body, dict) else None


def is_expired(e: Exception) -> bool:
    if isinstance(e, SessionExpired):
        return True
    resp = getattr(e, "resp", None) if isinstance(e, YunguError) else None
    if resp is None:
        return False
    if 300 <= resp.status_code < 400:
        return is_login_url(resp.headers.get("Location", ""))
    return session_expired(_body(e))


def _rejected(e: Exception) -> bool:
    """The CAS login itself answered, well-formed (HTTP 2xx, JSON), without success: wrong ID or password.

    Same rule as the client (`if not j.get("success")`, which raises "login failed: ..."); transport
    errors, 5xx, non-JSON, and failures after the CAS step (ticket exchange, currentUser) are not rejections."""
    resp = getattr(e, "resp", None) if isinstance(e, YunguError) else None
    if resp is None or not str(e).startswith("login failed") or not 200 <= resp.status_code < 300:
        return False
    body = _body(e)
    return isinstance(body, dict) and not body.get("success")


def _describe(e: Exception) -> str:
    """Safe for logs: exception type, plus for a YunguError the request method/path, HTTP status and
    JSON `code`. Never message text or response bodies (OSS error XML can carry STS key ids; requests
    errors can quote URLs carrying a login ticket)."""
    parts = [type(e).__name__]
    resp = getattr(e, "resp", None) if isinstance(e, YunguError) else None
    if resp is not None:
        req = getattr(resp, "request", None)
        if req is not None and getattr(req, "url", None):
            parts.append(f"{req.method} {urlparse(req.url).path}")
        parts.append(f"HTTP {resp.status_code}")
        body = _body(e)
        if isinstance(body, dict) and "code" in body:
            parts.append(f"code={body['code']!r}"[:40])
    return " ".join(parts)


def _unavailable(e: Exception, what: str) -> Unavailable:
    log.warning("%s failed: %s", what, _describe(e))
    return Unavailable()


# ------------------------------------------------------------------ session
class Yungu:
    """`_lock` guards the fields and is never held across network I/O; `_login_lock` makes logins
    single-flight. Every caller snapshots `_attempts` before it may need a login; when it gets the login
    lock and an attempt has happened since, it shares that attempt's result (new client, or the same
    failure) instead of trying again. After a failed attempt no new one is made for
    LOGIN_RETRY_SECONDS: requests in that window get 502 straight away, so an outage (or an answer we
    misread) can never turn into a login per request."""

    def __init__(self, auth: Auth, client_factory: Callable[[str, str], object],
                 clock: Callable[[], float] = time.monotonic):
        self._auth = auth
        self._factory = client_factory
        self._clock = clock
        self._lock = threading.Lock()
        self._login_lock = threading.Lock()
        self._client = None             # the shared YunguTask; replaced (not mutated) on every login
        self._attempts = 0              # logins tried (and sign-ins), for sharing results
        self._failure = None            # ServiceError class of the latest attempt, if it failed
        self._failed_at = 0.0
        self._epoch = 0                 # bumped by sign-in / sign-out: a login started before is void
        self._rejected = False          # the saved password was refused since the last sign-in

    def call(self, fn: Callable[[object], T]) -> T:
        client, seen = self._session()
        try:
            return fn(client)
        except ServiceError:
            raise
        except Exception as e:
            if not is_expired(e):
                raise _unavailable(e, "Yungu call") from None
        log.info("Yungu session expired; signing in again")
        client, _ = self._login(seen)
        try:
            return fn(client)
        except ServiceError:
            raise
        except Exception as e:
            raise _unavailable(e, "Yungu call after re-login") from None

    def sign_in(self, login_id: str, password: str) -> dict:
        """Log in with a fresh client; on success it becomes the shared session. Returns Yungu's user."""
        client = self._factory(login_id, password)
        try:
            user = client.login()
            user_id = client.user_id
        except Exception as e:
            if _rejected(e):
                raise SignInRefused(str(_body(e).get("msg") or WRONG_LOGIN)) from None
            raise _unavailable(e, "sign-in") from None
        owner = self._auth.owner()
        if owner is not None and owner != user_id:
            raise SignInRefused(ANOTHER_ACCOUNT)
        with self._lock:
            self._auth.remember(login_id, password, user_id)
            self._install(client)
            self._epoch += 1
            self._rejected = False
        return user or {}

    def sign_out(self) -> None:
        with self._lock:
            self._auth.forget()
            self._client = None
            self._failure = None
            self._epoch += 1
            self._rejected = False

    # ------------------------------------------------------------- internals
    def _install(self, client) -> None:
        self._client = client
        self._attempts += 1
        self._failure = None

    def _session(self):
        with self._lock:
            if self._client is not None:
                return self._client, self._attempts
            seen = self._attempts
        return self._login(seen)            # first use after a restart: sign in with the saved password

    def _login(self, seen: int):
        """A working client (and the attempt count it belongs to) for a caller that saw `seen` attempts."""
        with self._login_lock:
            with self._lock:
                if self._attempts != seen:                  # someone tried while this caller waited
                    if self._failure is not None:
                        raise self._failure()
                    if self._client is not None:
                        return self._client, self._attempts
                if self._failure is not None and self._clock() - self._failed_at < LOGIN_RETRY_SECONDS:
                    raise self._failure()
                creds = self._auth.credentials()
                if creds is None:
                    raise PasswordChanged() if self._rejected else SignInAgain()
                epoch = self._epoch
            client, rejected, failure = self._factory(creds.login_id, creds.password), False, None
            try:
                client.login()
            except Exception as e:
                rejected = _rejected(e)
                failure = PasswordChanged if rejected else type(_unavailable(e, "re-login"))
            with self._lock:
                if epoch != self._epoch:                    # signed in or out meanwhile: drop this result
                    if self._client is None:
                        raise SignInAgain()
                    return self._client, self._attempts
                if failure is None:
                    self._install(client)
                    return client, self._attempts
                self._attempts += 1
                self._failure, self._failed_at = failure, self._clock()
                if rejected:
                    log.warning("saved Yungu password was rejected; forgetting it and all tokens")
                    self._auth.forget()
                    self._client = None
                    self._rejected = True
                raise failure()
