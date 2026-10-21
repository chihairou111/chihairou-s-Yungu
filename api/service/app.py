"""HTTP routes mirroring the dashboard's data seam (frontend/src/lib/data/index.ts, YunguData).

JSON everywhere; `Authorization: Bearer <token>` on everything except POST /session; errors are
`{"error": str}`. Any Yungu student account can sign in; a token belongs to one account, and everything a
request does (Yungu calls, the read cache, the hand-in record, locks) is that account's alone.
Reads are cached 60 s per account + endpoint + params (`X-Refresh: 1` bypasses); any write (draft,
submit, comment, online document, notification read) or POST /refresh clears that account's cache; an
upload changes no read and leaves it. Run: `uvicorn service.app:app --host 127.0.0.1 --port 8100`
from api/, with YUNGU_STATE_DIR (default /var/lib/yungu-lms).
"""
import json
import logging
import mimetypes
import os
import re
import threading
import time
from collections import OrderedDict, deque
from datetime import datetime
from typing import Callable, Deque, Dict, Iterable, List, Optional, TypeVar

from fastapi import Depends, FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException
from starlette.requests import ClientDisconnect

import mapping
from yungu_task import ACHIEVEMENT_NOT_SUBMITTED, CST, ONLINE_DOC_MAX_BYTES, SUBMITTED, TODO, YunguError, YunguTask

from .auth import Auth
from .cache import ReadCache
from .state import StateDir, SubmittedFiles
from .yungu import (UNREACHABLE, ServiceError, SignInAgain, SignInRefused, Unavailable, Yungu, checked_redirect,
                    error_code)

DEFAULT_STATE_DIR = "/var/lib/yungu-lms"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024 + 64 * 1024      # 50 MiB of file plus room for the multipart framing
TOO_LARGE = "Files up to 50 MB."
log = logging.getLogger("yungu_lms.app")
T = TypeVar("T")
BLANK_CREDENTIALS = "Enter your student ID and password."
UNKNOWN_TASK = 1035          # Yungu's answer (HTTP 200, JSON code 1035) for a taskPublishId that does not exist
DOC_TOO_LONG = 1008          # Yungu's answer (HTTP 200, JSON code 1008) for an online document over the limit
                             # (its message is only "system error", so under the limit it means something else)
# Per socket operation (connect, each read) of every Yungu call. The client's own default (60 s) let a
# stalled Yungu hold a page for minutes: a cold Submitted list is several sequential page calls and a
# login is five calls under the login lock other requests wait on. The OSS upload keeps its own
# max(timeout, 300) s. Next gives up on the whole service call well before these add up (service.ts).
YUNGU_TIMEOUT_SECONDS = 15
# getAllTasks page size. Yungu honours 50 (checked live, read-only: 90 Submitted items, total 90, the same
# ids as with 10), so a cold Submitted list is 2 calls instead of 9.
LIST_PAGE_SIZE = 50
ONLINE_DOCUMENT = "Open this online document on Yungu."
COMMENT_NOT_FOUND = "Comment not found."
NO_TITLE = "Give the document a title."
HANDED_IN_DOC = "This document was handed in — save it as a new one."
ADD_A_FILE = "Add at least one file."
NOT_CONFIRMED = "Yungu didn't confirm the hand-in. Check on Yungu."
DOC_NOT_SAVED = "Yungu couldn't save the document. Try again."
ASCII_ID = re.compile(r"[0-9]+")
FILE_URL = re.compile(r"/api/files/([0-9]+)")
# Every POST /session is a real CAS login. A login id with this many refused sign-ins within the window
# waits the window out (429, no Yungu call); and only so many sign-ins run at once. Both keep bursts of
# bad passwords from getting the server's address throttled by Yungu, which the owner's re-login needs.
MAX_FAILED_SIGN_INS = 5
FAILED_SIGN_IN_WINDOW_SECONDS = 15 * 60
MAX_TRACKED_LOGIN_IDS = 10000
MAX_CONCURRENT_SIGN_INS = 3
TOO_MANY_ATTEMPTS = "Too many attempts. Try again in a few minutes."
SIGN_INS_BUSY = "Too many sign-ins right now. Try again in a moment."
NOTIFICATION_PAGE_MAX = 100          # Yungu's v2/page honours 100 (research notifications-and-feedback.md)


class NotFound(ServiceError):
    status = 404

    def __init__(self, message: str = "Not found."):
        super().__init__(message)


class BadRequest(ServiceError):
    status = 400

    def __init__(self, message: str = "Bad request."):
        super().__init__(message)


