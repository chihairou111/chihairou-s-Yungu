"""FastAPI service (api/service/). TestClient + fake Yungu clients; the network is never touched."""
import asyncio
import base64
import functools
import json
import math
import os
import re
import socket
import stat
import threading

import pytest
import requests
import responses
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

import mapping
from service.app import LIST_PAGE_SIZE, MAX_UPLOAD_BYTES, YUNGU_TIMEOUT_SECONDS, create_app
from service.yungu import LOGIN_RETRY_SECONDS
from yungu_task import BASE, SUBMITTED, TODO, UploadedFile, YunguError, YunguTask

ME, OTHER = 106, 207
PW_CHANGED = "Sign in again — your Yungu password may have changed."
SIGN_IN_AGAIN = "Sign in again."
UNREACHABLE = "Can't reach Yungu right now. Try again."
ANOTHER = "This dashboard belongs to another account."
TOO_LARGE = "Files up to 50 MB."
NOW = 1792800000.0          # Sat 2026-10-24 (China), in seconds


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*a, **k):
        raise AssertionError("test tried to open a network connection")
    monkeypatch.setattr(socket.socket, "connect", refuse)


# ------------------------------------------------------------------ fakes
def json_response(body, status=200, headers=None):
    r = requests.Response()
    r.status_code = status
    r._content = json.dumps(body).encode()
    r.headers.update(headers or {})
    r.headers["Content-Type"] = "application/json"
    return r


def expired_error():
    return YunguError("GET /api/x -> code=1000 message=未登录", json_response({"code": 1000, "ifLogin": False}))


class Clock:
    def __init__(self, t=NOW):
        self.t = t

    def __call__(self):
        return self.t


class World:
    """Yungu as the fakes see it: accounts, sessions, data and a call log."""

    def __init__(self, load):
        self.accounts = {
            "S106": {"password": "hunter2-xyz", "user": {"userId": ME, "userName": "郑博纬", "eName": "Bruce Zheng"}},
            "S207": {"password": "other", "user": {"userId": OTHER, "userName": "别人", "eName": "Someone"}},
        }
        self.logins = []                # loginIds of every login attempt
        self.sessions = 0               # serial of the latest successful login
        self.valid_from = 0             # sessions with a serial below this are expired
        self.calls = []                 # (method, args)
        self.fail = None                # exception every data call raises
        self.barrier = None             # expired calls wait here (concurrency test)
        self.redirect = "https://yungu-common.oss-cn-hangzhou.aliyuncs.com/taskFile/a.pdf?Signature=x"
        todo = load("todo_page.json")
        sub = load("submitted_page1.json")
        self.lists = {
            TODO: [{**t, "group": g["groupName"]} for g in todo["data"] for t in g["taskList"]],
            SUBMITTED: [{**t, "group": g["groupName"]} for g in sub["data"] for t in g["taskList"]],
        }
        self.courses = load("courses.json")
        self.week = load("week.json")
        self.mixed = {93251: load("mixed_93251.json"), 94929: load("mixed_todo.json")}
        self.ach = {93251: load("achievement_93251.json"), 94929: load("achievement_todo.json")}
        self.comments = {93251: load("comments_sample.json"), 94929: []}
        self.next_feedback = 400000
        self.page_sizes = []            # page_size of every iter_tasks call
        self.next_doc = 11130500        # fileId of the next online document created
        self.doc_error = None           # exception create/update_online_doc raise
        self.mark_confirms = True       # mark_submitted moves the achievement to status 4
        self.after_mark = None          # callable run right after mark_submitted (expiry, blocking)
        self.mark_answer = None         # what mark_submitted returns (Yungu's `content`)

    def expire_all(self):
        self.valid_from = self.sessions + 1

    def count(self, name):
        return sum(1 for c in self.calls if c[0] == name)


class FakeClient:
    def __init__(self, world, login_id, password):
        self.w, self.login_id, self.password = world, login_id, password
        self.serial = -1
        self.user = None

    def login(self):
        self.w.logins.append(self.login_id)
        acct = self.w.accounts.get(self.login_id)
        if not acct or acct["password"] != self.password:
            raise YunguError("login failed: 账号或密码错误",
                             json_response({"success": False, "msg": "账号或密码错误", "code": 1}))
        self.w.sessions += 1
        self.serial = self.w.sessions
        self.user = dict(acct["user"])
        return self.user

    @property
    def user_id(self):
        return self.user["userId"]

    def _hit(self, name, *args):
        self.w.calls.append((name, args))
        if self.w.fail is not None:
            raise self.w.fail
        if self.serial < self.w.valid_from:
            if self.w.barrier is not None:
                self.w.barrier.wait(10)
            raise expired_error()

    def courses(self):
        self._hit("courses")
        return self.w.courses

    def iter_tasks(self, status=TODO, page_size=10, **kw):
        self._hit("iter_tasks", status)
        self.w.page_sizes.append(page_size)
        return iter([dict(t) for t in self.w.lists[status]])

    def calendar_week(self, day=None, start_ms=None):
        self._hit("calendar_week", start_ms)
        return self.w.week

    def task_detail(self, publish_id):
        self._hit("task_detail", publish_id)
        return self.w.mixed.get(publish_id)

    def achievement(self, publish_id, team_id=None):
        self._hit("achievement", publish_id)
        return self.w.ach.get(publish_id)

    def comments(self, publish_id, team_id=None):
        self._hit("comments", publish_id)
        return sorted(self.w.comments.get(publish_id, []), key=lambda c: -c["feedbackId"])

    def upload_bytes(self, name, mime, data):
        self._hit("upload_bytes", name, mime, len(data))
        return UploadedFile(11130001, name, {"fileId": 11130001, "fileName": name})

    def file_redirect(self, file_id, preview):
        self._hit("file_redirect", file_id, preview)
        return self.w.redirect

    def save_draft(self, task_user_relation_id, file_ids):
        self._hit("save_draft", task_user_relation_id, list(file_ids))
        return {"code": 0}

    def submit(self, publish_id, file_ids, team_id=None):
        self._hit("submit", publish_id, list(file_ids))
        return {"code": 0}

    def add_comment(self, publish_id, text):
        self._hit("add_comment", publish_id, text)
        self.w.next_feedback += 1
        self.w.comments.setdefault(publish_id, []).append({
            "feedbackId": self.w.next_feedback, "parentId": None, "userId": self.user_id, "userName": "郑博纬",
            "eName": "Bruce Zheng", "descript": text, "feedbackTime": "2026-10-19 23:00:00",
            "deletePermission": False})

    def delete_comment(self, feedback_id):
        self._hit("delete_comment", feedback_id)

    def _doc(self, file_id, title, delta):
        if self.w.doc_error is not None:
            raise self.w.doc_error
        return {"fileId": file_id, "fileName": title, "type": "onlineDocument", "storeMeta": delta,
                "previewImage": "/api/file/preview?previewId=9", "url": None}

    def create_online_doc(self, title, delta_json):
        self._hit("create_online_doc", title, delta_json)
        self.w.next_doc += 1
        return self._doc(self.w.next_doc, title, delta_json)

    def update_online_doc(self, file_id, title, delta_json, achievement_id):
        self._hit("update_online_doc", file_id, title, delta_json, achievement_id)
        return self._doc(file_id, title, delta_json)

    def mark_submitted(self, task_id):
        self._hit("mark_submitted", task_id)
        if self.w.after_mark is not None:          # before the status changes: a racing read sees status 1
            self.w.after_mark()
        if self.w.mark_confirms:
            for ach in self.w.ach.values():
                if ach.get("taskId") == task_id:
                    ach["achievementStatus"] = 4
        return self.w.mark_answer


@pytest.fixture
def world(load):
    return World(load)


@pytest.fixture
def state_dir(tmp_path):
    return tmp_path / "state"


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def make(world, state_dir, clock):
    def _make(factory=None):
        app = create_app(state_dir=str(state_dir),
                         client_factory=factory or (lambda login_id, pw: FakeClient(world, login_id, pw)),
                         now=clock, monotonic=clock)
        return TestClient(app)
    return _make


@pytest.fixture
def api(make):
    return make()


def sign_in(api, login_id="S106", password="hunter2-xyz"):
    r = api.post("/session", json={"loginId": login_id, "password": password})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True, body
    return {"Authorization": f"Bearer {body['token']}"}


@pytest.fixture
def auth(api):
    return sign_in(api)


def mode(path):
    return stat.S_IMODE(os.stat(path).st_mode)


# ---------------------------------------------------------------- sign-in
def test_sign_in_stores_0600_credentials_and_returns_a_token(api, state_dir, world):
    r = api.post("/session", json={"loginId": "S106", "password": "hunter2-xyz"})
    body = r.json()
    assert r.status_code == 200 and body["ok"] is True and body["displayName"] == "Bruce Zheng"
    assert isinstance(body["token"], str) and len(body["token"]) >= 32
    assert mode(state_dir) == 0o700
    files = sorted(p.name for p in state_dir.iterdir())
    assert files and all(mode(state_dir / f) == 0o600 for f in files)
    creds = json.loads((state_dir / "credentials.json").read_text())
    assert creds == {"loginId": "S106", "password": "hunter2-xyz"}
    on_disk = "".join((state_dir / f).read_text() for f in files)
    assert body["token"] not in on_disk                     # only a hash of each token is stored
    assert world.logins == ["S106"]


