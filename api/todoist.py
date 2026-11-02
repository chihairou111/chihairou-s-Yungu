"""Client for the Todoist API v1 (https://developer.todoist.com/api/v1/), just what the Yungu sync uses.

Endpoints, fields and error semantics are written up in api/NOTES.md section 12. One TodoistClient per
account token; the token is never logged, put in an exception or shown in a repr.

    c = TodoistClient(token)
    c.ensure_label("Yungu")
    c.create_task("[CL Business] 1.8B Case Study", "https://…/assignments?task=93251",
                  due_datetime(deadline_ms), ["Yungu"])
"""
import logging
import re
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional
from urllib.parse import urlencode

import requests

API = "https://api.todoist.com/api/v1"
AUTHORIZE_URL = "https://app.todoist.com/oauth/authorize"
TOKEN_URL = "https://api.todoist.com/oauth/access_token"
SCOPE = "data:read_write"
TIMEOUT = (5, 20)          # connect, read; Todoist's own processing limit is 15 s
PAGE_LIMIT = 200           # the maximum page size
MAX_PAGES = 50             # 10 000 objects: a guard against a cursor loop, far beyond real use

log = logging.getLogger("yungu_lms.todoist")


class TodoistError(Exception):
    """Todoist refused the request (a 4xx other than the ones below). Messages never carry the token."""

    def __init__(self, msg: str, status: Optional[int] = None):
        super().__init__(msg)
        self.status = status


class TodoistAuthError(TodoistError):
    """The token (or OAuth code / refresh token) was rejected: the user must connect again."""


class TodoistNotFound(TodoistError):
    """404: the object is gone (e.g. the user deleted the task)."""


class TodoistUnavailable(TodoistError):
    """Network error, timeout, 429, 5xx or a non-JSON answer: try again later (after `retry_after` s if set)."""

    def __init__(self, msg: str, status: Optional[int] = None, retry_after: Optional[int] = None):
        super().__init__(msg, status)
        self.retry_after = retry_after


