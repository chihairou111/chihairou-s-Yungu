"""Todoist in the service: the OAuth connect, each account's sync status, the per-account sync guard and the
background schedule. The store and the engine are todoist_sync.py; the client is todoist.py.

* **Connect:** POST /todoist/connect makes a random `state` (kept hashed, in memory, bound to the signed-in
  account, single use, 10 min) and answers Todoist's authorize URL. POST /todoist/callback {code, state} takes
  the state (any presentation uses it up), and only when it is this account's and fresh exchanges the code
  server-side, reads the Todoist user, stores the authorization (TodoistStore.connect, 0600) with an
  `adoptPending` mark, and starts a sync that adopts labelled tasks before creating anything. The mark is
  on disk, so a restart before that sync still adopts.
* **One sync per account at a time:** every trigger (connect, Refresh, sign-in, POST /todoist/sync, the
  schedule) goes through `trigger`. While the account's sync runs, a trigger only marks "run once more".
  Syncs run on daemon threads, at most MAX_PARALLEL_SYNCS accounts at once.
* **Schedule:** one thread in the app's lifespan; FIRST_TICK_SECONDS after start, then every
  SYNC_INTERVAL_SECONDS, it triggers every account connected on disk (users/<id>/todoist.json with a token).
  The owner's To-do list comes through its session (automatic re-login); any other account's only while its
  memory session is on, else the state is `signin` and no Yungu login is tried.
* **Status** is kept in memory (running, last error) and the last error is also saved, best effort, in the
  store. Reads never take the store's lock: a token refresh holds it across a network call.
* **Back-off:** a Todoist outage (429, 5xx, network) holds automatic triggers (schedule, Refresh, sign-in) for
  15 min, doubling per failure in a row up to 2 h; Todoist's Retry-After (at most 2 h) holds every trigger,
  also Try again. In `reauth` automatic triggers are held until Reconnect (also after a restart: the error is
  saved); Try again still asks Todoist. A non-owner whose session is off gets `signin` without a worker.

Tokens, codes, states and the client secret are never logged or answered.
"""
import hashlib
import logging
import os
import secrets
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Callable, Dict, List, Mapping, Optional

import todoist
from todoist import TodoistAuthError, TodoistClient, TodoistError, TodoistUnavailable

from .state import StateDir
from .todoist_sync import SyncCancelled, SyncRefused, TodoistStore, make_client, sync_account
from .yungu import ServiceError, SignInAgain

log = logging.getLogger("yungu_lms.todoist")

REDIRECT_URI = "https://yungu.chihairou.dev/api/todoist/callback"
STATE_TTL_SECONDS = 10 * 60
MAX_STATES = 1000                    # outstanding connect states, all accounts
MAX_STATES_PER_ACCOUNT = 5
SYNC_INTERVAL_SECONDS = 15 * 60
FIRST_TICK_SECONDS = 30.0
MAX_PARALLEL_SYNCS = 4
BACKOFF_FIRST_SECONDS = 15 * 60
BACKOFF_MAX_SECONDS = 2 * 3600

NOT_SET_UP = "Todoist isn't set up on this server."
LINK_EXPIRED = "That Todoist link expired. Try connecting again."
NOT_ACCEPTED = "Todoist didn't accept the connection. Try again."
TODOIST_DOWN = "Can't reach Todoist right now. Try again."
NOT_CONNECTED = "Connect Todoist first."
MESSAGES = {
    "reauth": "Todoist needs you to connect again.",
    "todoist_unreachable": "Can't reach Todoist right now.",
    "signin": "Sign in to the dashboard again to keep syncing.",
    "yungu_unreachable": "Can't reach Yungu right now.",
}


class NotSetUp(ServiceError):
    status = 503

    def __init__(self):
        super().__init__(NOT_SET_UP)


class LinkExpired(ServiceError):
    status = 400

    def __init__(self):
        super().__init__(LINK_EXPIRED)


class NotAccepted(ServiceError):
    status = 502

    def __init__(self):
        super().__init__(NOT_ACCEPTED)


class TodoistDown(ServiceError):
    status = 502

    def __init__(self):
        super().__init__(TODOIST_DOWN)


class NotConnected(ServiceError):
    status = 409

    def __init__(self):
        super().__init__(NOT_CONNECTED)


