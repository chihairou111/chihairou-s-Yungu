"""One Yungu session per signed-in account (keyed by Yungu userId), each with its own locks.

Every Yungu call goes through `Yungu.call(user_id, fn)`: fn gets that account's current client, never
another's. If Yungu says the session is gone (`ifLogin: false`, `code: 1000`, or a redirect to the login
page):
* the owner's session signs in again with the saved password, once, under the owner's login lock
  (concurrent callers that saw the same expiry wait and reuse the new session), and retries fn once. If
  Yungu rejects the saved password, the password and the owner's tokens are dropped and the caller gets
  PasswordChanged; nothing is retried.
* any other account's session ends (its password was never kept): the caller gets SignInAgain, the
  account's tokens stop working, and no login is attempted.
Any other failure (network, 5xx, non-JSON, an unexpected payload) becomes Unavailable (HTTP 502).
"""
import logging
import threading
import time
from typing import Callable, Dict, Optional, Tuple, TypeVar
from urllib.parse import urlparse

from yungu_task import YunguError, session_expired

from .auth import Auth, Credentials

log = logging.getLogger("yungu_lms.yungu")
T = TypeVar("T")

SIGN_IN_AGAIN = "Sign in again."
PASSWORD_CHANGED = "Sign in again — your Yungu password may have changed."
UNREACHABLE = "Can't reach Yungu right now. Try again."
WRONG_LOGIN = "Wrong student ID or password."
LOGIN_RETRY_SECONDS = 30.0
IDLE_SECONDS = 12 * 3600.0          # an account other than the owner unused this long is signed out
SWEEP_SECONDS = 60.0                # idle accounts are looked for at most this often


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
def _forget_password(client) -> None:
    """A client keeps the password it was built with only to log in once; after that it goes."""
    if hasattr(client, "password"):
        client.password = None


def _logged_in(client) -> Tuple[dict, int]:
    """Log `client` in: (Yungu's user, userId). A wrong ID or password is SignInRefused, anything else
    Unavailable. The client's copy of the password is dropped either way."""
    try:
        user = client.login()
        user_id = client.user_id
    except Exception as e:
        if _rejected(e):
            raise SignInRefused(str(_body(e).get("msg") or WRONG_LOGIN)) from None
        raise _unavailable(e, "sign-in") from None
    finally:
        _forget_password(client)
    return user or {}, user_id


def _run(client, fn: Callable[[object], T], what: str) -> Tuple[bool, Optional[T]]:
    """(True, fn(client)), or (False, None) when Yungu says the session is gone."""
    try:
        return True, fn(client)
    except ServiceError:
        raise
    except Exception as e:
        if not is_expired(e):
            raise _unavailable(e, what) from None
    return False, None


class OwnerSession:
    """The owner's session. `_lock` guards the fields and is never held across network I/O; `_login_lock`
    makes logins single-flight. Every caller snapshots `_attempts` before it may need a login; when it
    gets the login lock and an attempt has happened since, it shares that attempt's result (new client, or
    the same failure) instead of trying again. After a failed attempt no new one is made for
    LOGIN_RETRY_SECONDS: requests in that window get 502 straight away, so an outage (or an answer we
    misread) can never turn into a login per request."""

    def __init__(self, user_id: int, auth: Auth, client_factory: Callable[[str, str], object],
                 clock: Callable[[], float]):
        self.user_id = user_id
        self._auth = auth
        self._factory = client_factory
        self._clock = clock
        self._lock = threading.Lock()
        self._login_lock = threading.Lock()
        self._client = None             # the owner's YunguTask; replaced (not mutated) on every login
        self._attempts = 0              # logins tried (and sign-ins), for sharing results
        self._failure = None            # ServiceError class of the latest attempt, if it failed
        self._failed_at = 0.0
        self._epoch = 0                 # bumped by sign-in / sign-out: a login started before is void
        self._rejected = False          # the saved password was refused since the last sign-in

    def call(self, fn: Callable[[object], T]) -> T:
        client, seen = self._session()
        done, value = _run(client, fn, "Yungu call")
        if done:
            return value
        log.info("Yungu session expired; signing in again")
        client, _ = self._login(seen)
        try:
            return fn(client)
        except ServiceError:
            raise
        except Exception as e:
            raise _unavailable(e, "Yungu call after re-login") from None

    def signed_in(self, client, creds: Credentials) -> None:
        with self._lock:
            self._auth.remember(creds.login_id, creds.password)
            self._install(client)
            self._epoch += 1
            self._rejected = False

    def sign_out(self) -> None:
        with self._lock:
            self._auth.forget()
            self._client = None
            self._failure = None
            self._epoch += 1
            self._rejected = False

    def live(self) -> bool:
        return True                     # the saved password (if any) is what decides; see _login

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
            del creds
            try:
                client.login()
                if client.user_id != self.user_id:          # the saved login is someone else's: never use it
                    log.warning("the saved login belongs to another account; not using it")
                    failure = Unavailable
            except Exception as e:
                rejected = _rejected(e)
                failure = PasswordChanged if rejected else type(_unavailable(e, "re-login"))
            finally:
                _forget_password(client)
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


