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
    """The CAS login answered with JSON `success: false` (wrong ID or password)."""
    body = _body(e)
    return isinstance(body, dict) and body.get("success") is False


def _describe(e: Exception) -> str:
    """Safe for logs: YunguError messages are built from method/path/code; anything else (requests
    errors can quote URLs carrying a login ticket) is logged by type only."""
    if isinstance(e, YunguError) and not str(e).startswith("login"):
        return f"{type(e).__name__}: {e}"
    return type(e).__name__


def _unavailable(e: Exception, what: str) -> Unavailable:
    log.warning("%s failed: %s", what, _describe(e))
    return Unavailable()


# ------------------------------------------------------------------ session
class Yungu:
    def __init__(self, auth: Auth, client_factory: Callable[[str, str], object]):
        self._auth = auth
        self._factory = client_factory
        self._lock = threading.Lock()
        self._client = None             # the shared YunguTask; replaced (not mutated) on every login
        self._generation = 0            # bumped on every successful login
        self._rejected = False          # the saved password was refused since the last sign-in

    def call(self, fn: Callable[[object], T]) -> T:
        client, generation = self._session()
        try:
            return fn(client)
        except ServiceError:
            raise
        except Exception as e:
            if not is_expired(e):
                raise _unavailable(e, "Yungu call") from None
        log.info("Yungu session expired; signing in again")
        client = self._relogin(generation)
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
                body = _body(e)
                raise SignInRefused(str(body.get("msg") or WRONG_LOGIN)) from None
            raise _unavailable(e, "sign-in") from None
        owner = self._auth.owner()
        if owner is not None and owner != user_id:
            raise SignInRefused(ANOTHER_ACCOUNT)
        with self._lock:
            self._auth.remember(login_id, password, user_id)
            self._client = client
            self._generation += 1
            self._rejected = False
        return user or {}

    def sign_out(self) -> None:
        with self._lock:
            self._auth.forget()
            self._client = None
            self._rejected = False

    # ------------------------------------------------------------- internals
    def _session(self):
        with self._lock:
            if self._client is None:    # first use after a restart: sign in with the saved password
                self._login_locked()
            return self._client, self._generation

    def _relogin(self, seen_generation: int):
        with self._lock:
            if self._generation == seen_generation:      # nobody has logged in since this caller's attempt
                self._login_locked()
            return self._client

    def _login_locked(self) -> None:
        creds = self._auth.credentials()
        if creds is None:
            raise PasswordChanged() if self._rejected else SignInAgain()
        client = self._factory(creds.login_id, creds.password)
        try:
            client.login()
        except Exception as e:
            if _rejected(e):
                log.warning("saved Yungu password was rejected; forgetting it and all tokens")
                self._auth.forget()
                self._client = None
                self._rejected = True
                raise PasswordChanged() from None
            raise _unavailable(e, "re-login") from None
        self._client = client
        self._generation += 1