class TodoistApi:
    """The Todoist calls the service makes, with the app's OAuth client credentials (a seam for tests)."""

    def __init__(self, client_id: str, client_secret: str):
        self._client_id = client_id
        self.__secret = client_secret

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "TodoistApi":
        return cls((env.get("TODOIST_CLIENT_ID") or "").strip(), (env.get("TODOIST_CLIENT_SECRET") or "").strip())

    def __repr__(self):
        return f"TodoistApi(configured={self.configured})"

    @property
    def configured(self) -> bool:
        return bool(self._client_id and self.__secret)

    def authorize_url(self, state: str) -> str:
        return todoist.authorize_url(self._client_id, state, REDIRECT_URI)

    def exchange(self, code: str) -> dict:
        return todoist.exchange_code(self._client_id, self.__secret, code, REDIRECT_URI)

    def client(self, token: str) -> TodoistClient:
        return TodoistClient(token)

    def client_for(self, store: TodoistStore) -> Optional[TodoistClient]:
        return make_client(store, self._client_id, self.__secret)

    def revoke(self, token: str) -> None:
        todoist.revoke_token(self._client_id, self.__secret, token)


_UNKNOWN = object()            # no sync outcome in memory yet (after a restart): the stored last error counts


@dataclass
class _Account:
    running: bool = False
    again: bool = False
    error: object = _UNKNOWN   # None (fine), an error code, or _UNKNOWN
    failures: int = 0          # Todoist outages in a row
    not_before: float = 0.0    # automatic triggers wait until then (monotonic)
    retry_until: float = 0.0   # every trigger waits until then (Todoist's Retry-After)


class _Skip(Exception):
    pass


def connected(state: StateDir, user_id: int) -> bool:
    """Todoist connected (a token stored); False when the account's directory cannot be read. Takes no lock."""
    try:
        return TodoistStore(state, user_id).is_connected()
    except OSError:
        return False


def keeps_session(state: StateDir, user_id: int) -> bool:
    """For the idle sweep: Todoist is connected and syncing on its own (a token stored, not waiting for the
    student to Reconnect). An account in `reauth` makes no Todoist calls until they act, so its Yungu session
    idles out as one without Todoist. Takes no lock; False when the directory cannot be read."""
    try:
        data = TodoistStore(state, user_id).load()
    except OSError:
        return False
    return bool(data and data.get("token")) and data.get("lastError") != "reauth"


def _hash(state: str) -> str:
    return hashlib.sha256(state.encode()).hexdigest()