class NoStoredFile(ServiceError):
    """Yungu keeps no bytes behind this file id: an online document (its text lives in Yungu), or an id it
    does not know. Both answer preview_file / new_download_file with an empty HTTP 200 instead of a 302."""
    status = 422

    def __init__(self):
        super().__init__(ONLINE_DOCUMENT)


class TooManyAttempts(ServiceError):
    status = 429

    def __init__(self, message: str = TOO_MANY_ATTEMPTS):
        super().__init__(message)


class TooLarge(ServiceError):
    status = 413

    def __init__(self):
        super().__init__(TOO_LARGE)


class DocTooLong(ServiceError):
    """An online document over Yungu's limit, with roughly how many characters must go.

    Counted over the delta JSON string as stored: excess = bytes - limit, scaled to characters by the
    string's own bytes per character, at least 1 (the dashboard computes the same number)."""
    status = 413

    def __init__(self, content: str):
        size, chars = len(content.encode("utf-8")), len(content)
        excess = size - ONLINE_DOC_MAX_BYTES
        n = max(1, -(-excess * chars // size)) if size else 1          # ceil, without floats
        super().__init__(f"Too long for Yungu — cut about {n} character{'' if n == 1 else 's'}.")


class Conflict(ServiceError):
    status = 409

    def __init__(self, message: str):
        super().__init__(message)


class DocNotSaved(ServiceError):
    """Yungu refused an online document that is within the limit (code 1008 not about length)."""
    status = 502

    def __init__(self):
        super().__init__(DOC_NOT_SAVED)


class NotConfirmed(ServiceError):
    """Mark as submitted was sent, but reading the assignment again did not show it handed in."""
    status = 502

    def __init__(self):
        super().__init__(NOT_CONFIRMED)


class _BodyTooLarge(Exception):
    pass


class CatchAll:
    """Last line: anything a route did not turn into a ServiceError (say a Yungu payload of an
    unexpected shape tripping a mapper) becomes 502 `{error}`, logged by exception type only."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = False

        async def tracking_send(message):
            nonlocal started
            started = started or message["type"] == "http.response.start"
            await send(message)
        try:
            await self.app(scope, receive, tracking_send)
        except Exception as e:
            log.error("%s %s failed: %s", scope.get("method"), scope.get("path"), type(e).__name__)
            if started:
                raise
            await JSONResponse({"error": UNREACHABLE}, status_code=502)(scope, receive, send)


# ------------------------------------------------------------------ bodies
class SignInBody(BaseModel):
    loginId: str = ""
    password: str = ""


class FileIdsBody(BaseModel):
    fileIds: List[str]


class TextBody(BaseModel):
    text: str


class OnlineDocBody(BaseModel):
    title: str
    content: str          # the Quill delta JSON string, stored by Yungu as is


def _known(lookup: Callable[[], T]) -> T:
    """Run a Yungu call keyed by an assignment id; Yungu's "no such task" answer becomes a 404.
    Only for those lookups: elsewhere code 1035 stays an ordinary failure (502)."""
    try:
        return lookup()
    except YunguError as e:
        if error_code(e) == UNKNOWN_TASK:
            raise NotFound() from None
        raise


def _doc_write(write: Callable[[], T], content: str) -> T:
    """Run an online-document create/update. Yungu's code 1008 is its "too long" answer, but content over
    the limit is refused before any call (_checked_doc), so here it cannot be about length: a 502 that
    says the save failed, logged by code only."""
    try:
        return write()
    except YunguError as e:
        if error_code(e) == DOC_TOO_LONG:
            if len(content.encode("utf-8")) > ONLINE_DOC_MAX_BYTES:
                raise DocTooLong(content) from None
            log.warning("online document refused by Yungu: code=%d", DOC_TOO_LONG)
            raise DocNotSaved() from None
        raise


def _shape(value, depth: int = 0):
    """The structure of a Yungu answer with every value replaced by its type: safe to log."""
    if value is None:
        return "null"
    if isinstance(value, dict) and depth < 4:
        return {str(k): _shape(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list) and depth < 4:
        return [_shape(value[0], depth + 1)] if value else []
    return type(value).__name__


def _shape_text(value) -> str:
    """Never raises: it is logged right after a real hand-in, which must still be confirmed."""
    try:
        shape = _shape(value)
        return shape if isinstance(shape, str) else json.dumps(shape, ensure_ascii=False, sort_keys=True)
    except Exception:
        return "an unreadable answer"


def _checked_doc(title: str, content: str) -> str:
    """The title to send; refuses a blank title or an over-long delta before any Yungu call."""
    if not title.strip():
        raise BadRequest(NO_TITLE)
    if len(content.encode("utf-8")) > ONLINE_DOC_MAX_BYTES:
        raise DocTooLong(content)
    return title.strip()


def yungu_client(login_id: str, password: str) -> YunguTask:
    return YunguTask(login_id, password, timeout=YUNGU_TIMEOUT_SECONDS)


def _redirect(client, file_id: int, preview: bool) -> str:
    try:
        url = client.file_redirect(file_id, preview)
    except YunguError as e:
        resp = e.resp
        if resp is not None and resp.status_code == 200 and not resp.content:
            raise NoStoredFile() from None
        raise
    return checked_redirect(url)


def _file_ids(ids: List[str]) -> List[int]:
    if not all(isinstance(i, str) and i.isdigit() for i in ids):
        raise BadRequest("Unknown file.")
    return [int(i) for i in ids]


def _display_name(user: dict, login_id: str) -> str:
    for key in ("eName", "userEname", "englishName", "userName", "name"):
        value = user.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return login_id


def _china_monday(ms: int) -> int:
    try:
        day = datetime.fromtimestamp(ms / 1000, CST).date()
    except (ValueError, OverflowError, OSError):
        raise BadRequest() from None
    return YunguTask.week_bounds(day)[0]


def _limited(receive, limit: int):
    """ASGI receive that stops the body at `limit` bytes, whatever Content-Length said."""
    seen = 0

    async def wrapped():
        nonlocal seen
        message = await receive()
        if message["type"] == "http.request":
            seen += len(message.get("body", b""))
            if seen > limit:
                raise _BodyTooLarge()
        return message
    return wrapped


# ----------------------------------------------------------------- service
class KnownFiles:
    """The file ids one account has been shown (by its own reads) or made (its uploads and documents):
    the only ids it may open, edit or hand in. Yungu itself resolves any id for any session, and ids are
    sequential. Bounded: past CAP the longest unseen go first; a detail read shows its files again."""
    CAP = 5000

    def __init__(self, cap: Optional[int] = None):
        self._cap = cap
        self._ids: "OrderedDict[str, None]" = OrderedDict()
        self._lock = threading.Lock()

    def add(self, file_ids: Iterable) -> None:
        with self._lock:
            for fid in file_ids:
                self._ids[str(fid)] = None
                self._ids.move_to_end(str(fid))
            while len(self._ids) > (self._cap or self.CAP):
                self._ids.popitem(last=False)

    def has(self, file_id) -> bool:
        with self._lock:
            return str(file_id) in self._ids

    def require(self, file_ids: Iterable) -> None:
        """NotFound unless every id is known."""
        if not all(self.has(f) for f in file_ids):
            raise NotFound()


def _shown_files(value) -> Iterable[str]:
    """The ids of every FileRef (url /api/files/<id>) in a mapped answer, and its submittedFileIds."""
    if isinstance(value, dict):
        match = FILE_URL.fullmatch(value["url"]) if isinstance(value.get("url"), str) else None
        if match and str(value.get("id")) == match.group(1):
            yield match.group(1)
        for key, item in value.items():
            if key == "submittedFileIds" and isinstance(item, list):
                yield from (str(i) for i in item)
            else:
                yield from _shown_files(item)
    elif isinstance(value, list):
        for item in value:
            yield from _shown_files(item)


class SignInGate:
    """Sign-in throttling, by login id (as typed, trimmed, case-folded): MAX_FAILED_SIGN_INS refusals
    within the window → TooManyAttempts until the oldest falls out; and MAX_CONCURRENT_SIGN_INS at once
    (beyond: TooManyAttempts(SIGN_INS_BUSY) at once, no waiting). Only Yungu's refusals count: Yungu
    being down does not. A success clears its id."""

    def __init__(self, clock: Callable[[], float]):
        self._clock = clock
        self._lock = threading.Lock()
        self._failures: "OrderedDict[str, Deque[float]]" = OrderedDict()
        self._running = threading.BoundedSemaphore(MAX_CONCURRENT_SIGN_INS)

    @staticmethod
    def _key(login_id: str) -> str:
        return login_id.strip().casefold()

    def _recent(self, key: str, now: float) -> Deque[float]:
        times = self._failures.get(key) or deque()
        while times and now - times[0] >= FAILED_SIGN_IN_WINDOW_SECONDS:
            times.popleft()
        return times

    def run(self, login_id: str, sign_in: Callable[[], T]) -> T:
        key = self._key(login_id)
        with self._lock:
            if len(self._recent(key, self._clock())) >= MAX_FAILED_SIGN_INS:
                raise TooManyAttempts()
        if not self._running.acquire(blocking=False):
            raise TooManyAttempts(SIGN_INS_BUSY)
        try:
            result = sign_in()
        except SignInRefused:
            self._failed(key)
            raise
        finally:
            self._running.release()
        with self._lock:
            self._failures.pop(key, None)
        return result

    def _failed(self, key: str) -> None:
        with self._lock:
            now = self._clock()
            times = self._recent(key, now)
            times.append(now)
            self._failures[key] = times
            self._failures.move_to_end(key)
            for stale in [k for k, t in self._failures.items() if not self._recent(k, now)]:
                del self._failures[stale]
            while len(self._failures) > MAX_TRACKED_LOGIN_IDS:
                self._failures.popitem(last=False)


class Account:
    """One account's own state: its read cache, its hand-in record, the file ids it may use and its
    Mark-as-submitted lock."""

    def __init__(self, user_id: int, state: StateDir, monotonic: Callable[[], float], owner: bool,
                 records_lock: threading.Lock):
        self.user_id = user_id
        self.cache = ReadCache(clock=monotonic)
        self.submitted = SubmittedFiles(state, user_id, migrate=owner, lock=records_lock)
        self.files = KnownFiles()
        self.marking = threading.Lock()        # one Mark as submitted at a time (see mark_submitted)


class Service:
    """Sign-in and the accounts: which account a token belongs to, and that account's state."""

    def __init__(self, state_dir: str, client_factory, now: Callable[[], float], monotonic: Callable[[], float]):
        self._state = StateDir(state_dir)
        self.auth = Auth(self._state)
        self.yungu = Yungu(self.auth, client_factory, clock=monotonic, on_end=self._ended)
        self._now, self._monotonic = now, monotonic
        self._lock = threading.Lock()          # guards _accounts only
        self._accounts: Dict[int, Account] = {}     # made on first use: importing the app touches nothing
        self._records_lock = threading.Lock()  # hand-in record files: an Account may be dropped and remade
        self._gate = SignInGate(monotonic)

    def account(self, user_id: int) -> Account:
        owner = self.auth.owner()
        with self._lock:
            found = self._accounts.get(user_id)
            if found is None:
                found = self._accounts[user_id] = Account(user_id, self._state, self._monotonic,
                                                          owner=user_id == owner, records_lock=self._records_lock)
            return found

    def _ended(self, user_id: int) -> None:
        """An account other than the owner signed out, lost its Yungu session or sat idle: forget its
        state in memory (its hand-in record stays on disk)."""
        with self._lock:
            found = self._accounts.pop(user_id, None)
        if found is not None:
            found.cache.clear()

    def student(self, token: Optional[str]) -> "Student":
        """The account a token belongs to; SignInAgain when none does, or its Yungu session is gone."""
        self.yungu.sweep()
        user_id = self.auth.user_for(token)
        if user_id is None or not self.yungu.live(user_id):
            raise SignInAgain()
        return Student(self, user_id)

    def sign_in(self, login_id: str, password: str) -> dict:
        self.yungu.sweep()
        user_id, user = self._gate.run(login_id, lambda: self.yungu.sign_in(login_id, password))
        self.account(user_id).cache.clear()
        return {"ok": True, "displayName": _display_name(user, login_id), "token": self.auth.issue_token(user_id)}


class Student:
    """What the routes do for one account: Yungu calls through its session, mapping, its read cache."""

    def __init__(self, service: Service, user_id: int):
        account = service.account(user_id)
        self.user_id = user_id
        self.cache, self.submitted, self._marking = account.cache, account.submitted, account.marking
        self.files = account.files
        self._yungu = service.yungu
        self._now = service._now

    def _call(self, fn: Callable[[object], T]) -> T:
        return self._yungu.call(self.user_id, fn)

    def now_ms(self) -> int:
        return int(self._now() * 1000)

    # ------------------------------------------------------------ session
    def sign_out(self) -> None:
        self._yungu.sign_out(self.user_id)
        self.cache.clear()

    # -------------------------------------------------------------- reads
    def _assignments(self, status: int) -> List[dict]:
        rows = self._call(lambda c: list(c.iter_tasks(status, page_size=LIST_PAGE_SIZE)))
        now, seen, out = self.now_ms(), set(), []
        for raw in rows:                  # items can shift between pages: keep the first of each id
            if raw["taskPublishId"] not in seen:
                seen.add(raw["taskPublishId"])
                out.append(mapping.assignment(raw, raw.get("group"), now))
        return out

    def todo(self, refresh=False) -> List[dict]:
        """In Yungu's order (groups Due today, Due recently, Delayed; by deadline within each)."""
        return self.cache.get(("todo",), lambda: self._assignments(TODO), refresh)

    def submitted_list(self, refresh=False) -> List[dict]:
        """Newest hand-in first, as the mock's listSubmitted sorts (stable for ties)."""
        def compute():
            items = self._assignments(SUBMITTED)
            return sorted(items, key=lambda a: -a.get("submittedAt", a["dueAt"]))
        return self.cache.get(("submitted",), compute, refresh)

    def week(self, start: int, refresh=False) -> List[dict]:
        monday = _china_monday(start)

        def compute():
            days = self._call(lambda c: c.calendar_week(start_ms=monday))
            events = [mapping.class_event(e) for day in days or [] for e in day or []]
            return sorted(events, key=lambda e: e["start"])
        return self.cache.get(("week", monday), compute, refresh)

    def courses(self, refresh=False) -> List[dict]:
        return self.cache.get(("courses",), lambda: mapping.courses(self._call(lambda c: c.courses())), refresh)

    def detail(self, assignment_id: int, refresh=False) -> dict:
        shown = self.cache.get(("detail", assignment_id), lambda: self._detail(assignment_id), refresh)
        self.files.add(_shown_files(shown))              # also from the cache: the files are on screen again
        return shown

    def _detail(self, aid: int) -> dict:
        mixed = self._call(lambda c: _known(lambda: c.task_detail(aid)))
        if not isinstance(mixed, dict) or not mixed.get("taskPublishId"):
            raise NotFound()
        achievement = self._call(lambda c: _known(lambda: c.achievement(aid)))
        if not isinstance(achievement, dict):
            raise NotFound()
        comments = self._call(lambda c: c.comments(aid))
        me = self._call(lambda c: c.user_id)
        listed = self._listed(aid, achievement.get("achievementStatus") == mapping.ACHIEVEMENT_SUBMITTED)
        self._note_hand_in(aid, mixed, achievement)
        return mapping.detail(mixed, achievement, comments, me, self.submitted.get(aid), listed=listed)

    def _note_hand_in(self, aid: int, mixed: dict, achievement: dict) -> None:
        """Keep Yungu's hand-in whenever a read shows it (submitted, no draft open): that also covers a
        hand-in made on Yungu's website, which the service never saw."""
        shown = mapping.hand_in_on_yungu(mixed, achievement)
        if shown is not None and self.submitted.get(aid) != shown:
            self.submitted.put(aid, shown)

    def _listed(self, aid: int, submitted: bool) -> Optional[dict]:
        """The task's list row, which alone carries schoolGroup (To-do) and submittedAt (Submitted)."""
        rows = self.submitted_list() if submitted else self.todo()
        return next((a for a in rows if a["id"] == aid), None)

    def unread_count(self, refresh=False) -> dict:
        return self.cache.get(("notifications", "count"),
                              lambda: {"unread": self._call(lambda c: c.unread_count())}, refresh)

    def notifications(self, read: bool, page: int, size: int, refresh=False) -> dict:
        """One page of notifications, newest first. `hasMore` as Yungu's client decides it (what came so
        far is short of the total), and never after an empty page."""
        def compute():
            content = self._call(lambda c: c.notifications(read, page, size)) or {}
            rows = [r for r in content.get("data") or [] if isinstance(r, dict) and r.get("messageId") is not None]
            total = content.get("total") if isinstance(content.get("total"), int) else 0
            return {"items": [mapping.notification(r) for r in rows],
                    "hasMore": bool(rows) and (page - 1) * size + len(rows) < total}
        return self.cache.get(("notifications", read, page, size), compute, refresh)

    def mark_notification_read(self, message_id: int) -> None:
        """Yungu's answer was never observed before this shipped: anything but a success envelope is a 502,
        and its shape (types only) is logged so the first real press shows what it was."""
        try:
            answer = self._call(lambda c: c.mark_notification_read(message_id))
        finally:
            self.cache.clear()
        log.info("Mark read: Yungu answered %s", _shape_text(answer))

    def file_redirect(self, file_id: int, preview: bool, refresh=False) -> dict:
        self.files.require([file_id])

        def compute():
            return {"redirect": self._call(lambda c: _redirect(c, file_id, preview))}
        return self.cache.get(("file", file_id, preview), compute, refresh)

    # ------------------------------------------------------------- writes
    def _relation(self, client, aid: int) -> int:
        achievement = _known(lambda: client.achievement(aid))
        if not isinstance(achievement, dict) or not achievement.get("taskUserRelationId"):
            raise NotFound()
        return achievement["taskUserRelationId"]

    def upload(self, name: str, mime: str, data: bytes) -> dict:
        # No cache clear: an upload attaches the file to nothing, so no read changes until a draft save.
        up = self._call(lambda c: c.upload_bytes(name, mime, data))
        ref = mapping.file_ref({**(up.raw or {}), "fileId": up.file_id, "fileName": name, "fileSizeByte": len(data)})
        if not ref["createdAt"]:
            ref["createdAt"] = self.now_ms()
        self.files.add([ref["id"]])
        return ref

    def save_draft(self, aid: int, ids: List[int]) -> None:
        self.files.require(ids)
        try:
            self._call(lambda c: c.save_draft(self._relation(c, aid), ids))
        finally:
            self.cache.clear()

    def submit(self, aid: int, ids: List[int]) -> dict:
        if not ids:
            return self.mark_submitted(aid)
        self.files.require(ids)

        def go(c):
            c.save_draft(self._relation(c, aid), ids)        # the web UI saves the list, then submits it
            c.submit(aid, ids)                               # first submit vs update, by achievementId
        try:
            self._call(go)
        finally:
            self.cache.clear()
        self.submitted.put(aid, [str(i) for i in ids])
        return {"submittedAt": self.now_ms()}

    def _fresh(self, aid: int):
        """(mixed, achievement) straight from Yungu, never the cache: they decide a write."""
        achievement = self._call(lambda c: _known(lambda: c.achievement(aid)))
        if not isinstance(achievement, dict):
            raise NotFound()
        mixed = self._call(lambda c: _known(lambda: c.task_detail(aid)))
        if not isinstance(mixed, dict) or not mixed.get("taskPublishId"):
            raise NotFound()
        self._note_hand_in(aid, mixed, achievement)
        return mixed, achievement

    def mark_submitted(self, aid: int) -> dict:
        """An empty submit. Only when no file is required, nothing is handed in yet and the draft holds
        no files is it Yungu's "Mark as submitted" (a real hand-in: the teacher is told); anything else
        is refused with no Yungu write. The call goes through Yungu.call on its own, so the only resend
        is the one after a re-login, when Yungu turned the request away; the lock makes a concurrent
        second request wait and then find the assignment submitted. A press that finds it already
        marked (an earlier answer lost) answers success without sending another."""
        with self._marking:
            try:
                mixed, achievement = self._fresh(aid)
                # An earlier press reached Yungu but its answer (or the re-read) was lost: no second mark.
                already = self._already_marked(aid, mixed, achievement)
                if not already:
                    self._mark(aid, mixed, achievement)
            finally:
                self.cache.clear()
        if already:
            return {"submittedAt": self._hand_in_time(aid)}
        return {"submittedAt": self.now_ms()}

    def _mark(self, aid: int, mixed: dict, achievement: dict) -> None:
        # Only "not yet submitted" (status 1): an unknown or any other status is never marked.
        if (mapping.needs_files(mixed, achievement) or achievement.get("fileModelList")
                or mapping.achievement_status(mixed, achievement) != ACHIEVEMENT_NOT_SUBMITTED):
            raise BadRequest(ADD_A_FILE)
        task_id = achievement.get("taskId") or mixed.get("taskId")
        if not task_id:
            raise Unavailable()
        # Kept before sending: should Yungu apply the mark but its answer be lost, the next
        # press then knows the hand-in is empty (see _already_marked).
        self.submitted.put(aid, [])
        answer = self._call(lambda c: c.mark_submitted(task_id))
        log.info("Mark as submitted: Yungu answered %s", _shape_text(answer))   # types only (NOTES.md 8)
        try:
            after = self._call(lambda c: c.achievement(aid))
        except ServiceError:
            raise NotConfirmed() from None
        if not isinstance(after, dict) or not mapping.is_submitted(mixed, after):
            raise NotConfirmed()

    def _already_marked(self, aid: int, mixed: dict, achievement: dict) -> bool:
        """Handed in with no files and none required: Yungu shows an empty hand-in (no draft open), or
        the kept list says the dashboard marked it. An emptied draft after a hand-in with files is not."""
        if (mapping.needs_files(mixed, achievement) or achievement.get("fileModelList")
                or not mapping.is_submitted(mixed, achievement)):
            return False
        return mapping.hand_in_on_yungu(mixed, achievement) == [] or self.submitted.get(aid) == []

    def _hand_in_time(self, aid: int) -> int:
        """Yungu's hand-in time from the Submitted list when it has the row, else now."""
        try:
            row = self._listed(aid, True)
        except ServiceError:
            row = None
        at = (row or {}).get("submittedAt")
        return at if isinstance(at, int) else self.now_ms()

    def _doc_ref(self, content: Optional[dict], title: str, delta: str, file_id: Optional[int] = None) -> dict:
        raw = {**(content or {}), "type": mapping.ONLINE_DOCUMENT_TYPE}
        raw.setdefault("fileName", title)
        if file_id is not None and not raw.get("fileId"):
            raw["fileId"] = file_id
        ref = mapping.file_ref(raw)
        ref["content"] = delta                   # what we sent is what Yungu stores (storeMeta echoes it)
        if not ref["createdAt"]:
            ref["createdAt"] = self.now_ms()
        self.files.add([ref["id"]])
        return ref

    def create_doc(self, title: str, content: str) -> dict:
        """A new online document (new fileId), attached to nothing until a draft save or submit."""
        title = _checked_doc(title, content)
        try:
            made = self._call(lambda c: _doc_write(lambda: c.create_online_doc(title, content), content))
        finally:
            self.cache.clear()
        return self._doc_ref(made, title, content)

    def update_doc(self, aid: int, file_id: int, title: str, content: str) -> dict:
        """Rewrite a document in place, unless it is with the teacher (then the dashboard saves a new one)."""
        title = _checked_doc(title, content)
        self.files.require([file_id])                    # only a document this account was shown or made
        try:
            mixed, achievement = self._fresh(aid)
            if str(file_id) in mapping.handed_in_ids(mixed, achievement, self.submitted.get(aid)):
                raise Conflict(HANDED_IN_DOC)
            achievement_id = achievement.get("achievementId")
            made = self._call(lambda c: _doc_write(
                lambda: c.update_online_doc(file_id, title, content, achievement_id), content))
        finally:
            self.cache.clear()
        return self._doc_ref(made, title, content, file_id)

    def add_comment(self, aid: int, text: str) -> dict:
        try:
            self._call(lambda c: _known(lambda: c.add_comment(aid, text)))   # looks up the id first
            rows = self._call(lambda c: c.comments(aid))
            me = self._call(lambda c: c.user_id)
        finally:
            self.cache.clear()
        # saveCommentary returns nothing: the new comment is my newest one with this text (or, should
        # Yungu have altered the text, simply my newest one).
        mine = [r for r in rows or [] if r.get("userId") == me]
        same = [r for r in mine if r.get("descript") == text]
        if not mine:
            raise Unavailable()
        return mapping.comment(max(same or mine, key=lambda r: r["feedbackId"]), me)

    def delete_comment(self, aid: int, comment_id: str) -> None:
        """Only the student's own comments on this assignment; anything else is left alone and is a 404
        "Comment not found." (an unknown assignment stays the plain 404 "Not found.")."""
        try:
            rows = self._call(lambda c: _known(lambda: c.comments(aid)))
            me = self._call(lambda c: c.user_id)
            if not any(str(r.get("feedbackId")) == comment_id and r.get("userId") == me for r in rows or []):
                raise NotFound(COMMENT_NOT_FOUND)
            self._call(lambda c: c.delete_comment(int(comment_id)))
        finally:
            self.cache.clear()


# --------------------------------------------------------------------- app
def create_app(state_dir: Optional[str] = None, client_factory=yungu_client,
               now: Callable[[], float] = time.time, monotonic: Callable[[], float] = time.monotonic) -> FastAPI:
    service = Service(state_dir or os.environ.get("YUNGU_STATE_DIR") or DEFAULT_STATE_DIR,
                      client_factory, now, monotonic)
    app = FastAPI(title="Yungu LMS service", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.service = service
    app.add_middleware(CatchAll)

    @app.exception_handler(ServiceError)
    async def service_error(request, exc: ServiceError):
        return JSONResponse({"error": exc.message}, status_code=exc.status)

    @app.exception_handler(HTTPException)
    async def http_error(request, exc: HTTPException):
        message = exc.detail if isinstance(exc.detail, str) and exc.status_code != 404 else "Not found."
        return JSONResponse({"error": message}, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse({"error": "Bad request."}, status_code=400)

    def student(request: Request) -> Student:
        scheme, _, token = request.headers.get("authorization", "").partition(" ")
        if scheme.lower() != "bearer":
            raise SignInAgain()
        return service.student(token.strip())

    def refresh(request: Request) -> bool:
        return request.headers.get("x-refresh") == "1"

    Me = Depends(student)

    # ------------------------------------------------------------ session
    @app.post("/session")
    def sign_in(body: SignInBody):
        if not body.loginId.strip() or not body.password.strip():
            return {"ok": False, "error": BLANK_CREDENTIALS}
        try:
            return service.sign_in(body.loginId.strip(), body.password)
        except SignInRefused as e:
            return {"ok": False, "error": e.message}
        except TooManyAttempts as e:
            return JSONResponse({"ok": False, "error": e.message}, status_code=429)
        except Unavailable:
            return JSONResponse({"ok": False, "error": UNREACHABLE}, status_code=502)

    @app.delete("/session", status_code=204)
    def sign_out(me: Student = Me):
        me.sign_out()
        return Response(status_code=204)

    @app.post("/refresh", status_code=204)
    def clear_cache(me: Student = Me):
        me.cache.clear()
        return Response(status_code=204)

    # -------------------------------------------------------------- reads
    @app.get("/todo")
    def todo(request: Request, me: Student = Me):
        return me.todo(refresh(request))

    @app.get("/submitted")
    def submitted(request: Request, me: Student = Me):
        return me.submitted_list(refresh(request))

    @app.get("/week")
    def week(request: Request, start: int, me: Student = Me):
        return me.week(start, refresh(request))

    @app.get("/courses")
    def courses(request: Request, me: Student = Me):
        return me.courses(refresh(request))

    @app.get("/assignments/{assignment_id}")
    def detail(request: Request, assignment_id: int, me: Student = Me):
        return me.detail(assignment_id, refresh(request))

    @app.get("/notifications/count")
    def unread_count(request: Request, me: Student = Me):
        return me.unread_count(refresh(request))

    @app.get("/notifications")
    def notifications(request: Request, read: str = "", page: str = "1", size: str = "20", me: Student = Me):
        if read not in ("true", "false") or not ASCII_ID.fullmatch(page) or not ASCII_ID.fullmatch(size):
            raise BadRequest()
        if int(page) < 1 or not 1 <= int(size) <= NOTIFICATION_PAGE_MAX:
            raise BadRequest()
        return me.notifications(read == "true", int(page), int(size), refresh(request))

    @app.post("/notifications/{message_id}/read", status_code=204)
    def mark_notification_read(message_id: str, me: Student = Me):
        if not ASCII_ID.fullmatch(message_id):
            raise NotFound()
        me.mark_notification_read(int(message_id))
        return Response(status_code=204)

    @app.get("/files/{file_id}")
    def get_file(request: Request, file_id: str, preview: str = "0", me: Student = Me):
        if not file_id.isdigit():
            raise NotFound()
        return me.file_redirect(int(file_id), preview == "1", refresh(request))

    # ------------------------------------------------------------- writes
    @app.post("/files")
    async def upload(request: Request, me: Student = Me):
        declared = request.headers.get("content-length")
        if declared is not None:
            if not declared.isdigit():
                raise BadRequest()
            if int(declared) > MAX_UPLOAD_BYTES:
                raise TooLarge()                      # refused before a byte of the body is read
        limited = Request(request.scope, _limited(request.receive, MAX_UPLOAD_BYTES))
        try:
            form = await limited.form(max_files=1, max_fields=10)
        except _BodyTooLarge:
            raise TooLarge() from None
        except ClientDisconnect:
            raise BadRequest() from None
        try:
            part = form.get("file")
            if not isinstance(part, UploadFile) or not part.filename:
                raise BadRequest("Choose a file to upload.")
            data = await part.read()
            name = part.filename
            mime = part.content_type or mimetypes.guess_type(name)[0] or "application/octet-stream"
        finally:
            await form.close()
        return await run_in_threadpool(me.upload, name, mime, data)

    @app.put("/assignments/{assignment_id}/draft", status_code=204)
    def save_draft(assignment_id: int, body: FileIdsBody, me: Student = Me):
        me.save_draft(assignment_id, _file_ids(body.fileIds))
        return Response(status_code=204)

    @app.post("/assignments/{assignment_id}/submit")
    def submit(assignment_id: int, body: FileIdsBody, me: Student = Me):
        return me.submit(assignment_id, _file_ids(body.fileIds))

    @app.post("/assignments/{assignment_id}/online-docs")
    def create_doc(assignment_id: int, body: OnlineDocBody, me: Student = Me):
        return me.create_doc(body.title, body.content)

    @app.put("/assignments/{assignment_id}/online-docs/{file_id}")
    def update_doc(assignment_id: int, file_id: str, body: OnlineDocBody, me: Student = Me):
        if not ASCII_ID.fullmatch(file_id):
            raise NotFound()
        return me.update_doc(assignment_id, int(file_id), body.title, body.content)

    @app.post("/assignments/{assignment_id}/comments")
    def add_comment(assignment_id: int, body: TextBody, me: Student = Me):
        if not body.text.strip():
            raise BadRequest("Write a comment first.")
        return me.add_comment(assignment_id, body.text)

    @app.delete("/assignments/{assignment_id}/comments/{comment_id}", status_code=204)
    def delete_comment(assignment_id: int, comment_id: str, me: Student = Me):
        me.delete_comment(assignment_id, comment_id)
        return Response(status_code=204)

    return app


def _log_to_journal() -> None:
    """The service's own lines (yungu_lms.*) at INFO and up on stderr, which systemd keeps in the journal.
    Python only prints warnings when nothing is set up, and uvicorn sets up its own loggers only."""
    own = logging.getLogger("yungu_lms")
    if not own.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s: %(message)s"))
        own.addHandler(handler)
    own.setLevel(logging.INFO)


_log_to_journal()
app = create_app()