def test_wrong_password_returns_yungus_message_and_stores_nothing(api, state_dir):
    r = api.post("/session", json={"loginId": "S106", "password": "nope"})
    assert r.status_code == 200 and r.json() == {"ok": False, "error": "账号或密码错误"}
    assert not (state_dir / "credentials.json").exists()


def test_blank_credentials_are_refused_without_calling_yungu(api, world):
    r = api.post("/session", json={"loginId": " ", "password": ""})
    assert r.json() == {"ok": False, "error": "Enter your student ID and password."}
    assert world.logins == []


def test_second_account_is_refused_and_does_not_replace_the_owner(api, state_dir, world, auth):
    r = api.post("/session", json={"loginId": "S207", "password": "other"})
    assert r.json() == {"ok": False, "error": ANOTHER}
    assert json.loads((state_dir / "credentials.json").read_text())["loginId"] == "S106"
    assert api.get("/courses", headers=auth).status_code == 200        # owner's session still works


def test_signing_in_again_with_a_new_password_replaces_the_stored_one(api, state_dir, world, auth):
    world.accounts["S106"]["password"] = "new"
    sign_in(api, password="new")
    assert json.loads((state_dir / "credentials.json").read_text())["password"] == "new"
    assert api.get("/courses", headers=auth).status_code == 200        # earlier tokens stay valid


def test_sign_in_while_yungu_is_unreachable_is_a_502(api, world, state_dir):
    def broken(login_id, pw):
        c = FakeClient(world, login_id, pw)
        c.login = lambda: (_ for _ in ()).throw(requests.ConnectionError("down"))
        return c
    api.app.state.service.yungu._factory = broken
    r = api.post("/session", json={"loginId": "S106", "password": "hunter2-xyz"})
    assert r.status_code == 502 and r.json() == {"ok": False, "error": UNREACHABLE}
    assert not (state_dir / "credentials.json").exists()


ENDPOINTS = [
    ("GET", "/todo", None), ("GET", "/submitted", None), ("GET", "/week?start=1792800000000", None),
    ("GET", "/courses", None), ("GET", "/assignments/93251", None), ("GET", "/files/11128687?preview=1", None),
    ("POST", "/files", None), ("PUT", "/assignments/93251/draft", {"fileIds": []}),
    ("POST", "/assignments/93251/submit", {"fileIds": []}), ("POST", "/assignments/93251/comments", {"text": "x"}),
    ("DELETE", "/assignments/93251/comments/327994", None), ("POST", "/refresh", None), ("DELETE", "/session", None),
    ("POST", "/assignments/94929/online-docs", {"title": "t", "content": "{}"}),
    ("PUT", "/assignments/94929/online-docs/11130500", {"title": "t", "content": "{}"}),
]


@pytest.mark.parametrize("method,path,body", ENDPOINTS)
@pytest.mark.parametrize("header", [None, "Bearer wrong-token", "wrong-scheme x", "Bearer "])
def test_every_endpoint_needs_a_valid_token(api, world, auth, method, path, body, header):
    calls = len(world.calls)
    headers = {} if header is None else {"Authorization": header}
    r = api.request(method, path, json=body, headers=headers)
    assert r.status_code == 401 and r.json() == {"error": SIGN_IN_AGAIN}
    assert len(world.calls) == calls


def test_tokens_survive_a_restart(make, world, auth):
    restarted = make()                                   # new app instance, same state dir
    r = restarted.get("/courses", headers=auth)
    assert r.status_code == 200
    assert world.logins == ["S106", "S106"]              # the new instance signed in with the saved password


def test_state_dir_comes_from_the_environment(monkeypatch, tmp_path, world):
    monkeypatch.setenv("YUNGU_STATE_DIR", str(tmp_path / "env-state"))
    api = TestClient(create_app(client_factory=lambda l, p: FakeClient(world, l, p)))
    sign_in(api)
    assert (tmp_path / "env-state" / "credentials.json").exists()


def test_sign_out_deletes_credentials_and_tokens(make, api, world, state_dir, auth):
    second = sign_in(api)
    r = api.delete("/session", headers=auth)
    assert r.status_code == 204 and r.content == b""
    assert not (state_dir / "credentials.json").exists()
    assert api.get("/courses", headers=auth).json() == {"error": SIGN_IN_AGAIN}
    assert api.get("/courses", headers=second).status_code == 401
    assert make().get("/courses", headers=second).status_code == 401     # also after a restart
    assert api.post("/session", json={"loginId": "S207", "password": "other"}).json()["error"] == ANOTHER


# ------------------------------------------------------------------ reads
def test_todo_maps_every_item_in_yungus_order_without_duplicates(api, world, auth, clock):
    first = world.lists[TODO][0]
    world.lists[TODO] = [first, {**first, "taskPublishId": 1, "title": "B"}, dict(first)]   # page shift duplicate
    got = api.get("/todo", headers=auth).json()
    assert [a["id"] for a in got] == [first["taskPublishId"], 1]
    assert got[0] == mapping.assignment(first, first["group"], int(clock() * 1000))


def test_submitted_is_deduped_and_newest_hand_in_first(api, world, auth):
    rows = world.lists[SUBMITTED]
    world.lists[SUBMITTED] = rows + rows[:3]
    got = api.get("/submitted", headers=auth).json()
    ids = [a["id"] for a in got]
    assert len(ids) == len(set(ids)) == len(rows)
    stamps = [a["submittedAt"] for a in got]
    assert stamps == sorted(stamps, reverse=True)
    assert all(a["status"] == "Submitted" and a["schoolGroup"] is None for a in got)


def test_week_is_flattened_sorted_and_starts_on_the_china_monday(api, world, auth):
    monday = 1792339200000            # Mon 2026-10-19 00:00 China time
    got = api.get(f"/week?start={monday + 3 * 3600 * 1000 + 86400 * 1000 * 2}", headers=auth).json()
    assert world.calls[-1] == ("calendar_week", (monday,))
    assert len(got) == sum(len(d) for d in world.week)
    assert [e["start"] for e in got] == sorted(e["start"] for e in got)
    assert got[0] == mapping.class_event(min((e for d in world.week for e in d), key=lambda e: e["startTime"]))


def test_week_without_a_valid_start_is_a_400(api, auth):
    assert api.get("/week", headers=auth).status_code == 400
    r = api.get("/week?start=soon", headers=auth)
    assert r.status_code == 400 and "error" in r.json()
    assert api.get("/week?start=99999999999999999999", headers=auth).status_code == 400


def test_courses_are_mapped(api, world, auth):
    assert api.get("/courses", headers=auth).json() == mapping.courses(world.courses)


def test_detail_combines_listing_detail_achievement_and_comments(api, world, auth):
    row = world.lists[SUBMITTED][0]
    world.lists[SUBMITTED][0] = {**row, "taskPublishId": 93251}
    d = api.get("/assignments/93251", headers=auth).json()
    listed = mapping.assignment(world.lists[SUBMITTED][0], "list", int(NOW * 1000))
    assert d == mapping.detail(world.mixed[93251], world.ach[93251], world.comments[93251], ME, None, listed=listed)
    assert d["submittedAt"] == listed["submittedAt"]
    assert [c["mine"] for c in d["comments"]] == [False, True, False]


def test_detail_carries_the_teachers_feedback(api, world, auth, load):
    sample = load("feedback_samples.json")["level_rubric"]
    world.mixed[93251] = {**world.mixed[93251], **sample["mixed"]}
    world.ach[93251] = {**world.ach[93251], **sample["achievement"]}
    f = api.get("/assignments/93251", headers=auth).json()["feedback"]
    assert f["score"] == "Advanced [4]" and f["criteria"][0]["result"] == "Proficient"


def test_todo_detail_takes_the_school_group_from_the_todo_list(api, world, auth):
    d = api.get("/assignments/94929", headers=auth).json()
    assert d["schoolGroup"] == "Due recently" and d["submitted"] is False


def test_unknown_assignment_is_a_404(api, auth):
    r = api.get("/assignments/1", headers=auth)
    assert r.status_code == 404 and "error" in r.json()
    assert api.get("/assignments/abc", headers=auth).status_code in (400, 404)


def test_file_redirect(api, world, auth):
    r = api.get("/files/11128687?preview=1", headers=auth)
    assert r.json() == {"redirect": world.redirect}
    assert world.calls[-1] == ("file_redirect", (11128687, True))
    api.get("/files/11128687", headers=auth)
    assert world.calls[-1] == ("file_redirect", (11128687, False))
    assert api.get("/files/../etc", headers=auth).status_code == 404


# ------------------------------------------------------------------ cache
def test_reads_are_cached_for_60_seconds(api, world, auth, clock):
    api.get("/courses", headers=auth)
    clock.t += 59
    api.get("/courses", headers=auth)
    assert world.count("courses") == 1
    clock.t += 2
    api.get("/courses", headers=auth)
    assert world.count("courses") == 2


def test_cache_is_per_endpoint_and_params(api, world, auth):
    api.get("/week?start=1792339200000", headers=auth)
    api.get("/week?start=1792944000000", headers=auth)
    api.get("/week?start=1792339200000", headers=auth)
    assert world.count("calendar_week") == 2


