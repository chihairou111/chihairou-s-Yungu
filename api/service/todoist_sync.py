"""Todoist sync: each account's pairing store and the sync engine (no scheduling, no HTTP routes here).

Store: users/<userId>/todoist.json (0600, via StateDir), shape
    {"token", "refreshToken", "account": {"id", "name", "email"},
     "pairingsAccount": "<Todoist user id the pairings belong to>",
     "pairings": {"<taskPublishId>": {"todoistId", "dueMs"[, "closed": true]} | {"pending": ms}},
     "lastSyncAt": ms, ...}                       (other keys, e.g. the last error, belong to the caller)
Connected = a `token` is stored. `connect()` stores a new authorization and keeps the pairings only when they
belong to the same Todoist account; Disconnect (`forget_token()`) drops the token and Todoist name but keeps
the pairings with their account id, so reconnecting the same Todoist account re-creates nothing (completed or
deleted tasks stay closed). Every write is a read-modify-write under the account's lock (`update`); the
engine never writes once the account is disconnected or connected to another Todoist account.

Engine rules (spec 2026-11-02-todoist-sync-design.md):
  - one Todoist task per (account, taskPublishId), ever: a `pending` pairing is saved before each create and
    the real one right after; a sync that finds pending pairings (a create that failed or crashed part-way,
    maybe after Todoist made the task) first scans the labelled open tasks and adopts the match, and only
    creates again when none matches. Pairings are kept when the assignment leaves the To-do list (Yungu
    dropping it for one read does not re-create it);
  - with `adopt` (every connect), open "Yungu"-labelled tasks whose description holds
    `assignments?task={id}` become pairings before anything is created;
  - a deadline change updates only the due; before that the task is looked up, and one the user completed
    or deleted is marked `closed` and never touched again; nothing else is ever pushed after creation.
"""
import logging
import re
import threading
from datetime import datetime
from pathlib import Path
from typing import Callable, Dict, List, Optional, TypedDict, Union

import mapping
from todoist import (TodoistAuthError, TodoistClient, TodoistNotFound, due_datetime as _due_datetime,
                     refresh_access_token)

from .state import StateDir

log = logging.getLogger("yungu_lms.todoist_sync")

LABEL = "Yungu"
LINK = "https://yungu.chihairou.dev/assignments?task={id}"
_LINK_RE = re.compile(r"assignments\?task=(\d+)(?!\d)")
_KEEP_ON_DISCONNECT = ("pairings", "pairingsAccount")

_locks: Dict[str, threading.RLock] = {}
_locks_guard = threading.Lock()


def _lock_for(path: Path) -> threading.RLock:
    with _locks_guard:
        return _locks.setdefault(str(path), threading.RLock())


class SyncCancelled(Exception):
    """The account was disconnected (or connected to another Todoist account) while the sync ran."""


class SyncResult(TypedDict):
    created: int
    updated: int
    adopted: int
    skipped: int          # To-do assignments whose Todoist task the user completed or deleted (left alone)


