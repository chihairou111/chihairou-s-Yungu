"""HTTP routes mirroring the dashboard's data seam (frontend/src/lib/data/index.ts, YunguData).

JSON everywhere; `Authorization: Bearer <token>` on everything except POST /session; errors are
`{"error": str}`. Reads are cached 60 s per endpoint + params (`X-Refresh: 1` bypasses); any write
or POST /refresh clears the cache. Run: `uvicorn service.app:app --host 127.0.0.1 --port 8100`
from api/, with YUNGU_STATE_DIR (default /var/lib/yungu-lms).
"""
import logging
import mimetypes
import os
import time
from datetime import datetime
from typing import Callable, List, Optional

from fastapi import Depends, FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException
from starlette.requests import ClientDisconnect

import mapping
from yungu_task import CST, SUBMITTED, TODO, YunguTask

from .auth import Auth
from .cache import ReadCache
from .state import StateDir, SubmittedFiles
from .yungu import UNREACHABLE, ServiceError, SignInAgain, SignInRefused, Unavailable, Yungu, checked_redirect

DEFAULT_STATE_DIR = "/var/lib/yungu-lms"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024 + 64 * 1024      # 50 MiB of file plus room for the multipart framing
TOO_LARGE = "Files up to 50 MB."
log = logging.getLogger("yungu_lms.app")
BLANK_CREDENTIALS = "Enter your student ID and password."


class NotFound(ServiceError):
    status = 404

    def __init__(self, message: str = "Not found."):
        super().__init__(message)


class BadRequest(ServiceError):
    status = 400

    def __init__(self, message: str = "Bad request."):
        super().__init__(message)


class TooLarge(ServiceError):
    status = 413

    def __init__(self):
        super().__init__(TOO_LARGE)


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
class Service:
    """What the routes do: Yungu calls through the shared session, mapping and the read cache."""

    def __init__(self, state_dir: str, client_factory, now: Callable[[], float], monotonic: Callable[[], float]):
        state = StateDir(state_dir)
        self.auth = Auth(state)
        self.yungu = Yungu(self.auth, client_factory, clock=monotonic)
        self.cache = ReadCache(clock=monotonic)
        self.submitted = SubmittedFiles(state)
        self._now = now

    def now_ms(self) -> int:
        return int(self._now() * 1000)

    # ------------------------------------------------------------ session
    def sign_in(self, login_id: str, password: str) -> dict:
        user = self.yungu.sign_in(login_id, password)
        self.cache.clear()
        return {"ok": True, "displayName": _display_name(user, login_id), "token": self.auth.issue_token()}

    def sign_out(self) -> None:
        self.yungu.sign_out()
        self.cache.clear()

    # -------------------------------------------------------------- reads
    def _assignments(self, status: int) -> List[dict]:
        rows = self.yungu.call(lambda c: list(c.iter_tasks(status)))
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
            days = self.yungu.call(lambda c: c.calendar_week(start_ms=monday))
            events = [mapping.class_event(e) for day in days or [] for e in day or []]
            return sorted(events, key=lambda e: e["start"])
        return self.cache.get(("week", monday), compute, refresh)

    def courses(self, refresh=False) -> List[dict]:
        return self.cache.get(("courses",), lambda: mapping.courses(self.yungu.call(lambda c: c.courses())), refresh)

    def detail(self, assignment_id: int, refresh=False) -> dict:
        return self.cache.get(("detail", assignment_id), lambda: self._detail(assignment_id), refresh)

    def _detail(self, aid: int) -> dict:
        mixed = self.yungu.call(lambda c: c.task_detail(aid))
        if not isinstance(mixed, dict) or not mixed.get("taskPublishId"):
            raise NotFound()
        achievement = self.yungu.call(lambda c: c.achievement(aid))
        if not isinstance(achievement, dict):
            raise NotFound()
        comments = self.yungu.call(lambda c: c.comments(aid))
        me = self.yungu.call(lambda c: c.user_id)
        listed = self._listed(aid, achievement.get("achievementStatus") == mapping.ACHIEVEMENT_SUBMITTED)
        return mapping.detail(mixed, achievement, comments, me, self.submitted.get(aid), listed=listed)

    def _listed(self, aid: int, submitted: bool) -> Optional[dict]:
        """The task's list row, which alone carries schoolGroup (To-do) and submittedAt (Submitted)."""
        rows = self.submitted_list() if submitted else self.todo()
        return next((a for a in rows if a["id"] == aid), None)

    def file_redirect(self, file_id: int, preview: bool, refresh=False) -> dict:
        def compute():
            return {"redirect": self.yungu.call(lambda c: checked_redirect(c.file_redirect(file_id, preview)))}
        return self.cache.get(("file", file_id, preview), compute, refresh)

    # ------------------------------------------------------------- writes
    def _relation(self, client, aid: int) -> int:
        achievement = client.achievement(aid)
        if not isinstance(achievement, dict) or not achievement.get("taskUserRelationId"):
            raise NotFound()
        return achievement["taskUserRelationId"]

    def upload(self, name: str, mime: str, data: bytes) -> dict:
        try:
            up = self.yungu.call(lambda c: c.upload_bytes(name, mime, data))
        finally:
            self.cache.clear()
        ref = mapping.file_ref({**(up.raw or {}), "fileId": up.file_id, "fileName": name, "fileSizeByte": len(data)})
        if not ref["createdAt"]:
            ref["createdAt"] = self.now_ms()
        return ref

    def save_draft(self, aid: int, ids: List[int]) -> None:
        try:
            self.yungu.call(lambda c: c.save_draft(self._relation(c, aid), ids))
        finally:
            self.cache.clear()

    def submit(self, aid: int, ids: List[int]) -> dict:
        def go(c):
            c.save_draft(self._relation(c, aid), ids)        # the web UI saves the list, then submits it
            c.submit(aid, ids)                               # first submit vs update, by achievementId
        try:
            self.yungu.call(go)
        finally:
            self.cache.clear()
        self.submitted.put(aid, [str(i) for i in ids])
        return {"submittedAt": self.now_ms()}

    def add_comment(self, aid: int, text: str) -> dict:
        try:
            self.yungu.call(lambda c: c.add_comment(aid, text))
            rows = self.yungu.call(lambda c: c.comments(aid))
            me = self.yungu.call(lambda c: c.user_id)
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
        """Only the student's own comments on this assignment; anything else is left alone."""
        if not comment_id.isdigit():
            return
        try:
            rows = self.yungu.call(lambda c: c.comments(aid))
            me = self.yungu.call(lambda c: c.user_id)
            if any(str(r.get("feedbackId")) == comment_id and r.get("userId") == me for r in rows or []):
                self.yungu.call(lambda c: c.delete_comment(int(comment_id)))
        finally:
            self.cache.clear()