def test_x_refresh_bypasses_the_cache(api, world, auth):
    api.get("/courses", headers=auth)
    api.get("/courses", headers={**auth, "X-Refresh": "1"})
    api.get("/courses", headers=auth)                    # the refreshed value is cached again
    assert world.count("courses") == 2


def test_refresh_clears_the_cache(api, world, auth):
    api.get("/courses", headers=auth)
    assert api.post("/refresh", headers=auth).status_code == 204
    api.get("/courses", headers=auth)
    assert world.count("courses") == 2


@pytest.mark.parametrize("method,path,body", [
    ("PUT", "/assignments/94929/draft", {"fileIds": ["11128687"]}),
    ("POST", "/assignments/94929/submit", {"fileIds": ["11128687"]}),
    ("POST", "/assignments/93251/comments", {"text": "好的"}),
    ("DELETE", "/assignments/93251/comments/327994", None),
    ("POST", "/assignments/94929/online-docs", {"title": "研究", "content": '{"ops":[{"insert":"x\\n"}]}'}),
    ("PUT", "/assignments/94929/online-docs/11130500", {"title": "研究", "content": '{"ops":[{"insert":"x\\n"}]}'}),
    ("POST", "/assignments/94929/submit", {"fileIds": []}),                 # mark as submitted
])
def test_writes_clear_the_cache(api, world, auth, method, path, body):
    api.get("/courses", headers=auth)
    assert api.request(method, path, json=body, headers=auth).status_code < 300
    api.get("/courses", headers=auth)
    assert world.count("courses") == 2


def test_upload_keeps_the_cache(api, world, auth):
    """An upload attaches the file to nothing, so no read changes: the next draft save or submit is
    what clears the cache (and it must not pay for a cold detail rebuild first)."""
    api.get("/courses", headers=auth)
    api.get("/submitted", headers=auth)
    assert api.post("/files", files={"file": ("a.txt", b"1", "text/plain")}, headers=auth).status_code == 200
    api.get("/courses", headers=auth)
    api.get("/submitted", headers=auth)
    assert world.count("courses") == 1 and world.count("iter_tasks") == 1


def test_lists_are_fetched_in_pages_of_50(api, world, auth):
    api.get("/todo", headers=auth)
    api.get("/submitted", headers=auth)
    assert LIST_PAGE_SIZE == 50 and world.page_sizes == [50, 50]


def test_the_service_builds_yungu_clients_with_a_short_timeout(state_dir):
    app = create_app(state_dir=str(state_dir))
    c = app.state.service.yungu._factory("S106", "pw")
    assert isinstance(c, YunguTask) and c.timeout == YUNGU_TIMEOUT_SECONDS == 15


# --------------------------------------------- session expiry (Review Focus 1)
def test_expired_session_logs_in_once_and_retries(api, world, auth):
    world.expire_all()
    r = api.get("/courses", headers=auth)
    assert r.status_code == 200 and r.json() == mapping.courses(world.courses)
    assert world.logins == ["S106", "S106"] and world.count("courses") == 2


def test_concurrent_requests_on_an_expired_session_trigger_exactly_one_login(api, world, auth):
    n = 8
    world.expire_all()
    world.barrier = threading.Barrier(n)               # every request sees the expiry before anyone re-logs in
    results = []

    def hit():
        results.append(api.get("/courses", headers={**auth, "X-Refresh": "1"}).status_code)

    threads = [threading.Thread(target=hit) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)
    assert results == [200] * n
    assert world.logins == ["S106", "S106"]


def test_a_second_expiry_after_the_retry_is_not_retried_again(api, world, auth):
    orig = FakeClient.courses

    def always_expired(self):
        self.w.calls.append(("courses", ()))
        raise expired_error()
    FakeClient.courses = always_expired
    try:
        r = api.get("/courses", headers=auth)
    finally:
        FakeClient.courses = orig
    assert r.status_code == 502 and r.json() == {"error": UNREACHABLE}
    assert world.logins == ["S106", "S106"] and world.count("courses") == 2


def test_first_request_after_restart_logs_in_lazily_once(make, world, auth):
    restarted = make()
    restarted.get("/courses", headers=auth)
    restarted.get("/todo", headers=auth)
    assert world.logins == ["S106", "S106"]


def test_writes_are_retried_once_after_a_relogin(api, world, auth):
    world.expire_all()
    r = api.put("/assignments/94929/draft", json={"fileIds": ["11128687"]}, headers=auth)
    assert r.status_code == 204
    assert world.logins == ["S106", "S106"] and world.count("save_draft") == 1


def test_a_file_redirect_to_the_login_page_counts_as_expiry(api, world, auth):
    good = world.redirect
    world.redirect = "https://login.yungu.org/cas/login?service=https%3A%2F%2Ftask.yungu.org%2F"
    seen = []
    orig = FakeClient.file_redirect

    def redirect(self, file_id, preview):
        seen.append(self.serial)
        return orig(self, file_id, preview) if len(seen) == 1 else good
    FakeClient.file_redirect = redirect
    try:
        r = api.get("/files/11128687", headers=auth)
    finally:
        FakeClient.file_redirect = orig
    assert r.json() == {"redirect": good} and world.logins == ["S106", "S106"]


# ---------------------------------------- saved password rejected (Review Focus 2)
def test_rejected_saved_password_stops_after_one_attempt(api, world, state_dir, auth):
    world.accounts["S106"]["password"] = "changed-on-yungu"
    world.expire_all()
    r = api.get("/courses", headers=auth)
    assert r.status_code == 401 and r.json() == {"error": PW_CHANGED}
    assert world.logins == ["S106", "S106"]
    assert not (state_dir / "credentials.json").exists()
    r = api.get("/courses", headers=auth)                  # tokens are gone: no further login attempts
    assert r.status_code == 401 and r.json() == {"error": SIGN_IN_AGAIN}
    assert world.logins == ["S106", "S106"]


def test_rejected_password_with_concurrent_requests_is_still_one_attempt(api, world, auth):
    n = 6
    world.accounts["S106"]["password"] = "changed-on-yungu"
    world.expire_all()
    world.barrier = threading.Barrier(n)
    results = []

    def hit():
        r = api.get("/courses", headers={**auth, "X-Refresh": "1"})
        results.append((r.status_code, r.json()["error"]))

    threads = [threading.Thread(target=hit) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)
    assert results == [(401, PW_CHANGED)] * n
    assert world.logins == ["S106", "S106"]


def test_rejected_password_after_restart(make, world, state_dir, auth):
    world.accounts["S106"]["password"] = "changed-on-yungu"
    restarted = make()
    assert restarted.get("/todo", headers=auth).json() == {"error": PW_CHANGED}
    assert world.logins == ["S106", "S106"] and not (state_dir / "credentials.json").exists()


def test_signing_in_after_a_rejection_works_again(api, world, auth):
    world.accounts["S106"]["password"] = "new"
    world.expire_all()
    api.get("/courses", headers=auth)
    fresh = sign_in(api, password="new")
    assert api.get("/courses", headers=fresh).status_code == 200


# ------------------------------------------- Yungu failures (Review Focus 3)
@pytest.mark.parametrize("exc", [
    YunguError("GET /api/my/currentCourses -> HTTP 503"),
    YunguError("GET /api/x -> code=500 message=系统异常", json_response({"code": 500, "message": "系统异常"})),
    requests.ConnectionError("Max retries exceeded"),
    requests.Timeout("read timed out"),
    requests.JSONDecodeError("Expecting value", "<html>", 0),
    KeyError("content"),
])
def test_yungu_failures_are_a_502(api, world, auth, exc):
    world.fail = exc
    for path in ("/courses", "/todo", "/submitted", "/assignments/93251", "/files/1"):
        r = api.get(path, headers=auth)
        assert r.status_code == 502 and r.json() == {"error": UNREACHABLE}, path
    r = api.post("/assignments/93251/submit", json={"fileIds": []}, headers=auth)
    assert r.status_code == 502 and r.json() == {"error": UNREACHABLE}


def login_down(monkeypatch, hang=None):
    """Make every FakeClient login fail as if Yungu were unreachable (optionally after `hang` is set)."""
    def down(self):
        self.w.logins.append(self.login_id)
        if hang is not None:
            hang.wait(10)
        raise requests.ConnectionError("down")
    monkeypatch.setattr(FakeClient, "login", down)


def test_relogin_while_yungu_is_down_is_a_502_and_keeps_the_password(api, world, state_dir, auth, clock,
                                                                      monkeypatch):
    world.expire_all()
    with monkeypatch.context() as m:
        login_down(m)
        r = api.get("/courses", headers=auth)
        assert r.status_code == 502 and r.json() == {"error": UNREACHABLE}
        assert (state_dir / "credentials.json").exists()
        assert api.get("/courses", headers=auth).status_code == 502          # backing off: no new attempt
        assert world.logins == ["S106", "S106"]
    clock.t += LOGIN_RETRY_SECONDS + 1
    assert api.get("/courses", headers=auth).status_code == 200             # recovers once the back-off ends
    assert world.logins == ["S106", "S106", "S106"]