class TodoistStore:
    FILE = "todoist.json"

    def __init__(self, state_dir: Union[StateDir, str, Path], user_id: int):
        top = state_dir if isinstance(state_dir, StateDir) else StateDir(state_dir)
        self._dir = top.child("users", str(int(user_id)))
        self.user_id = int(user_id)
        self.lock = _lock_for(self._dir.path / self.FILE)     # shared by every store object of this account

    def load(self) -> Optional[dict]:
        data = self._dir.read(self.FILE)
        return data if isinstance(data, dict) else None

    def save(self, data: dict) -> None:
        with self.lock:
            self._dir.write(self.FILE, data)

    def delete(self) -> None:
        with self.lock:
            self._dir.delete(self.FILE)

    def update(self, change: Callable[[dict], object]) -> Optional[dict]:
        """Load, `change(data)` in place, save; all under the lock. None (nothing written) when there is no file.
        `change` may raise to write nothing."""
        with self.lock:
            data = self.load()
            if data is None:
                return None
            change(data)
            self._dir.write(self.FILE, data)
            return data

    def is_connected(self) -> bool:
        data = self.load()
        return bool(data and data.get("token"))

    def connect(self, token: str, refresh_token: Optional[str], account: dict) -> bool:
        """Store a new authorization (OAuth callback). `account` is `TodoistClient.me()` ({id, name, email}).
        Pairings kept from before are reused when they belong to this Todoist account, else replaced by none.
        Any other state (last sync, last error) starts fresh. Returns whether pairings were reused."""
        account_id = str(account.get("id") or "")
        with self.lock:
            old = self.load() or {}
            reuse = bool(account_id) and old.get("pairingsAccount") == account_id
            self._dir.write(self.FILE, {
                "token": token, "refreshToken": refresh_token,
                "account": {"id": account_id, "name": account.get("name") or "", "email": account.get("email") or ""},
                "pairingsAccount": account_id,
                "pairings": dict(old.get("pairings") or {}) if reuse else {},
            })
            return reuse

    def forget_token(self) -> None:
        """Disconnect: drop the token, refresh token, Todoist name/email and status; keep the pairings and the
        Todoist account id they belong to (no file when there are none)."""
        with self.lock:
            data = self.load()
            if data is None:
                return
            kept = {k: data[k] for k in _KEEP_ON_DISCONNECT if k in data}
            if kept.get("pairings"):
                self._dir.write(self.FILE, kept)
            else:
                self._dir.delete(self.FILE)


def description_for(task_publish_id: int) -> str:
    return LINK.format(id=int(task_publish_id))


def _content(a: dict) -> str:
    title = str(a.get("title") or "").strip()
    course = str(a.get("course") or "").strip()
    return f"[{course}] {title}" if course else title


def _due(due_ms: Optional[int]) -> Optional[str]:
    return None if due_ms is None or due_ms >= mapping.NO_DEADLINE_MS else _due_datetime(due_ms)


def _due_ms_of(task: dict) -> Optional[int]:
    """A Todoist task's due as epoch ms (fixed `...Z` = UTC; floating = China time); None if no time."""
    date = str((task.get("due") or {}).get("date") or "")
    if "T" not in date:
        return None
    if date.endswith("Z"):
        try:
            return int(datetime.fromisoformat(date[:-1] + "+00:00").timestamp() * 1000)
        except ValueError:
            return None
    return mapping.china_ms(date.replace("T", " "))


