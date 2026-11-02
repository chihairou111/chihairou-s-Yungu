"""Todoist sync: each account's pairing store and the sync engine (no scheduling, no HTTP routes here).

Store: users/<userId>/todoist.json (0600, via StateDir), shape
    {"token", "refreshToken", "account": {"id", "name", "email"},
     "pairings": {"<taskPublishId>": {"todoistId", "dueMs"[, "closed": true]}},
     "lastSyncAt": ms, ...}                       (other keys, e.g. the last error, belong to the caller)
Every write is a read-modify-write under the account's lock (`update`), and never re-creates a file that
Disconnect deleted.

Engine rules (spec 2026-11-02-todoist-sync-design.md):
  - one Todoist task per (account, taskPublishId), ever: the pairing is saved right after each create, and
    kept when the assignment leaves the To-do list (Yungu dropping it for one read does not re-create it);
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
        """Load, `change(data)` in place, save; all under the lock. None (nothing written) when not connected."""
        with self.lock:
            data = self.load()
            if data is None:
                return None
            change(data)
            self._dir.write(self.FILE, data)
            return data


def description_for(task_publish_id: int) -> str:
    return LINK.format(id=int(task_publish_id))


def _content(a: dict) -> str:
    return f"[{a.get('course') or ''}] {a.get('title') or ''}".strip()


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
    if start is None:
        raise SyncCancelled("not connected")
    account = (start.get("account") or {}).get("id")
    pairs: Dict[str, dict] = dict(start.get("pairings") or {})
    result: SyncResult = {"created": 0, "updated": 0, "adopted": 0, "skipped": 0}

    def put(key: str, pairing: dict) -> None:
        def change(data):
            if (data.get("account") or {}).get("id") != account:
                raise SyncCancelled("connected to another Todoist account")
            data.setdefault("pairings", {})[key] = pairing
        if store.update(change) is None:
            raise SyncCancelled("disconnected")
        pairs[key] = pairing

    open_ids = set()
    if adopt:
        for t in client.find_tasks(LABEL):
            tid = str(t.get("id") or "")
            if not tid:
                continue
            open_ids.add(tid)
            m = _LINK_RE.search(str(t.get("description") or ""))
            if m is None or LABEL not in (t.get("labels") or []):
                continue
            key = str(int(m.group(1)))
            if key in pairs:
                continue
            put(key, {"todoistId": tid, "dueMs": _due_ms_of(t)})
            result["adopted"] += 1

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
    saved under the account's lock). None when the account is not connected."""
    data = store.load()
    if data is None or not data.get("token"):
        return None
    client: TodoistClient

    def refresh() -> str:
        with store.lock:
            now = store.load()
            if now is None or not now.get("token"):
                raise TodoistAuthError("disconnected")
            if now["token"] != client.token:            # another thread refreshed already
                return now["token"]
            rt = now.get("refreshToken")
            if not rt:
                raise TodoistAuthError("no refresh token")
            fresh = refresh_access_token(client_id, client_secret, rt)

            def change(d):
                d["token"] = fresh["access_token"]
                d["refreshToken"] = fresh.get("refresh_token") or rt
            store.update(change)
            return fresh["access_token"]

    client = TodoistClient(data["token"], refresh=refresh)
    return client