def run_parallel(n, fn):
    results = []
    threads = [threading.Thread(target=lambda: results.append(fn())) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(20)
    return results


def test_concurrent_requests_during_an_outage_make_one_login_attempt(api, world, auth, monkeypatch):
    n = 6
    world.expire_all()
    world.barrier = threading.Barrier(n)
    login_down(monkeypatch)
    results = run_parallel(n, lambda: api.get("/courses", headers={**auth, "X-Refresh": "1"}).status_code)
    assert results == [502] * n
    assert world.logins == ["S106", "S106"]


def test_concurrent_first_requests_after_a_restart_during_an_outage_make_one_attempt(make, world, auth,
                                                                                       monkeypatch):
    restarted = make()
    login_down(monkeypatch)
    results = run_parallel(6, lambda: restarted.get("/courses", headers=auth).status_code)
    assert results == [502] * 6
    assert world.logins == ["S106", "S106"]


def test_sign_out_is_not_blocked_by_a_hanging_relogin(api, world, auth,
                                                                                  monkeypatch, state_dir):
    hang = threading.Event()
    world.expire_all()
    login_down(monkeypatch, hang=hang)
    first = []
    t = threading.Thread(target=lambda: first.append(api.get("/courses", headers=auth)))
    t.start()
    while world.logins == ["S106"]:            # wait until the re-login is in flight
        threading.Event().wait(0.01)
    done = threading.Event()
    out = []

    def sign_out():
        out.append(api.delete("/session", headers=auth).status_code)
        done.set()
    threading.Thread(target=sign_out).start()
    assert done.wait(5), "sign-out waited for the hanging re-login"
    assert out == [204] and not (state_dir / "credentials.json").exists()
    hang.set()
    t.join(10)
    assert first[0].status_code == 401 and first[0].json() == {"error": SIGN_IN_AGAIN}
    assert world.logins == ["S106", "S106"]


class OfflineLogin(YunguTask):
    """The real client with only login() faked, so the real _api error handling is exercised."""
    logins = 0

    def login(self):
        OfflineLogin.logins += 1
        self.user = {"userId": ME, "eName": "Bruce Zheng"}
        return self.user


@pytest.fixture
def real(make):
    OfflineLogin.logins = 0
    api = make(factory=lambda l, p: OfflineLogin(l, p))
    return api, sign_in(api)


COURSES_URL = BASE + "/api/my/currentCourses"


@responses.activate
@pytest.mark.parametrize("kw", [
    {"status": 503, "body": "<html>busy</html>"},
    {"status": 500, "json": {"code": 500}},
    {"status": 200, "body": "<html>not json</html>"},
    {"body": requests.ConnectionError("refused")},
    {"status": 200, "json": {"code": 9, "message": "系统异常"}},
])
def test_real_client_failures_are_a_502(real, kw):
    api, auth = real
    responses.get(COURSES_URL, **kw)
    r = api.get("/courses", headers=auth)
    assert r.status_code == 502 and r.json() == {"error": UNREACHABLE}


@responses.activate
@pytest.mark.parametrize("expired", [
    {"json": {"code": 1000, "message": "未登录"}},
    {"json": {"ifLogin": False, "code": 1}},
    {"status": 302, "headers": {"Location": "https://login.yungu.org/cas/login?service=x"}},
])
def test_real_client_expiry_forms_trigger_one_relogin(real, expired):
    api, auth = real
    responses.get(COURSES_URL, **expired)
    responses.get(COURSES_URL, json={"code": 0, "content": {"data": []}})
    r = api.get("/courses", headers=auth)
    assert r.status_code == 200 and r.json() == []
    assert OfflineLogin.logins == 2


# ------------------------------------------------ unknown ids (Yungu code 1035)
UNKNOWN = {"code": 1035, "message": "任务不存在", "content": None}


@responses.activate
def test_unknown_assignment_id_from_the_real_client_is_a_404(real, caplog):
    api, auth = real
    responses.get(BASE + "/api/getMixedPublishDetail", json=UNKNOWN)             # HTTP 200, as live
    caplog.set_level("DEBUG")
    r = api.get("/assignments/999999999", headers=auth)
    assert r.status_code == 404 and r.json() == {"error": "Not found."}
    assert OfflineLogin.logins == 1                                              # not taken for expiry
    assert "任务不存在" not in caplog.text and "1035" not in caplog.text


@responses.activate
@pytest.mark.parametrize("method,path,body", [
    ("PUT", "/assignments/999999999/draft", {"fileIds": ["1"]}),
    ("POST", "/assignments/999999999/submit", {"fileIds": ["1"]}),
    ("POST", "/assignments/999999999/comments", {"text": "hi"}),
    ("DELETE", "/assignments/999999999/comments/1", None),
    ("PUT", "/assignments/999999999/online-docs/1", {"title": "t", "content": "{}"}),
    ("POST", "/assignments/999999999/submit", {"fileIds": []}),
])
def test_writes_on_an_unknown_assignment_id_are_a_404(real, method, path, body):
    api, auth = real
    responses.post(BASE + "/api/student/getAchievementDetail", json=UNKNOWN)
    responses.post(BASE + "/api/student/getAchievementDetail/comment", json=UNKNOWN)
    r = api.request(method, path, json=body, headers=auth)
    assert r.status_code == 404 and r.json() == {"error": "Not found."}
    assert not any(c.request.url.split("?")[0].endswith(("/submitAchievementForDrafts", "/saveCommentary",
                   "/submitAchievementSendMessage", "/deletedCommentary", "/update_onlineDocument",
                   "/users/taskPublish/status")) for c in responses.calls)


@responses.activate
@pytest.mark.parametrize("preview", ["0", "1"])
def test_a_file_yungu_has_no_bytes_for_is_a_422_not_a_502(real, preview):
    """Live, Yungu answers an empty HTTP 200 (no 302) on preview_file / new_download_file for an online
    document (type "onlineDocument", its text kept in Yungu) and for an id it has no file for."""
    api, auth = real
    path = "/api/preview_file" if preview == "1" else "/api/new_download_file"
    responses.get(BASE + path, status=200, body="")
    r = api.get(f"/files/11117133?preview={preview}", headers=auth)
    assert r.status_code == 422 and r.json() == {"error": "Open this online document on Yungu."}
    assert OfflineLogin.logins == 1


@responses.activate
def test_other_file_answers_stay_a_502(real):
    api, auth = real
    responses.get(BASE + "/api/new_download_file", status=500, body="busy")
    r = api.get("/files/11117133", headers=auth)
    assert r.status_code == 502 and r.json() == {"error": UNREACHABLE}


@responses.activate
def test_other_nonzero_codes_on_the_detail_lookup_stay_a_502(real):
    api, auth = real
    responses.get(BASE + "/api/getMixedPublishDetail", json={"code": 1036, "message": "x"})
    r = api.get("/assignments/93251", headers=auth)
    assert r.status_code == 502 and r.json() == {"error": UNREACHABLE}


@responses.activate
def test_code_1035_outside_an_id_lookup_is_not_a_404(real):
    api, auth = real
    responses.get(COURSES_URL, json=UNKNOWN)
    assert api.get("/courses", headers=auth).status_code == 502


# ------------------------------------------- malformed data and log hygiene
@pytest.mark.parametrize("path,breaker", [
    ("/courses", lambda w: setattr(w, "courses", [{"courseName": "no id"}])),
    ("/todo", lambda w: w.lists[TODO].__setitem__(0, {"title": "no id"})),
    ("/submitted", lambda w: w.lists[SUBMITTED].__setitem__(0, {"doTaskStatus": "Submitted", "title": "no id"})),
    ("/week?start=1792339200000", lambda w: setattr(w, "week", [[{"name": "no times"}]])),
    ("/assignments/93251", lambda w: w.mixed[93251].pop("taskTitle")),
])
def test_malformed_yungu_data_is_a_502_with_the_error_shape(api, world, auth, path, breaker):
    breaker(world)
    r = api.get(path, headers=auth)
    assert r.status_code == 502 and r.json() == {"error": UNREACHABLE}


@pytest.mark.parametrize("status", [TODO, SUBMITTED])
def test_one_item_without_a_deadline_does_not_take_the_list_down(api, world, auth, status):
    world.lists[status][0] = {**world.lists[status][0], "deadlineTimeMillis": None, "deadline": None}
    r = api.get("/todo" if status == TODO else "/submitted", headers=auth)
    assert r.status_code == 200 and len(r.json()) == len(world.lists[status])
    assert all(isinstance(a["dueAt"], int) for a in r.json())


def test_unexpected_errors_are_logged_by_type_only(api, auth, monkeypatch, caplog):
    def boom(raw):
        raise ValueError("SECRET-IN-MESSAGE")
    monkeypatch.setattr(mapping, "courses", boom)
    caplog.set_level("DEBUG")
    r = api.get("/courses", headers=auth)
    assert r.status_code == 502 and r.json() == {"error": UNREACHABLE}
    assert "ValueError" in caplog.text and "SECRET-IN-MESSAGE" not in caplog.text


def test_yungu_error_bodies_are_never_logged(api, world, auth, caplog):
    xml = "<Error><OSSAccessKeyId>STS.NTsecretKEY</OSSAccessKeyId><StringToSign>PUT x</StringToSign></Error>"
    resp = json_response({}, status=403)
    resp._content = xml.encode()
    world.fail = YunguError(f"OSS PUT taskFile/1_a.txt -> HTTP 403: {xml}", resp)
    caplog.set_level("DEBUG")
    r = api.post("/files", files={"file": ("a.txt", b"1", "text/plain")}, headers=auth)
    assert r.status_code == 502
    assert "STS.NTsecretKEY" not in caplog.text and "StringToSign" not in caplog.text
    assert "HTTP 403" in caplog.text


@responses.activate
def test_real_oss_failure_logs_no_sts_material(real, caplog):
    api, auth = real
    sts = {"accessKeyId": "STS.KEYID123", "accessSecret": "SECRET456", "stsToken": "TOKEN789",
           "bucketName": "bucket", "endpoint": "https://oss.example", "ossPath": "taskFile/"}
    responses.get(BASE + "/api/sts/token", json={"code": 0, "content": sts})
    responses.put(re.compile(r"https://bucket\.oss\.example/.*"), status=403,
                  body="<Error><OSSAccessKeyId>STS.KEYID123</OSSAccessKeyId><SignatureProvided>sig</SignatureProvided></Error>")
    caplog.set_level("DEBUG")
    r = api.post("/files", files={"file": ("作业.txt", b"1", "text/plain")}, headers=auth)
    assert r.status_code == 502 and r.json() == {"error": UNREACHABLE}
    for secret in ("STS.KEYID123", "SECRET456", "TOKEN789", "SignatureProvided"):
        assert secret not in caplog.text


# ------------------------------------------------ CAS login answer shapes
CAS = "https://login.yungu.org"


@functools.lru_cache(maxsize=1)
def cas_public_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key()


def mock_cas(**login_kw):
    der = cas_public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    responses.get(CAS + "/cas/login", body="<html></html>")
    responses.get(CAS + "/api/getStudentLoginId", json={})
    responses.get(CAS + "/cas/getPublicKey", json={"content": base64.b64encode(der).decode()})
    responses.post(CAS + "/cas/loginForLoginId", **login_kw)


def cas_logins():
    return sum(1 for c in responses.calls if c.request.url.startswith(CAS + "/cas/loginForLoginId"))


@pytest.fixture
def real_cas(make):
    return make(factory=lambda l, p: YunguTask(l, p))


@responses.activate
@pytest.mark.parametrize("answer", [
    {"success": False, "msg": "密码错误"},
    {"msg": "密码错误", "code": 1},                       # no `success` key at all
    {"success": None, "msg": "密码错误"},
])
def test_any_well_formed_non_success_login_answer_is_a_rejection(real_cas, answer):
    mock_cas(json=answer)
    r = real_cas.post("/session", json={"loginId": "S106", "password": "hunter2-xyz"})
    assert r.status_code == 200 and r.json() == {"ok": False, "error": "密码错误"}


@responses.activate
@pytest.mark.parametrize("kw", [
    {"status": 500, "json": {"success": False, "msg": "系统异常"}},
    {"status": 502, "body": "<html>bad gateway</html>"},
    {"status": 200, "body": "<html>not json</html>"},
    {"body": requests.ConnectionError("refused")},
])
def test_transport_errors_at_login_are_unavailable(real_cas, kw):
    mock_cas(**kw)
    r = real_cas.post("/session", json={"loginId": "S106", "password": "hunter2-xyz"})
    assert r.status_code == 502 and r.json() == {"ok": False, "error": UNREACHABLE}


@responses.activate
def test_saved_password_rejected_without_a_success_key_is_forgotten_after_one_attempt(api, make, auth, state_dir):
    restarted = make(factory=lambda l, p: YunguTask(l, p))
    mock_cas(json={"msg": "密码错误", "code": 1})
    assert restarted.get("/courses", headers=auth).json() == {"error": PW_CHANGED}
    assert restarted.get("/courses", headers=auth).json() == {"error": SIGN_IN_AGAIN}
    assert cas_logins() == 1 and not (state_dir / "credentials.json").exists()


@responses.activate
def test_saved_password_with_a_5xx_login_is_kept_and_not_retried_per_request(api, make, auth, state_dir, clock):
    restarted = make(factory=lambda l, p: YunguTask(l, p))
    mock_cas(status=500, json={"success": False})
    for _ in range(3):
        assert restarted.get("/courses", headers=auth).json() == {"error": UNREACHABLE}
    assert cas_logins() == 1 and (state_dir / "credentials.json").exists()
    clock.t += LOGIN_RETRY_SECONDS + 1
    restarted.get("/courses", headers=auth)
    assert cas_logins() == 2


def test_a_failure_after_the_cas_login_is_not_a_rejection(api, world, auth, state_dir, monkeypatch):
    world.expire_all()

    def current_user_fails(self):
        self.w.logins.append(self.login_id)
        raise YunguError("GET /api/currentUser -> code=1000 message=x", json_response({"code": 1000}))
    monkeypatch.setattr(FakeClient, "login", current_user_fails)
    assert api.get("/courses", headers=auth).json() == {"error": UNREACHABLE}
    assert (state_dir / "credentials.json").exists()


# --------------------------------------------------- uploads (Review Focus 5)
def test_upload_keeps_the_chinese_name_verbatim(api, world, auth):
    name = "我的产品 第1版（终稿）.pdf"
    r = api.post("/files", files={"file": (name, b"%PDF-1.4 data", "application/pdf")}, headers=auth)
    assert r.status_code == 200, r.text
    ref = r.json()
    assert world.calls[-1] == ("upload_bytes", (name, "application/pdf", 13))
    assert ref["name"] == name and ref["id"] == "11130001" and ref["kind"] == "pdf"
    assert ref["size"] == 13 and ref["url"] == "/api/files/11130001" and ref["createdAt"] == int(NOW * 1000)


def test_upload_without_a_file_is_a_400(api, auth):
    r = api.post("/files", data={"x": "1"}, headers=auth)
    assert r.status_code == 400 and "error" in r.json()


def run_asgi(app, headers, body_chunks):
    """Call the ASGI app directly so the test sees exactly how much of the body is read."""
    read = {"calls": 0, "bytes": 0}
    sent = []

    async def receive():
        chunk = next(body_chunks, None)
        if chunk is None:
            return {"type": "http.request", "body": b"", "more_body": False}
        read["calls"] += 1
        read["bytes"] += len(chunk)
        return {"type": "http.request", "body": chunk, "more_body": True}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
             "scheme": "http", "path": "/files", "raw_path": b"/files", "query_string": b"", "root_path": "",
             "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
             "client": ("127.0.0.1", 50000), "server": ("127.0.0.1", 8100)}
    asyncio.run(app(scope, receive, send))
    status = next(m["status"] for m in sent if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status, json.loads(body), read


def endless(chunk_size=1 << 20, limit=200):
    head = (b'--B\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\n'
            b"Content-Type: application/octet-stream\r\n\r\n")
    yield head
    for _ in range(limit):
        yield b"\0" * chunk_size


def test_upload_limit_value():
    assert MAX_UPLOAD_BYTES == 50 * 1024 * 1024 + 64 * 1024


def test_oversized_content_length_is_refused_before_reading_the_body(api, world, auth):
    headers = {**auth, "content-type": "multipart/form-data; boundary=B",
               "content-length": str(MAX_UPLOAD_BYTES + 1)}
    status, body, read = run_asgi(api.app, headers, endless())
    assert status == 413 and body == {"error": TOO_LARGE}
    assert read["calls"] == 0 and world.count("upload_bytes") == 0


def test_body_without_content_length_is_cut_off_at_the_limit(api, world, auth):
    headers = {**auth, "content-type": "multipart/form-data; boundary=B"}
    status, body, read = run_asgi(api.app, headers, endless())
    assert status == 413 and body == {"error": TOO_LARGE}
    assert read["bytes"] <= MAX_UPLOAD_BYTES + (1 << 20)
    assert world.count("upload_bytes") == 0


def test_lying_content_length_is_cut_off_at_the_limit(api, world, auth):
    headers = {**auth, "content-type": "multipart/form-data; boundary=B", "content-length": "1000"}
    status, body, read = run_asgi(api.app, headers, endless())
    assert status == 413 and read["bytes"] <= MAX_UPLOAD_BYTES + (1 << 20)


def test_an_upload_just_under_the_limit_is_accepted(api, world, auth):
    data = b"\0" * (50 * 1024 * 1024)
    r = api.post("/files", files={"file": ("big.bin", data, "application/octet-stream")}, headers=auth)
    assert r.status_code == 200 and world.calls[-1] == ("upload_bytes", ("big.bin", "application/octet-stream", len(data)))


def test_upload_without_a_token_is_refused_before_reading_the_body(api, world):
    status, body, read = run_asgi(api.app, {"content-type": "multipart/form-data; boundary=B"}, endless())
    assert status == 401 and read["calls"] == 0


# ------------------------------------------------------------------ writes
def test_draft_saves_the_list_against_the_task_user_relation(api, world, auth):
    r = api.put("/assignments/94929/draft", json={"fileIds": ["11128687", "11128608"]}, headers=auth)
    assert r.status_code == 204
    rel = world.ach[94929]["taskUserRelationId"]
    assert ("save_draft", (rel, [11128687, 11128608])) in world.calls


def test_draft_with_bad_file_ids_is_a_400(api, world, auth):
    r = api.put("/assignments/94929/draft", json={"fileIds": ["abc"]}, headers=auth)
    assert r.status_code == 400 and world.count("save_draft") == 0


def test_draft_on_an_unknown_assignment_is_a_404(api, world, auth):
    assert api.put("/assignments/1/draft", json={"fileIds": []}, headers=auth).status_code == 404


def test_submit_saves_the_draft_then_hands_in_and_returns_the_time(api, world, auth):
    r = api.post("/assignments/93251/submit", json={"fileIds": ["11128687"]}, headers=auth)
    assert r.status_code == 200 and r.json() == {"submittedAt": int(NOW * 1000)}
    names = [c[0] for c in world.calls if c[0] in ("save_draft", "submit")]
    assert names == ["save_draft", "submit"] and world.calls[-1] == ("submit", (93251, [11128687]))


def test_submitted_file_ids_are_kept_per_assignment_across_restarts(make, api, world, state_dir, auth):
    api.post("/assignments/93251/submit", json={"fileIds": ["11128687"]}, headers=auth)
    world.ach[93251]["fileModelList"].append({**world.ach[93251]["fileModelList"][0], "fileId": 11128999,
                                              "fileName": "draft.txt"})      # draft edited after the hand-in
    world.ach[93251]["ifEditStatus"] = True
    d = api.get("/assignments/93251", headers=auth).json()
    assert d["submittedFileIds"] == ["11128687"] and [f["id"] for f in d["myFiles"]] == ["11128687", "11128999"]
    assert mode(state_dir / "submitted-files.json") == 0o600
    assert make().get("/assignments/93251", headers=auth).json()["submittedFileIds"] == ["11128687"]


def test_without_a_kept_list_submitted_file_ids_fall_back_to_the_current_files(api, world, auth):
    d = api.get("/assignments/93251", headers=auth).json()
    assert d["submittedFileIds"] == [str(f["fileId"]) for f in world.ach[93251]["fileModelList"]]


@responses.activate
@pytest.mark.parametrize("achievement_id,endpoint", [
    (None, "/api/submitAchievementSendMessage"),
    (867961, "/api/updateAchievementAndSendMessage"),
])
def test_submit_picks_first_submit_or_update_by_achievement_id(real, load, achievement_id, endpoint):
    api, auth = real
    ach = {**load("achievement_93251.json"), "achievementId": achievement_id}
    responses.post(BASE + "/api/student/getAchievementDetail", json={"code": 0, "content": ach})
    responses.get(BASE + "/api/student/submitAchievementForDrafts", json={"code": 0})
    responses.post(BASE + endpoint, json={"code": 0, "message": "成功"})
    r = api.post("/assignments/93251/submit", json={"fileIds": ["11128608"]}, headers=auth)
    assert r.status_code == 200
    last = responses.calls[-1].request
    assert last.url == BASE + endpoint
    sent = json.loads(last.body)
    assert sent["fileList"] == [11128608] and sent["taskPublishId"] == 93251
    assert sent.get("achievementId") == achievement_id
    assert any("submitAchievementForDrafts" in c.request.url and "fileIds=11128608" in c.request.url
               for c in responses.calls)


def test_add_comment_calls_add_comment_and_returns_the_new_comment(api, world, auth):
    r = api.post("/assignments/93251/comments", json={"text": "好的，今晚提交。"}, headers=auth)
    assert r.status_code == 200
    c = r.json()
    assert world.count("add_comment") == 1 and ("add_comment", (93251, "好的，今晚提交。")) in world.calls
    assert c["text"] == "好的，今晚提交。" and c["mine"] is True and c["id"] == str(world.next_feedback)
    assert set(c) == {"id", "author", "mine", "createdAt", "text"}


def test_add_comment_finds_the_new_comment_when_yungu_alters_the_text(api, world, auth):
    orig = FakeClient.add_comment

    def escaping(self, publish_id, text):
        orig(self, publish_id, text)
        self.w.comments[publish_id][-1]["descript"] = text.replace("<", "&lt;")
    FakeClient.add_comment = escaping
    try:
        r = api.post("/assignments/93251/comments", json={"text": "a<b"}, headers=auth)
    finally:
        FakeClient.add_comment = orig
    assert r.status_code == 200 and r.json()["id"] == str(world.next_feedback)


def test_blank_comment_is_a_400(api, world, auth):
    r = api.post("/assignments/93251/comments", json={"text": "  "}, headers=auth)
    assert r.status_code == 400 and world.count("add_comment") == 0


def test_delete_own_comment_calls_delete_comment(api, world, auth):
    r = api.delete("/assignments/93251/comments/327994", headers=auth)
    assert r.status_code == 204 and world.calls[-1] == ("delete_comment", (327994,))


def test_someone_elses_comment_is_left_alone_and_is_a_404(api, world, auth):
    for comment_id in ("327995", "999", "nope"):                 # the teacher's, unknown, not an id
        r = api.delete(f"/assignments/93251/comments/{comment_id}", headers=auth)
        assert r.status_code == 404 and r.json() == {"error": "Comment not found."}, comment_id
    assert world.count("delete_comment") == 0


# ------------------------------------------------------- online documents
DELTA = '{"ops":[{"insert":"研究计划\\n"},{"insert":"第一步","attributes":{"bold":true}},{"insert":"\\n"}]}'
WRITES = ("create_online_doc", "update_online_doc", "save_draft", "submit", "mark_submitted")


def writes(world):
    return [c for c in world.calls if c[0] in WRITES]


def delta_of_bytes(n):
    """A Quill delta JSON string of exactly `n` UTF-8 bytes, mostly CJK (3 bytes a character)."""
    head, tail = '{"ops":[{"insert":"', '\\n"}]}'
    room = n - len(head) - len(tail)
    text = "研" * (room // 3) + "a" * (room % 3)
    out = head + text + tail
    assert len(out.encode("utf-8")) == n
    return out


def cut_message(content):
    size, chars = len(content.encode("utf-8")), len(content)
    n = max(1, math.ceil((size - 65535) * chars / size))
    return f"Too long for Yungu — cut about {n} character{'' if n == 1 else 's'}."


def code_1008():
    return YunguError("POST /api/upload_onlineDocument -> code=1008 message=system error",
                      json_response({"code": 1008, "message": "system error", "content": None}))


def test_create_online_doc_returns_its_file_ref(api, world, auth):
    r = api.post("/assignments/94929/online-docs", json={"title": "研究计划", "content": DELTA}, headers=auth)
    assert r.status_code == 200, r.text
    ref = r.json()
    assert ref["id"] == str(world.next_doc) and ref["name"] == "研究计划"
    assert ref["online"] is True and ref["content"] == DELTA
    assert ref["url"] == f"/api/files/{world.next_doc}" and ref["createdAt"] == int(NOW * 1000)
    assert writes(world) == [("create_online_doc", ("研究计划", DELTA))]


def test_created_doc_content_is_the_delta_sent_even_if_yungu_echoes_otherwise(api, world, auth):
    orig = FakeClient._doc
    FakeClient._doc = lambda self, fid, title, delta: {**orig(self, fid, title, delta), "storeMeta": None, "url": None}
    try:
        r = api.post("/assignments/94929/online-docs", json={"title": "t", "content": DELTA}, headers=auth)
    finally:
        FakeClient._doc = orig
    assert r.status_code == 200 and r.json()["content"] == DELTA and r.json()["online"] is True


def test_update_online_doc_keeps_its_id(api, world, auth):
    r = api.put("/assignments/94929/online-docs/11130500", json={"title": "改过的", "content": DELTA}, headers=auth)
    assert r.status_code == 200, r.text
    ref = r.json()
    assert ref["id"] == "11130500" and ref["name"] == "改过的" and ref["content"] == DELTA and ref["online"] is True
    achievement_id = world.ach[94929]["achievementId"]
    assert writes(world) == [("update_online_doc", (11130500, "改过的", DELTA, achievement_id))]


def test_update_online_doc_sends_the_achievement_id(api, world, auth):
    world.ach[94929]["achievementId"] = 870001
    api.put("/assignments/94929/online-docs/11130500", json={"title": "t", "content": DELTA}, headers=auth)
    assert writes(world) == [("update_online_doc", (11130500, "t", DELTA, 870001))]


@pytest.mark.parametrize("method,path", [
    ("POST", "/assignments/94929/online-docs"), ("PUT", "/assignments/94929/online-docs/11130500")])
@pytest.mark.parametrize("title", ["", "   ", "\n\t"])
def test_a_document_needs_a_title(api, world, auth, method, path, title):
    r = api.request(method, path, json={"title": title, "content": DELTA}, headers=auth)
    assert r.status_code == 400 and r.json() == {"error": "Give the document a title."}
    assert world.calls == []


@pytest.mark.parametrize("method,path", [
    ("POST", "/assignments/94929/online-docs"), ("PUT", "/assignments/94929/online-docs/11130500")])
def test_a_delta_of_65535_bytes_is_sent(api, world, auth, method, path):
    content = delta_of_bytes(65535)
    r = api.request(method, path, json={"title": "长文", "content": content}, headers=auth)
    assert r.status_code == 200, r.text
    assert r.json()["content"] == content and len(writes(world)) == 1


@pytest.mark.parametrize("method,path", [
    ("POST", "/assignments/94929/online-docs"), ("PUT", "/assignments/94929/online-docs/11130500")])
def test_a_delta_of_65536_bytes_is_refused_before_any_yungu_call(api, world, auth, method, path):
    content = delta_of_bytes(65536)
    r = api.request(method, path, json={"title": "长文", "content": content}, headers=auth)
    assert r.status_code == 413 and r.json() == {"error": cut_message(content)}
    assert world.calls == []


def test_the_cut_count_for_an_all_cjk_text_is_the_excess_in_characters(api, world, auth):
    # 22 000 CJK characters = 66 000 bytes, 465 over: 155 characters (3 bytes each) must go.
    r = api.post("/assignments/94929/online-docs", json={"title": "长文", "content": "研" * 22000}, headers=auth)
    assert r.status_code == 413
    assert r.json() == {"error": "Too long for Yungu — cut about 155 characters."}
    # Just over the limit: at least one character, never zero.
    r = api.post("/assignments/94929/online-docs", json={"title": "长文", "content": "研" * 21846}, headers=auth)
    assert r.json() == {"error": "Too long for Yungu — cut about 1 character."}
    assert world.calls == []


def test_the_cut_count_is_plural_from_two(api, world, auth):
    # 21 847 CJK characters = 65 541 bytes, 6 over: 2 characters.
    r = api.post("/assignments/94929/online-docs", json={"title": "长文", "content": "研" * 21847}, headers=auth)
    assert r.json() == {"error": "Too long for Yungu — cut about 2 characters."}


@pytest.mark.parametrize("method,path", [
    ("POST", "/assignments/94929/online-docs"), ("PUT", "/assignments/94929/online-docs/11130500")])
def test_yungus_code_1008_under_the_limit_is_a_502_not_too_long(api, world, auth, method, path, caplog):
    # Over the limit never reaches Yungu (the 413 above), so a 1008 here is not about length.
    world.doc_error = code_1008()
    content = delta_of_bytes(65535)
    caplog.set_level("DEBUG")
    r = api.request(method, path, json={"title": "长文", "content": content}, headers=auth)
    assert r.status_code == 502 and r.json() == {"error": "Yungu couldn't save the document. Try again."}
    assert len(writes(world)) == 1                                   # not retried
    assert "1008" in caplog.text and "system error" not in caplog.text and "研" not in caplog.text


def test_other_yungu_failures_on_a_document_are_a_502(api, world, auth):
    world.doc_error = YunguError("POST /api/upload_onlineDocument -> code=500 message=x",
                                 json_response({"code": 500, "message": "x"}))
    r = api.post("/assignments/94929/online-docs", json={"title": "t", "content": DELTA}, headers=auth)
    assert r.status_code == 502 and r.json() == {"error": UNREACHABLE}


def test_a_handed_in_document_is_never_updated_in_place(api, world, auth):
    handed_in = world.ach[93251]["fileModelList"][0]["fileId"]
    r = api.put(f"/assignments/93251/online-docs/{handed_in}", json={"title": "t", "content": DELTA}, headers=auth)
    assert r.status_code == 409 and r.json() == {"error": "This document was handed in — save it as a new one."}
    assert writes(world) == []


def test_the_kept_hand_in_list_decides_what_was_handed_in(api, world, auth):
    api.post("/assignments/93251/submit", json={"fileIds": ["11128687"]}, headers=auth)
    world.ach[93251]["ifEditStatus"] = True                         # a draft is open after the hand-in
    world.calls.clear()
    r = api.put("/assignments/93251/online-docs/11128687", json={"title": "t", "content": DELTA}, headers=auth)
    assert r.status_code == 409 and writes(world) == []
    # A document added to the draft after the hand-in is not with the teacher: it is updated in place.
    r = api.put("/assignments/93251/online-docs/11130777", json={"title": "t", "content": DELTA}, headers=auth)
    assert r.status_code == 200 and r.json()["id"] == "11130777"
    assert writes(world) == [("update_online_doc", (11130777, "t", DELTA, world.ach[93251]["achievementId"]))]


def online_doc(file_id, title="研究计划"):
    return {"fileId": file_id, "fileName": title, "type": "onlineDocument", "storeMeta": DELTA, "url": None,
            "fileCreateTime": "2026-10-19 22:00:00"}


def test_a_hand_in_made_on_yungu_is_remembered_once_a_draft_replaces_a_document(api, world, auth):
    # Handed in on task.yungu.org (no kept list): status 4, no draft open, so the files are the hand-in.
    ach = world.ach[93251]
    ach["fileModelList"] = [online_doc(11130300), *ach["fileModelList"]]
    assert ach["ifEditStatus"] is False
    assert api.get("/assignments/93251", headers=auth).json()["submittedFileIds"] == ["11130300", "11128687"]
    # The writer saves the edited document as a new one, which replaces it in the draft.
    ach["fileModelList"] = [online_doc(11130501), ach["fileModelList"][1]]
    ach["ifEditStatus"] = True
    d = api.get("/assignments/93251", headers={**auth, "X-Refresh": "1"}).json()
    assert d["submittedFileIds"] == ["11130300", "11128687"]                    # changed: needs Update
    assert [f["id"] for f in d["myFiles"]] == ["11130501", "11128687"]
    world.calls.clear()
    r = api.put("/assignments/93251/online-docs/11130300", json={"title": "t", "content": DELTA}, headers=auth)
    assert r.status_code == 409 and writes(world) == []


def test_a_later_hand_in_on_yungu_replaces_the_kept_list(api, world, auth):
    api.post("/assignments/93251/submit", json={"fileIds": ["11128687"]}, headers=auth)
    # Later, on Yungu's website: document 11130300 added and handed in (no draft open).
    ach = world.ach[93251]
    ach["fileModelList"] = [online_doc(11130300), *ach["fileModelList"]]
    world.calls.clear()
    r = api.put("/assignments/93251/online-docs/11130300", json={"title": "t", "content": DELTA}, headers=auth)
    assert r.status_code == 409 and writes(world) == []
    # A draft opened afterwards still knows the document is with the teacher.
    ach["ifEditStatus"] = True
    r = api.put("/assignments/93251/online-docs/11130300", json={"title": "t", "content": DELTA}, headers=auth)
    assert r.status_code == 409 and writes(world) == []
    d = api.get("/assignments/93251", headers={**auth, "X-Refresh": "1"}).json()
    assert d["submittedFileIds"] == ["11130300", "11128687"]


def test_with_a_draft_open_and_no_kept_list_every_current_document_counts_as_handed_in(api, world, auth):
    ach = world.ach[93251]
    ach["fileModelList"] = [online_doc(11130300), *ach["fileModelList"]]
    ach["ifEditStatus"] = True                                           # unsure what the teacher has
    r = api.put("/assignments/93251/online-docs/11130300", json={"title": "t", "content": DELTA}, headers=auth)
    assert r.status_code == 409 and writes(world) == []


def test_the_hand_in_check_reads_yungu_not_the_cache(api, world, auth):
    api.get("/assignments/94929", headers=auth)                     # cached as not submitted
    world.ach[94929].update(achievementStatus=4, fileModelList=[{**world.ach[93251]["fileModelList"][0]}])
    fid = world.ach[94929]["fileModelList"][0]["fileId"]
    r = api.put(f"/assignments/94929/online-docs/{fid}", json={"title": "t", "content": DELTA}, headers=auth)
    assert r.status_code == 409 and writes(world) == []


def test_updating_a_document_of_an_unknown_assignment_is_a_404(api, world, auth):
    r = api.put("/assignments/1/online-docs/11130500", json={"title": "t", "content": DELTA}, headers=auth)
    assert r.status_code == 404 and writes(world) == []


@pytest.mark.parametrize("file_id", ["abc", "²", "١٢٣", "12a"])
def test_a_bad_document_id_is_a_404(api, world, auth, file_id):
    r = api.put(f"/assignments/94929/online-docs/{file_id}", json={"title": "t", "content": DELTA}, headers=auth)
    assert r.status_code == 404 and r.json() == {"error": "Not found."} and world.calls == []


@pytest.mark.parametrize("body", [{"title": "t"}, {"content": DELTA}, {"title": 1, "content": DELTA},
                                  {"title": "t", "content": None}])
def test_a_malformed_document_body_is_a_400(api, world, auth, body):
    r = api.post("/assignments/94929/online-docs", json=body, headers=auth)
    assert r.status_code == 400 and world.calls == []


# ------------------------------------------------------ mark as submitted
ADD_A_FILE = "Add at least one file."
NOT_CONFIRMED = "Yungu didn't confirm the hand-in. Check on Yungu."


def test_mark_as_submitted_hands_in_with_no_files(api, world, auth):
    ach = world.ach[94929]
    assert ach["needEnclosure"] is False and ach["achievementStatus"] == 1 and not ach.get("fileModelList")
    r = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    assert r.status_code == 200 and r.json() == {"submittedAt": int(NOW * 1000)}
    assert writes(world) == [("mark_submitted", (ach["taskId"],))]
    d = api.get("/assignments/94929", headers=auth).json()
    assert d["submitted"] is True and d["submittedFileIds"] == [] and d["myFiles"] == []


def test_the_services_info_lines_reach_the_journal():
    import logging
    import service.app  # noqa: F401  (importing the service sets its logging up)
    own = logging.getLogger("yungu_lms")
    assert own.isEnabledFor(logging.INFO) and own.handlers and own.propagate


@pytest.mark.parametrize("answer, shape", [
    (None, "null"),
    (True, "bool"),
    ({"id": 7, "token": "SECRET-TOKEN", "users": [{"userId": 106, "name": "郑博纬"}], "x": None},
     '{"id": "int", "token": "str", "users": [{"name": "str", "userId": "int"}], "x": "null"}'),
])
def test_mark_as_submitted_logs_the_shape_of_yungus_answer_never_its_values(api, world, auth, caplog,
                                                                            answer, shape):
    world.mark_answer = answer
    caplog.set_level("DEBUG")
    r = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    assert r.status_code == 200
    assert f"Mark as submitted: Yungu answered {shape}" in caplog.text
    assert "SECRET-TOKEN" not in caplog.text and "郑博纬" not in caplog.text and "106" not in caplog.text


def test_mark_as_submitted_falls_back_to_the_task_status(api, world, auth):
    world.ach[94929]["achievementStatus"] = None                      # mixed doTaskStatusId is 1
    assert world.mixed[94929]["doTaskStatusId"] == 1
    orig = FakeClient.mark_submitted

    def confirming(self, task_id):
        orig(self, task_id)
        world.ach[94929]["achievementStatus"] = 4
    FakeClient.mark_submitted = confirming
    try:
        r = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    finally:
        FakeClient.mark_submitted = orig
    assert r.status_code == 200 and world.count("mark_submitted") == 1


def test_mark_as_submitted_reads_the_status_again_after_the_call(api, world, auth):
    r = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    assert r.status_code == 200
    i = world.calls.index(("mark_submitted", (world.ach[94929]["taskId"],)))
    assert ("achievement", (94929,)) in world.calls[i + 1:]


def test_mark_as_submitted_that_yungu_does_not_confirm_is_a_502(api, world, auth):
    world.mark_confirms = False                                        # status stays 1
    r = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    assert r.status_code == 502 and r.json() == {"error": NOT_CONFIRMED}
    assert world.count("mark_submitted") == 1


def test_mark_as_submitted_is_sent_once_even_when_the_session_expires_after_it(api, world, auth):
    world.after_mark = world.expire_all                                 # the re-read meets an expired session
    r = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    assert r.status_code == 200 and r.json() == {"submittedAt": int(NOW * 1000)}
    assert world.count("mark_submitted") == 1 and world.logins == ["S106", "S106"]


def test_mark_as_submitted_whose_status_cannot_be_read_again_is_unconfirmed(api, world, auth):
    def down():
        world.fail = requests.ConnectionError("down")
    world.after_mark = down
    r = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    assert r.status_code == 502 and r.json() == {"error": NOT_CONFIRMED}
    assert world.count("mark_submitted") == 1


def test_a_failed_mark_as_submitted_is_not_retried(api, world, auth):
    orig = FakeClient.mark_submitted

    def failing(self, task_id):
        orig(self, task_id)
        raise YunguError("POST /api/users/taskPublish/status -> code=500 message=x",
                         json_response({"code": 500, "message": "x"}))
    FakeClient.mark_submitted = failing
    try:
        r = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    finally:
        FakeClient.mark_submitted = orig
    assert r.status_code == 502 and world.count("mark_submitted") == 1


def test_two_concurrent_mark_as_submitted_requests_send_one(api, world, auth):
    entered, release = threading.Event(), threading.Event()

    def hold():
        entered.set()
        release.wait(10)
    world.after_mark = hold
    results = []

    def press():
        results.append(api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth))
    first = threading.Thread(target=press)
    first.start()
    assert entered.wait(10)
    world.after_mark = None
    second = threading.Thread(target=press)
    second.start()
    second.join(0.3)                                                     # waits behind the first
    release.set()
    first.join(10)
    second.join(10)
    assert world.count("mark_submitted") == 1
    assert sorted(r.status_code for r in results) == [200, 200]           # the second finds it marked


@pytest.mark.parametrize("change", [
    {"needEnclosure": True},                                             # a file is required
    {"needEnclosure": None},                                             # unknown: treated as required
    {"achievementStatus": 4, "ifEditStatus": True},                      # submitted, draft emptied since
    {"achievementStatus": 4, "ifEditStatus": None},                      # submitted, draft state unknown
    {"achievementStatus": 2},                                            # any status but 1
    {"achievementStatus": None, "mixedStatus": None},                    # unknown status
    {"achievementStatus": None, "mixedStatus": 4, "ifEditStatus": True},  # task-level status says submitted
    {"fileModelList": [{"fileId": 11128687, "fileName": "draft.txt", "type": "file"}]},   # draft has files
])
def test_any_other_empty_submit_is_a_400_without_a_yungu_write(api, world, auth, change):
    change = dict(change)
    if "mixedStatus" in change:
        mixed_status = change.pop("mixedStatus")
        if mixed_status is None:
            world.mixed[94929].pop("doTaskStatusId")
        else:
            world.mixed[94929]["doTaskStatusId"] = mixed_status
    world.ach[94929].update(change)
    if "needEnclosure" in change:
        world.mixed[94929].pop("needEnclosure")
    r = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    assert r.status_code == 400 and r.json() == {"error": ADD_A_FILE}
    assert writes(world) == []


def test_an_empty_submit_on_a_submitted_assignment_with_no_files_is_a_400(api, world, auth):
    world.ach[93251].update(fileModelList=[], ifEditStatus=True)       # the draft emptied after a hand-in
    r = api.post("/assignments/93251/submit", json={"fileIds": []}, headers=auth)
    assert r.status_code == 400 and r.json() == {"error": ADD_A_FILE} and writes(world) == []


def test_the_mark_as_submitted_check_reads_yungu_not_the_cache(api, world, auth):
    api.get("/assignments/94929", headers=auth)                     # cached as not submitted, no files
    world.ach[94929]["achievementStatus"] = 4
    r = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    assert r.status_code == 200 and writes(world) == []                  # already marked: nothing sent


def test_a_mark_yungu_already_applied_answers_success_without_a_second_mark(api, world, auth):
    # The first press reached Yungu but its answer timed out; the next press finds it marked.
    world.ach[94929]["achievementStatus"] = 4
    assert world.ach[94929]["ifEditStatus"] is False and not world.ach[94929]["fileModelList"]
    r = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    assert r.status_code == 200 and r.json() == {"submittedAt": int(NOW * 1000)}
    assert writes(world) == []
    assert api.get("/assignments/94929", headers=auth).json()["submittedFileIds"] == []


def test_a_mark_whose_answer_was_lost_answers_success_on_the_next_press_even_with_a_draft_open(api, world, auth):
    world.ach[94929]["ifEditStatus"] = True                       # 94929 had a stale empty draft open
    orig = FakeClient.mark_submitted

    def applied_then_lost(self, task_id):
        orig(self, task_id)                                        # Yungu applies the mark ...
        raise requests.ReadTimeout("read timed out")               # ... but its answer never arrives
    FakeClient.mark_submitted = applied_then_lost
    try:
        first = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    finally:
        FakeClient.mark_submitted = orig
    assert first.status_code == 502 and world.ach[94929]["achievementStatus"] == 4
    second = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    assert second.status_code == 200 and second.json() == {"submittedAt": int(NOW * 1000)}
    assert world.count("mark_submitted") == 1


def test_an_already_applied_mark_answers_yungus_hand_in_time_when_listed(api, world, auth):
    world.ach[94929]["achievementStatus"] = 4
    row = {**world.lists[SUBMITTED][0], "taskPublishId": 94929, "modifiedTime": "2026-10-20 09:30:00"}
    world.lists[SUBMITTED].insert(0, row)
    r = api.post("/assignments/94929/submit", json={"fileIds": []}, headers=auth)
    listed = next(a for a in api.get("/submitted", headers=auth).json() if a["id"] == 94929)
    assert r.status_code == 200 and r.json() == {"submittedAt": listed["submittedAt"]}
    assert writes(world) == []


def test_mark_as_submitted_on_an_unknown_assignment_is_a_404(api, world, auth):
    r = api.post("/assignments/1/submit", json={"fileIds": []}, headers=auth)
    assert r.status_code == 404 and writes(world) == []


# ------------------------------------------------------------------ secrets
def test_secrets_never_reach_the_logs_or_responses(api, world, auth, caplog):
    caplog.set_level("DEBUG")
    token = auth["Authorization"].split()[1]
    world.expire_all()
    api.get("/courses", headers=auth)
    world.fail = requests.ConnectionError("https://task.yungu.org/?ticket=ST-secret-ticket")
    body = api.get("/todo", headers=auth).text
    world.fail = None
    world.accounts["S106"]["password"] = "pw2"
    world.expire_all()
    api.get("/submitted", headers=auth)
    for secret in ("hunter2-xyz", "pw2", "ST-secret-ticket", token):
        assert secret not in caplog.text
    assert "ticket" not in body