def sync_account(client: TodoistClient, todo: List[dict], store: TodoistStore, now_ms: int, *,
                 adopt: bool) -> SyncResult:
    """One sync of one account. `todo` is the service's To-do Assignment list (`id`, `title`, `course`, `dueAt`).
    Raises TodoistAuthError / TodoistUnavailable / TodoistError from the client (pairings made so far stay
    saved) and SyncCancelled when the store vanished or changed account mid-way. Not reentrant per account:
    the caller runs one sync per account at a time."""
    start = store.load()
    if start is None or not start.get("token"):
        raise SyncCancelled("not connected")
    account = (start.get("account") or {}).get("id")
    pairs: Dict[str, dict] = dict(start.get("pairings") or {})
    result: SyncResult = {"created": 0, "updated": 0, "adopted": 0, "skipped": 0}

    def write(change_pairings: Callable[[dict], None]) -> None:
        def change(data):
            if not data.get("token"):
                raise SyncCancelled("disconnected")
            if (data.get("account") or {}).get("id") != account:
                raise SyncCancelled("connected to another Todoist account")
            change_pairings(data.setdefault("pairings", {}))
        if store.update(change) is None:
            raise SyncCancelled("disconnected")

    def put(key: str, pairing: dict) -> None:
        write(lambda ps: ps.__setitem__(key, pairing))
        pairs[key] = pairing

    open_ids = set()
    pending = {k for k, p in pairs.items() if isinstance(p, dict) and "pending" in p}
    if adopt or pending:
        label_key = LABEL.casefold()
        for t in client.find_tasks(LABEL):
            tid = str(t.get("id") or "")
            if not tid:
                continue
            open_ids.add(tid)
            m = _LINK_RE.search(str(t.get("description") or ""))
            if m is None or label_key not in [str(n).casefold() for n in (t.get("labels") or [])]:
                continue
            key = str(int(m.group(1)))
            if key in pairs and key not in pending:
                continue
            put(key, {"todoistId": tid, "dueMs": _due_ms_of(t)})
            pending.discard(key)
            result["adopted"] += 1
        if pending:                 # no open labelled task for these: the create never happened
            gone = set(pending)
            write(lambda ps: [ps.pop(k, None) for k in gone])
            for k in gone:
                pairs.pop(k, None)

    label_ready = False
    seen = set()
    for a in todo:
        key = str(int(a["id"]))
        if key in seen:
            continue
        seen.add(key)
        due_ms = a.get("dueAt")
        p = pairs.get(key)
        if p is None:
            if not label_ready:
                client.ensure_label(LABEL)
                label_ready = True
            put(key, {"pending": now_ms})          # settled by the next sync's scan if the create goes wrong
            t = client.create_task(_content(a), description_for(a["id"]), _due(due_ms), [LABEL])
            put(key, {"todoistId": str(t["id"]), "dueMs": due_ms})
            result["created"] += 1
            continue
        if p.get("closed"):
            result["skipped"] += 1
            continue
        if p.get("dueMs") == due_ms:
            continue
        tid = str(p.get("todoistId"))
        if tid not in open_ids:
            t = client.get_task(tid)
            if t is None or t.get("checked") or t.get("is_deleted"):
                put(key, {**p, "closed": True})
                result["skipped"] += 1
                continue
        try:
            client.update_due(tid, _due(due_ms))
        except TodoistNotFound:
            put(key, {**p, "closed": True})
            result["skipped"] += 1
            continue
        put(key, {"todoistId": tid, "dueMs": due_ms})
        result["updated"] += 1

    def finish(data):
        if not data.get("token"):
            raise SyncCancelled("disconnected")
        if (data.get("account") or {}).get("id") != account:
            raise SyncCancelled("connected to another Todoist account")
        data["lastSyncAt"] = now_ms
    if store.update(finish) is None:
        raise SyncCancelled("disconnected")
    if any(result.values()):
        log.info("Todoist sync for account %s: %s", store.user_id, result)
    return result


def make_client(store: TodoistStore, client_id: str, client_secret: str) -> Optional[TodoistClient]:
    """The account's client, refreshing an expired access token with the stored refresh token (rotated and
    saved under the account's lock). None when the account is not connected.

    The client stays bound to the Todoist account it was made for: if the account was disconnected or
    connected to another Todoist account meanwhile, a refresh raises SyncCancelled instead of switching
    onto that token. A token refreshed meanwhile for the same Todoist account is reused."""
    data = store.load()
    if data is None or not data.get("token"):
        return None
    account = (data.get("account") or {}).get("id")
    client: TodoistClient

    def refresh() -> str:
        with store.lock:
            now = store.load()
            if now is None or not now.get("token"):
                raise SyncCancelled("disconnected")
            if (now.get("account") or {}).get("id") != account:
                raise SyncCancelled("connected to another Todoist account")
            if now["token"] != client.token:            # refreshed (or reconnected) meanwhile, same account
                return now["token"]
            rt = now.get("refreshToken")
            if not rt:
                raise TodoistAuthError("no refresh token")
            fresh = refresh_access_token(client_id, client_secret, rt)
            new_rt = fresh.get("refresh_token")
            if not new_rt:
                # Todoist answers a repeat of an already-used refresh token (within 60 s) without a new one.
                # The stored one is then consumed: presenting it again after 60 s would make Todoist revoke
                # all of this user's tokens, so it is dropped; the access token works until it expires, then
                # the account shows "connect again".
                log.warning("Todoist token refresh answered without a new refresh token; "
                            "the account must connect again when this access token expires")

            def change(d):
                if not d.get("token") or (d.get("account") or {}).get("id") != account:
                    raise SyncCancelled("disconnected or connected to another Todoist account")
                d["token"] = fresh["access_token"]
                d["refreshToken"] = new_rt
            store.update(change)
            return fresh["access_token"]

    client = TodoistClient(data["token"], refresh=refresh)
    return client