# --------------------------------------------------------------------- app
def create_app(state_dir: Optional[str] = None, client_factory=YunguTask,
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

    def require_token(request: Request) -> None:
        scheme, _, token = request.headers.get("authorization", "").partition(" ")
        if scheme.lower() != "bearer" or not service.auth.valid(token.strip()):
            raise SignInAgain()

    def refresh(request: Request) -> bool:
        return request.headers.get("x-refresh") == "1"

    authed = [Depends(require_token)]

    # ------------------------------------------------------------ session
    @app.post("/session")
    def sign_in(body: SignInBody):
        if not body.loginId.strip() or not body.password.strip():
            return {"ok": False, "error": BLANK_CREDENTIALS}
        try:
            return service.sign_in(body.loginId.strip(), body.password)
        except SignInRefused as e:
            return {"ok": False, "error": e.message}
        except Unavailable:
            return JSONResponse({"ok": False, "error": UNREACHABLE}, status_code=502)

    @app.delete("/session", status_code=204, dependencies=authed)
    def sign_out():
        service.sign_out()
        return Response(status_code=204)

    @app.post("/refresh", status_code=204, dependencies=authed)
    def clear_cache():
        service.cache.clear()
        return Response(status_code=204)

    # -------------------------------------------------------------- reads
    @app.get("/todo", dependencies=authed)
    def todo(request: Request):
        return service.todo(refresh(request))

    @app.get("/submitted", dependencies=authed)
    def submitted(request: Request):
        return service.submitted_list(refresh(request))

    @app.get("/week", dependencies=authed)
    def week(request: Request, start: int):
        return service.week(start, refresh(request))

    @app.get("/courses", dependencies=authed)
    def courses(request: Request):
        return service.courses(refresh(request))

    @app.get("/assignments/{assignment_id}", dependencies=authed)
    def detail(request: Request, assignment_id: int):
        return service.detail(assignment_id, refresh(request))

    @app.get("/files/{file_id}", dependencies=authed)
    def get_file(request: Request, file_id: str, preview: str = "0"):
        if not file_id.isdigit():
            raise NotFound()
        return service.file_redirect(int(file_id), preview == "1", refresh(request))

    # ------------------------------------------------------------- writes
    @app.post("/files", dependencies=authed)
    async def upload(request: Request):
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
        return await run_in_threadpool(service.upload, name, mime, data)

    @app.put("/assignments/{assignment_id}/draft", status_code=204, dependencies=authed)
    def save_draft(assignment_id: int, body: FileIdsBody):
        service.save_draft(assignment_id, _file_ids(body.fileIds))
        return Response(status_code=204)

    @app.post("/assignments/{assignment_id}/submit", dependencies=authed)
    def submit(assignment_id: int, body: FileIdsBody):
        return service.submit(assignment_id, _file_ids(body.fileIds))

    @app.post("/assignments/{assignment_id}/comments", dependencies=authed)
    def add_comment(assignment_id: int, body: TextBody):
        if not body.text.strip():
            raise BadRequest("Write a comment first.")
        return service.add_comment(assignment_id, body.text)

    @app.delete("/assignments/{assignment_id}/comments/{comment_id}", status_code=204, dependencies=authed)
    def delete_comment(assignment_id: int, comment_id: str):
        service.delete_comment(assignment_id, comment_id)
        return Response(status_code=204)

    return app


app = create_app()