class TodoistService:
    """`_lock` guards `_accounts` and `_states`; nothing under it does I/O or takes another lock."""

    def __init__(self, state: StateDir, api: TodoistApi, todo_for: Callable[[int], List[dict]],
                 now: Callable[[], float], monotonic: Callable[[], float],
                 can_sync: Callable[[int], bool] = lambda uid: True):
        self._state = state
        self._api = api
        self._todo_for = todo_for          # the account's To-do list; SignInAgain / Unavailable as the routes
        self._can_sync = can_sync          # the owner, or an account whose Yungu session is on; no I/O, no wait
        self._now, self._monotonic = now, monotonic
        self._lock = threading.Lock()
        self._changed = threading.Condition(self._lock)
        self._accounts: Dict[int, _Account] = {}
        self._states: "OrderedDict[str, tuple]" = OrderedDict()      # hash -> (userId, issued at)
        self._slots = threading.BoundedSemaphore(MAX_PARALLEL_SYNCS)
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    @property
    def configured(self) -> bool:
        return self._api.configured

    def _store(self, user_id: int) -> TodoistStore:
        return TodoistStore(self._state, user_id)

    def connected(self, user_id: int) -> bool:
        return connected(self._state, user_id)

    def _peek(self, user_id: int) -> Optional[dict]:
        """The account's store, read without its lock; None when absent or unreadable."""
        try:
            return self._store(user_id).load()
        except OSError:
            return None

    def _account(self, user_id: int) -> _Account:          # under _lock
        return self._accounts.setdefault(user_id, _Account())

    # ------------------------------------------------------------ connect
    def start_connect(self, user_id: int) -> str:
        if not self.configured:
            raise NotSetUp()
        state = secrets.token_urlsafe(32)
        now = self._monotonic()
        with self._lock:
            for key in [k for k, (_, at) in self._states.items() if now - at > STATE_TTL_SECONDS]:
                del self._states[key]
            mine = [k for k, (uid, _) in self._states.items() if uid == user_id]
            for key in mine[:max(0, len(mine) - MAX_STATES_PER_ACCOUNT + 1)]:
                del self._states[key]
            self._states[_hash(state)] = (user_id, now)
            while len(self._states) > MAX_STATES:
                self._states.popitem(last=False)
        return self._api.authorize_url(state)

    def finish_connect(self, user_id: int, code: str, state: str) -> None:
        with self._lock:
            entry = self._states.pop(_hash(state), None) if state else None
        if entry is None or entry[0] != user_id or self._monotonic() - entry[1] > STATE_TTL_SECONDS:
            raise LinkExpired()
        if not self.configured:
            raise NotSetUp()
        if not code:
            raise NotAccepted()
        try:
            grant = self._api.exchange(code)
        except TodoistUnavailable as e:
            log.warning("Todoist connect for account %s failed: %s", user_id, e)
            raise TodoistDown() from None
        except TodoistError as e:
            log.warning("Todoist connect for account %s refused: %s", user_id, e)
            raise NotAccepted() from None
        try:
            me = self._api.client(grant["access_token"]).me()
            if not me.get("id"):
                log.warning("Todoist connect for account %s: the Todoist user has no id", user_id)
                raise NotAccepted()
        except (TodoistError, NotAccepted) as e:
            self._revoke_quietly(user_id, grant["access_token"])       # never stored: give the grant back
            if isinstance(e, NotAccepted):
                raise
            log.warning("Todoist connect for account %s: reading the user failed: %s", user_id, e)
            raise (TodoistDown() if isinstance(e, TodoistUnavailable) else NotAccepted()) from None
        store = self._store(user_id)
        mark = int(self._now() * 1000)
        with store.lock:
            reused = store.connect(grant["access_token"], grant.get("refresh_token"), me)
            store.update(lambda d: d.__setitem__("adoptPending", mark))
        with self._lock:
            a = self._account(user_id)
            a.error, a.failures, a.not_before, a.retry_until = None, 0, 0.0, 0.0
        log.info("Todoist connected for account %s (%s pairings)", user_id, "kept" if reused else "new")
        self.trigger(user_id, manual=True)

    def disconnect(self, user_id: int) -> None:
        """Forget the token (pairings stay, per Todoist account), then revoke it at Todoist, best effort."""
        store = self._store(user_id)
        with store.lock:
            data = store.load() or {}
            token = data.get("token")
            store.forget_token()
        with self._lock:
            a = self._account(user_id)
            a.error, a.failures, a.not_before, a.retry_until = None, 0, 0.0, 0.0
            for key in [k for k, (uid, _) in self._states.items() if uid == user_id]:
                del self._states[key]
        if token:
            log.info("Todoist disconnected for account %s", user_id)
            if self.configured:
                self._revoke_quietly(user_id, token)

    def _revoke_quietly(self, user_id: int, token: str) -> None:
        """Best effort: the token is forgotten (or was never kept) either way. Logs the exception type only."""
        try:
            self._api.revoke(token)
        except Exception as e:
            log.info("Todoist revoke for account %s failed: %s", user_id, type(e).__name__)

    # ------------------------------------------------------------- status
    def status(self, user_id: int) -> dict:
        data = self._store(user_id).load()             # no lock: never waits for a token refresh
        if not data or not data.get("token"):
            return {"connected": False, "state": "ok"}
        with self._lock:
            a = self._accounts.get(user_id)
            running = bool(a and a.running)
            error = a.error if a is not None and a.error is not _UNKNOWN else data.get("lastError")
        out: dict = {"connected": True}
        account = data.get("account") or {}
        name = account.get("name") or account.get("email")
        if name:
            out["account"] = name
        if running:
            out["state"] = "syncing"
        elif error in MESSAGES:
            out["state"] = "error"
        else:
            out["state"] = "ok"
        if isinstance(data.get("lastSyncAt"), int):
            out["lastSyncAt"] = data["lastSyncAt"]
        if out["state"] == "error":
            out["error"] = {"code": error, "message": MESSAGES[error]}
        return out

    # ------------------------------------------------------- the sync guard
    def trigger(self, user_id: int, manual: bool = False) -> bool:
        """Start the account's sync unless one runs (then it runs once more after) or a back-off holds it.
        True when a sync is started or queued. Never waits."""
        if not self.configured:
            return False
        data = self._peek(user_id)
        if not data or not data.get("token"):
            return False
        can_sync = self._can_sync(user_id)
        now = self._monotonic()
        with self._lock:
            a = self._account(user_id)
            error = a.error if a.error is not _UNKNOWN else data.get("lastError")
            if not manual and error == "reauth":
                return False                      # a dead token: only Try again or Reconnect asks Todoist
            if now < a.retry_until or (not manual and now < a.not_before):
                return False
            if not can_sync and not a.running:    # its Yungu session is gone: no worker, no login
                if a.error != "signin":
                    log.warning("Todoist sync for account %s: signin", user_id)
                a.error = "signin"
                return False
            if a.running:
                a.again = True
                return True
            a.running, a.again = True, False
        try:
            threading.Thread(target=self._worker, args=(user_id,), name=f"todoist-sync-{user_id}",
                             daemon=True).start()
        except BaseException:
            with self._lock:
                a.running = False
                self._changed.notify_all()
            raise
        return True

    def _worker(self, user_id: int) -> None:
        finished = False
        try:
            while True:
                with self._slots:
                    self._sync_once(user_id)
                with self._lock:          # decide and clear `running` at once: a trigger after this starts anew
                    a = self._account(user_id)
                    if a.again and not self._stop.is_set():
                        a.again = False
                        continue
                    a.running = a.again = False
                    finished = True
                    self._changed.notify_all()
                    return
        finally:
            if not finished:              # only when something escaped _sync_once
                with self._lock:
                    a = self._account(user_id)
                    a.running = a.again = False
                    self._changed.notify_all()

    def wait_idle(self, timeout: float) -> bool:
        """Until no sync runs (tests, shutdown); False on timeout."""
        with self._lock:
            return self._changed.wait_for(lambda: not any(a.running for a in self._accounts.values()), timeout)

    def _sync_once(self, user_id: int) -> None:
        store = self._store(user_id)
        account_id, retry_after, backoff = None, None, True
        try:
            start = store.load()
            if not start or not start.get("token"):
                return
            account_id = (start.get("account") or {}).get("id")
            mark = start.get("adoptPending")
            todo = self._todo_for(user_id)
            client = self._api.client_for(store)
            if client is None:
                return
            client.me()                     # a cheap check, so a revoked token shows even when nothing changed
            refused = None
            try:
                sync_account(client, todo, store, int(self._now() * 1000), adopt=mark is not None)
            except SyncRefused as e:        # the run itself went through (its adopt scan included)
                refused = e
            if mark is not None:
                store.update(lambda d: d.pop("adoptPending", None) if d.get("adoptPending") == mark else None)
            if refused is not None:
                raise refused
            error = None
        except SyncRefused:
            # Some assignments Todoist would not take: shown, but not an outage, so nothing is held back.
            error, backoff = "todoist_unreachable", False
        except SyncCancelled:
            return                                  # disconnected or reconnected meanwhile: no error state
        except SignInAgain:
            error = "signin"
        except ServiceError:
            error = "yungu_unreachable"
        except TodoistAuthError:
            error = "reauth"
        except TodoistUnavailable as e:
            error, retry_after = "todoist_unreachable", e.retry_after
        except TodoistError as e:
            log.warning("Todoist sync for account %s: %s", user_id, e)
            error = "todoist_unreachable"
        except Exception as e:
            log.error("Todoist sync for account %s crashed: %s", user_id, type(e).__name__)
            error = "todoist_unreachable"
        self._record(user_id, store, account_id, error, retry_after, backoff)

    def _record(self, user_id: int, store: TodoistStore, account_id, error: Optional[str],
                retry_after: Optional[int], backoff: bool = True) -> None:
        now = self._monotonic()
        with self._lock:
            a = self._account(user_id)
            before = a.error
            a.error = error
            if error == "todoist_unreachable" and not backoff:
                a.failures, a.not_before, a.retry_until = 0, 0.0, 0.0
            elif error == "todoist_unreachable":
                a.failures += 1
                a.not_before = now + min(BACKOFF_MAX_SECONDS, BACKOFF_FIRST_SECONDS * 2 ** (a.failures - 1))
                a.retry_until = now + min(retry_after, BACKOFF_MAX_SECONDS) if retry_after else 0.0
            elif error is None:
                a.failures, a.not_before, a.retry_until = 0, 0.0, 0.0
        if error is not None and error != before:   # once per change, not every 15 minutes
            log.warning("Todoist sync for account %s: %s", user_id, error)
        elif error is None and before not in (None, _UNKNOWN):
            log.info("Todoist sync for account %s: working again", user_id)

        def change(d):
            if not d.get("token") or (d.get("account") or {}).get("id") != account_id:
                raise _Skip()
            if error is None:
                d.pop("lastError", None)
            else:
                d["lastError"] = error
        try:
            store.update(change)                    # best effort, outside _lock (it may wait for a refresh)
        except _Skip:
            pass
        except Exception as e:
            log.warning("could not save the Todoist status of account %s: %s", user_id, type(e).__name__)

    # ----------------------------------------------------------- schedule
    def connected_accounts(self) -> List[int]:
        users = self._state.child("users").path
        try:
            ids = sorted(int(p.name) for p in users.iterdir() if p.is_dir() and p.name.isdigit())
        except FileNotFoundError:
            return []
        return [uid for uid in ids if self.connected(uid)]

    def tick(self) -> None:
        """One round of the schedule: trigger every account connected on disk; one account's trouble never
        stops the round."""
        try:
            accounts = self.connected_accounts()
        except Exception as e:
            log.error("Todoist schedule: could not list accounts: %s", type(e).__name__)
            return
        for uid in accounts:
            try:
                self.trigger(uid)
            except Exception as e:
                log.error("Todoist schedule: account %s: %s", uid, type(e).__name__)

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="todoist-scheduler", daemon=True)
        self._thread.start()

    def _loop(self) -> None:
        wait = FIRST_TICK_SECONDS
        while not self._stop.wait(wait):
            self.tick()
            wait = SYNC_INTERVAL_SECONDS

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout)
        self.wait_idle(timeout)