def due_datetime(ms: int) -> str:
    """A deadline (epoch ms) as Todoist's `due_datetime`: the exact instant in UTC, RFC 3339 with `Z`.
    Todoist stores it as a fixed-time due (not floating) and shows it in the user's time zone."""
    return datetime.fromtimestamp(ms // 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _retry_after(resp: requests.Response, body) -> Optional[int]:
    for value in (resp.headers.get("Retry-After"),
                  (body.get("error_extra") or {}).get("retry_after") if isinstance(body, dict) else None):
        try:
            if value is not None:
                return max(0, int(value))
        except (TypeError, ValueError):
            pass
    return None


def _describe(body) -> str:
    """The non-secret part of an error body: Todoist's error tag / message."""
    if isinstance(body, dict):
        return str(body.get("error_tag") or body.get("error") or "")[:80]
    return ""


def _send(method: str, url: str, what: str, **kw) -> requests.Response:
    try:
        return requests.request(method, url, timeout=TIMEOUT, **kw)
    except requests.RequestException as e:
        raise TodoistUnavailable(f"Todoist {what}: {type(e).__name__}") from None


def _json(resp: requests.Response, what: str):
    try:
        return resp.json()
    except ValueError:
        raise TodoistUnavailable(f"Todoist {what}: HTTP {resp.status_code}, not JSON", resp.status_code) from None


# A 403 is about the token only when Todoist says so (an invalid token, a missing scope); any other 403 (a plan
# limit, a forbidden object) is a refusal of that one request, not "connect again".
_AUTH_TAG = re.compile(r"AUTH|TOKEN|SCOPE", re.IGNORECASE)


def _raise_for(resp: requests.Response, what: str, auth_statuses=(401,)) -> None:
    status = resp.status_code
    if status < 400:
        return
    try:
        body = resp.json()
    except ValueError:
        body = None
    detail = f"Todoist {what}: HTTP {status} {_describe(body)}".rstrip()
    tag = str(body.get("error_tag") or "") if isinstance(body, dict) else ""
    if status in auth_statuses or (status == 403 and _AUTH_TAG.search(tag)):
        raise TodoistAuthError(detail, status)
    if status == 429 or status >= 500:
        raise TodoistUnavailable(detail, status, _retry_after(resp, body))
    if status == 404:
        raise TodoistNotFound(detail, status)
    raise TodoistError(detail, status)


class TodoistClient:
    def __init__(self, token: str, *, refresh: Optional[Callable[[], str]] = None):
        """`refresh`, when given, is called once on a 401 to get a new access token (OAuth apps with refresh
        tokens: access tokens last an hour); the request is then retried with it. It may raise
        TodoistAuthError (the user must connect again)."""
        self.token = token
        self._refresh = refresh
        self._labels_ok = set()       # label names known to exist (casefolded)

    def __repr__(self):
        return "TodoistClient(<token>)"

    # ------------------------------------------------------------- transport
    def _request(self, method: str, path: str, what: str, *, params=None, json_body=None) -> Optional[object]:
        retried = False
        while True:
            resp = _send(method, f"{API}{path}", what, params=params, json=json_body,
                         headers={"Authorization": f"Bearer {self.token}"})
            if resp.status_code == 401 and self._refresh is not None and not retried:
                retried = True
                log.info("Todoist access token rejected; refreshing it")
                self.token = self._refresh()
                continue
            _raise_for(resp, what)
            if not resp.content:
                return None
            return _json(resp, what)

    def _pages(self, path: str, what: str, params: Dict[str, str]) -> List[dict]:
        out: List[dict] = []
        cursor = None
        for _ in range(MAX_PAGES):
            page = self._request("GET", path, what, params={**params, "limit": PAGE_LIMIT,
                                                            **({"cursor": cursor} if cursor else {})})
            if not isinstance(page, dict) or not isinstance(page.get("results"), list):
                raise TodoistUnavailable(f"Todoist {what}: unexpected answer")
            out.extend(r for r in page["results"] if isinstance(r, dict))
            cursor = page.get("next_cursor")
            if not cursor:
                return out
        log.warning("Todoist %s: stopped after %d pages", what, MAX_PAGES)
        return out

    # ------------------------------------------------------------- API
    def me(self) -> dict:
        """GET /user → {id, name, email, timezone}. (The answer also holds the token: never passed on.)"""
        u = self._request("GET", "/user", "user")
        if not isinstance(u, dict):
            raise TodoistUnavailable("Todoist user: unexpected answer")
        return {"id": str(u.get("id") or ""), "name": u.get("full_name") or "", "email": u.get("email") or "",
                "timezone": (u.get("tz_info") or {}).get("timezone")}

    def labels(self) -> List[dict]:
        """GET /labels (personal labels, all pages)."""
        return self._pages("/labels", "labels", {})

    def ensure_label(self, name: str) -> None:
        """Create the personal label `name` unless one exists (names compared case-insensitively)."""
        key = name.casefold()
        if key in self._labels_ok:
            return
        if not any(str(l.get("name", "")).casefold() == key for l in self.labels()):
            self._request("POST", "/labels", "create label", json_body={"name": name})
            log.info("created the Todoist label %s", name)
        self._labels_ok.add(key)

    def find_tasks(self, label: str) -> List[dict]:
        """GET /tasks?label= : the open (not completed, not deleted) tasks with that label, all pages."""
        tasks = self._pages("/tasks", "tasks", {"label": label})
        return [t for t in tasks if not t.get("checked") and not t.get("is_deleted")]

    def get_task(self, task_id: str) -> Optional[dict]:
        """GET /tasks/{id}; None when it is gone (404). A completed task may come back `checked`."""
        try:
            t = self._request("GET", f"/tasks/{task_id}", "task")
        except TodoistNotFound:
            return None
        return t if isinstance(t, dict) else None

    def create_task(self, content: str, description: str, due_datetime: Optional[str], labels: List[str]) -> dict:
        """POST /tasks. No project_id: the task goes to the user's Inbox. `due_datetime` UTC RFC 3339 or None."""
        body = {"content": content, "description": description}
        if due_datetime:
            body["due_datetime"] = due_datetime
        body["labels"] = list(labels)
        t = self._request("POST", "/tasks", "create task", json_body=body)
        if not isinstance(t, dict) or not t.get("id"):
            raise TodoistUnavailable("Todoist create task: unexpected answer")
        return t

    def update_due(self, task_id: str, due_datetime: Optional[str]) -> None:
        """POST /tasks/{id} with only the due (None clears it); other fields stay as the user left them."""
        body = {"due_datetime": due_datetime} if due_datetime else {"due_string": "no date"}
        self._request("POST", f"/tasks/{task_id}", "update task", json_body=body)


# ------------------------------------------------------------------- OAuth (authorization code flow)
def authorize_url(client_id: str, state: str, redirect_uri: str, scope: str = SCOPE) -> str:
    return AUTHORIZE_URL + "?" + urlencode({"client_id": client_id, "scope": scope, "state": state,
                                            "response_type": "code", "redirect_uri": redirect_uri})


def _token_answer(resp: requests.Response, what: str) -> dict:
    # Todoist answers OAuth errors with 400 {"error": "bad_authorization_code" | "invalid_grant" | ...}
    _raise_for(resp, what, auth_statuses=(400, 401, 403))
    body = _json(resp, what)
    if not isinstance(body, dict) or not body.get("access_token"):
        raise TodoistUnavailable(f"Todoist {what}: unexpected answer")
    return {"access_token": body["access_token"], "refresh_token": body.get("refresh_token"),
            "expires_in": body.get("expires_in")}


def exchange_code(client_id: str, client_secret: str, code: str, redirect_uri: str) -> dict:
    """POST /oauth/access_token (form) → {access_token, refresh_token (None for legacy apps), expires_in}."""
    resp = _send("POST", TOKEN_URL, "token exchange", data={"client_id": client_id, "client_secret": client_secret,
                                                            "code": code, "redirect_uri": redirect_uri})
    return _token_answer(resp, "token exchange")


def refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> dict:
    """POST /oauth/access_token grant_type=refresh_token → same shape. The refresh token rotates: store the
    new one. A repeat within 60 s answers without one, and the old one is then consumed (presenting it again
    after 60 s makes Todoist revoke all the user's tokens): drop it, never keep it (see make_client).
    `invalid_grant` → TodoistAuthError."""
    resp = _send("POST", TOKEN_URL, "token refresh", data={"client_id": client_id, "client_secret": client_secret,
                                                           "grant_type": "refresh_token",
                                                           "refresh_token": refresh_token})
    return _token_answer(resp, "token refresh")


def revoke_token(client_id: str, client_secret: str, token: str) -> None:
    """POST /api/v1/revoke (RFC 7009; form body, HTTP Basic client auth)."""
    resp = _send("POST", f"{API}/revoke", "revoke", auth=(client_id, client_secret),
                 data={"token": token, "token_type_hint": "access_token"})
    _raise_for(resp, "revoke")