class MemorySession:
    """Any other account's session: the client from its sign-in, kept in memory only. No password, so
    no re-login: when Yungu says the session is gone it ends (`on_end`), and so does every request until
    the account signs in again. `_lock` guards `_client` only; calls run outside it."""

    def __init__(self, user_id: int, on_end: Callable[[int], None], clock: Callable[[], float]):
        self.user_id = user_id
        self._on_end = on_end
        self._clock = clock
        self._lock = threading.Lock()
        self._client = None
        self._used = clock()

    def call(self, fn: Callable[[object], T]) -> T:
        with self._lock:
            client = self._client
            self._used = self._clock()
        if client is None:
            raise SignInAgain()
        done, value = _run(client, fn, "Yungu call")
        if done:
            return value
        log.info("Yungu session of an account without a saved password expired; it must sign in again")
        self.end(client)
        raise SignInAgain()

    def signed_in(self, client) -> None:
        with self._lock:
            self._client = client
            self._used = self._clock()

    def end(self, client=None) -> None:
        """Sign-out (any client), or expiry of `client` (only while it is still the current one: a newer
        sign-in is left alone). Under the lock, so a sign-in cannot slip between the end and `on_end`."""
        with self._lock:
            if client is not None and client is not self._client:
                return
            self._client = None
            self._on_end(self.user_id)

    def sign_out(self) -> None:
        self.end()

    def live(self) -> bool:
        with self._lock:
            self._used = self._clock()
            return self._client is not None

    def ended_if_idle(self, since: float) -> bool:
        """Unused since before `since`: end it (if it is still on) and answer True, so it can go."""
        with self._lock:
            if self._used >= since:
                return False
            if self._client is not None:
                self._client = None
                self._on_end(self.user_id)
            return True


class Yungu:
    """Every account's session, by Yungu userId. `_lock` guards `_sessions` only (never network I/O), so
    one account's slow login or call never holds up another's."""

    def __init__(self, auth: Auth, client_factory: Callable[[str, str], object],
                 clock: Callable[[], float] = time.monotonic, on_end: Callable[[int], None] = lambda uid: None):
        self._auth = auth
        self._factory = client_factory
        self._clock = clock
        self._on_end = on_end           # an account other than the owner ended (expiry or sign-out)
        self._lock = threading.Lock()
        self._sessions: Dict[int, object] = {}
        self._swept = clock()

    def _get(self, user_id: int):
        owner = self._auth.owner()
        with self._lock:
            return self._get_locked(user_id, owner)

    def _get_locked(self, user_id: int, owner: Optional[int]):
        """The account's session; the owner's is made on first use (after a restart it logs in lazily
        with the saved password), another account's only exists from its sign-in on."""
        session = self._sessions.get(user_id)
        if session is None or isinstance(session, OwnerSession) != (user_id == owner):
            if user_id == owner:
                session = OwnerSession(user_id, self._auth, self._factory, self._clock)
            else:
                session = MemorySession(user_id, self._ended, self._clock)
            self._sessions[user_id] = session
        return session

    def sweep(self) -> None:
        """At most every SWEEP_SECONDS: sign out and forget every account other than the owner that has
        not been used for IDLE_SECONDS. The owner's session is never swept."""
        now = self._clock()
        with self._lock:
            if now - self._swept < SWEEP_SECONDS:
                return
            self._swept = now
            for user_id, session in list(self._sessions.items()):
                if isinstance(session, MemorySession) and session.ended_if_idle(now - IDLE_SECONDS):
                    del self._sessions[user_id]

    def _ended(self, user_id: int) -> None:
        self._auth.drop_tokens(user_id)
        self._on_end(user_id)

    def call(self, user_id: int, fn: Callable[[object], T]) -> T:
        return self._get(user_id).call(fn)

    def live(self, user_id: int) -> bool:
        return self._get(user_id).live()

    def sign_in(self, login_id: str, password: str) -> Tuple[int, dict]:
        """Log in with a fresh client (outside every lock); on success it becomes that account's session.
        The password is saved only when the account is the owner. Returns (userId, Yungu's user)."""
        client = self._factory(login_id, password)
        user, user_id = _logged_in(client)
        is_owner = self._auth.claim_owner(login_id, user_id)
        owner = self._auth.owner()
        with self._lock:                    # installed in the session the registry holds, never a swept one
            session = self._get_locked(user_id, owner)
            if is_owner:
                session.signed_in(client, Credentials(login_id, password))
            else:
                session.signed_in(client)
        return user_id, user

    def sign_out(self, user_id: int) -> None:
        self._get(user_id).sign_out()
