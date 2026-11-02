"""Pairing store and sync engine (api/service/todoist_sync.py). A fake Todoist client; no network."""
import logging
import os
import stat

import pytest
import responses

import mapping
import todoist
from service.state import StateDir
from service.todoist_sync import (LABEL, SyncCancelled, TodoistStore, description_for, make_client, sync_account)
from todoist import TodoistAuthError, TodoistNotFound, TodoistUnavailable, due_datetime

USER = 106
TOKEN = "tok-SECRET-abcdef0123456789"
NOW = 1793800000000
DUE = 1793894340000            # 2026-11-05 23:59 China
LATER = 1793980740000          # 2026-11-06 23:59 China


class FakeTodoist:
    """In-memory Todoist with the TodoistClient interface; records every call."""

    def __init__(self, labels=("Work",)):
        self.token = TOKEN
        self.tasks = {}
        self.label_names = list(labels)
        self.calls = []
        self._next = 1
        self.fail_on = {}           # method name -> exception to raise

    def _call(self, name, *args):
        self.calls.append((name, *args))
        if name in self.fail_on:
            raise self.fail_on[name]

    def names(self):
        return [c[0] for c in self.calls]

    # --- the client interface
    def me(self):
        self._call("me")
        return {"id": "42", "name": "Chi", "email": "c@example.com", "timezone": "Asia/Shanghai"}

    def labels(self):
        self._call("labels")
        return [{"id": str(i), "name": n} for i, n in enumerate(self.label_names)]

    def ensure_label(self, name):
        self._call("ensure_label", name)
        if name.casefold() not in [n.casefold() for n in self.label_names]:
            self.label_names.append(name)

    def find_tasks(self, label):
        self._call("find_tasks", label)
        return [dict(t) for t in self.tasks.values()          # Todoist label names are case-insensitive
                if label.casefold() in [n.casefold() for n in t["labels"]] and not t["checked"]
                and not t["is_deleted"]]

    def get_task(self, task_id):
        self._call("get_task", task_id)
        t = self.tasks.get(task_id)
        return None if t is None or t["is_deleted"] else dict(t)

    def create_task(self, content, description, due_datetime, labels):
        self._call("create_task", content, description, due_datetime, list(labels))
        tid = f"td{self._next}"
        self._next += 1
        self.tasks[tid] = {"id": tid, "content": content, "description": description, "labels": list(labels),
                           "due": {"date": due_datetime} if due_datetime else None,
                           "checked": False, "is_deleted": False}
        return dict(self.tasks[tid])

    def update_due(self, task_id, due_datetime):
        self._call("update_due", task_id, due_datetime)
        if task_id not in self.tasks or self.tasks[task_id]["is_deleted"]:
            raise TodoistNotFound("gone")
        self.tasks[task_id]["due"] = {"date": due_datetime} if due_datetime else None

    # --- helpers for the tests
    def add_existing(self, content, description, due=None, labels=("Yungu",), **over):
        tid = f"old{self._next}"
        self._next += 1
        self.tasks[tid] = {"id": tid, "content": content, "description": description, "labels": list(labels),
                           "due": due, "checked": False, "is_deleted": False, **over}
        return tid


def todo(*rows):
    return [{"id": i, "title": t, "course": c, "dueAt": d, "status": "todo"} for i, t, c, d in rows]


CASE = (93251, "1.8B Case Study", "CL Business", DUE)
ESSAY = (93300, "Essay draft", "English", LATER)


@pytest.fixture
def state(tmp_path):
    return StateDir(tmp_path / "state")


@pytest.fixture
def store(state):
    s = TodoistStore(state, USER)
    s.save({"token": TOKEN, "refreshToken": "R1", "account": {"id": "42", "name": "Chi", "email": "c@example.com"},
            "pairings": {}})
    return s


def pairings(store):
    return store.load()["pairings"]


# ------------------------------------------------------------------- store
def test_store_file_is_0600_under_the_account_dir(state, tmp_path):
    s = TodoistStore(state, USER)
    assert s.load() is None
    s.save({"token": TOKEN, "pairings": {}})
    path = tmp_path / "state" / "users" / str(USER) / "todoist.json"
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(path.parent).st_mode) == 0o700
    assert s.load() == {"token": TOKEN, "pairings": {}}
    s.delete()
    assert s.load() is None and not path.exists()
    s.delete()                                   # twice is fine


def test_store_accepts_a_plain_path(tmp_path):
    s = TodoistStore(tmp_path / "plain", 7)
    s.save({"a": 1})
    assert (tmp_path / "plain" / "users" / "7" / "todoist.json").exists()


def test_store_update_is_read_modify_write_and_none_when_disconnected(state):
    s = TodoistStore(state, USER)
    assert s.update(lambda d: d.update(x=1)) is None and s.load() is None        # never resurrects the file
    s.save({"pairings": {}})
    assert s.update(lambda d: d.update(x=1)) == {"pairings": {}, "x": 1}
    assert TodoistStore(state, USER).load() == {"pairings": {}, "x": 1}


def test_accounts_have_separate_stores(state):
    TodoistStore(state, 1).save({"token": "a"})
    TodoistStore(state, 2).save({"token": "b"})
    assert TodoistStore(state, 1).load() == {"token": "a"}
    TodoistStore(state, 2).delete()
    assert TodoistStore(state, 1).load() == {"token": "a"}


# ------------------------------------------------------------------- first sync
def test_first_sync_creates_each_todo_once_with_the_exact_shape(store):
    td = FakeTodoist()
    r = sync_account(td, todo(CASE, ESSAY), store, NOW, adopt=True)
    assert r == {"created": 2, "updated": 0, "adopted": 0, "skipped": 0}
    creates = [c for c in td.calls if c[0] == "create_task"]
    assert creates[0] == ("create_task", "[CL Business] 1.8B Case Study",
                          "https://yungu.chihairou.dev/assignments?task=93251", "2026-11-05T15:59:00Z", ["Yungu"])
    assert creates[1][1] == "[English] Essay draft"
    assert td.names().count("ensure_label") == 1 and ("ensure_label", "Yungu") in td.calls
    assert td.names().index("ensure_label") < td.names().index("create_task")
    assert pairings(store) == {"93251": {"todoistId": "td1", "dueMs": DUE},
                               "93300": {"todoistId": "td2", "dueMs": LATER}}
    assert store.load()["lastSyncAt"] == NOW
    assert LABEL == "Yungu" and description_for(93251) == "https://yungu.chihairou.dev/assignments?task=93251"


def test_nothing_to_create_does_not_touch_labels(store):
    td = FakeTodoist()
    sync_account(td, todo(CASE), store, NOW, adopt=False)
    td.calls.clear()
    assert sync_account(td, todo(CASE), store, NOW + 1, adopt=False) == {"created": 0, "updated": 0, "adopted": 0,
                                                                         "skipped": 0}
    assert td.calls == []


def test_an_assignment_without_a_deadline_gets_no_due(store):
    td = FakeTodoist()
    sync_account(td, todo((1, "Read", "Bio", mapping.NO_DEADLINE_MS)), store, NOW, adopt=False)
    assert [c for c in td.calls if c[0] == "create_task"][0][3] is None


def test_the_same_assignment_twice_in_one_list_is_created_once(store):
    td = FakeTodoist()
    sync_account(td, todo(CASE, CASE), store, NOW, adopt=False)
    assert td.names().count("create_task") == 1


# ------------------------------------------------------------------- Review Focus 1: duplicates
def test_restart_does_not_duplicate(state, store):
    td = FakeTodoist()
    sync_account(td, todo(CASE), store, NOW, adopt=True)
    again = TodoistStore(state, USER)            # a fresh service process
    r = sync_account(td, todo(CASE), again, NOW + 1, adopt=False)
    assert r["created"] == 0 and td.names().count("create_task") == 1 and len(td.tasks) == 1


def test_yungu_briefly_dropping_a_task_does_not_recreate_it(store):
    td = FakeTodoist()
    sync_account(td, todo(CASE, ESSAY), store, NOW, adopt=False)
    sync_account(td, todo(ESSAY), store, NOW + 1, adopt=False)          # CASE missing from one read
    assert "93251" in pairings(store)
    r = sync_account(td, todo(CASE, ESSAY), store, NOW + 2, adopt=False)
    assert r["created"] == 0 and len(td.tasks) == 2


def test_reconnect_after_disconnect_adopts_labelled_tasks_instead_of_creating(state, store):
    td = FakeTodoist()
    sync_account(td, todo(CASE, ESSAY), store, NOW, adopt=True)
    store.delete()                               # Disconnect: pairings forgotten, tasks stay in Todoist
    fresh = TodoistStore(state, USER)
    fresh.save({"token": TOKEN, "account": {"id": "42"}, "pairings": {}})
    td.calls.clear()
    r = sync_account(td, todo(CASE, ESSAY), fresh, NOW + 1, adopt=True)
    assert r == {"created": 0, "updated": 0, "adopted": 2, "skipped": 0}
    assert "create_task" not in td.names() and len(td.tasks) == 2
    assert td.names()[0] == "find_tasks" and td.calls[0] == ("find_tasks", "Yungu")
    assert pairings(fresh) == {"93251": {"todoistId": "td1", "dueMs": DUE}, "93300": {"todoistId": "td2", "dueMs": LATER}}


def test_adopt_matches_the_link_even_after_the_user_edited_the_description(store):
    td = FakeTodoist()
    mine = td.add_existing("my own title", "notes...\nhttps://yungu.chihairou.dev/assignments?task=93251 keep",
                           due={"date": "2026-11-05T15:59:00Z", "timezone": "Asia/Shanghai"})
    td.add_existing("other id", "https://yungu.chihairou.dev/assignments?task=932510")      # not 93251
    td.add_existing("no link", "just a task")
    td.add_existing("unlabelled", "https://yungu.chihairou.dev/assignments?task=93300", labels=())
    r = sync_account(td, todo(CASE, ESSAY), store, NOW, adopt=True)
    assert r == {"created": 1, "updated": 0, "adopted": 2, "skipped": 0}         # 93251 and 932510; ESSAY made
    assert pairings(store)["93251"] == {"todoistId": mine, "dueMs": DUE}
    assert td.tasks[mine]["content"] == "my own title"                            # untouched
    assert [c[1] for c in td.calls if c[0] == "create_task"] == ["[English] Essay draft"]


def test_adopted_task_with_another_due_gets_only_its_due_updated(store):
    td = FakeTodoist()
    mine = td.add_existing("t", "https://yungu.chihairou.dev/assignments?task=93251",
                           due={"date": "2026-11-04T12:00:00.000000", "timezone": None})       # floating, other time
    r = sync_account(td, todo(CASE), store, NOW, adopt=True)
    assert r == {"created": 0, "updated": 1, "adopted": 1, "skipped": 0}
    assert ("update_due", mine, "2026-11-05T15:59:00Z") in td.calls
    assert "get_task" not in td.names()                     # just seen open in this sync


def test_adopt_keeps_an_existing_pairing_and_takes_one_of_two_lookalikes(store):
    td = FakeTodoist()
    sync_account(td, todo(CASE), store, NOW, adopt=False)                    # td... paired
    paired = pairings(store)["93251"]["todoistId"]
    td.add_existing("dup", "https://yungu.chihairou.dev/assignments?task=93251")
    td.add_existing("a", "https://yungu.chihairou.dev/assignments?task=93300")
    td.add_existing("b", "https://yungu.chihairou.dev/assignments?task=93300")
    r = sync_account(td, todo(CASE, ESSAY), store, NOW + 1, adopt=True)
    assert r["adopted"] == 1 and r["created"] == 0
    assert pairings(store)["93251"]["todoistId"] == paired


def test_no_adopt_scan_on_a_plain_sync(store):
    td = FakeTodoist()
    sync_account(td, todo(CASE), store, NOW, adopt=False)
    assert "find_tasks" not in td.names()


# ------------------------------------------------------------------- Review Focus 2: completed / deleted
@pytest.mark.parametrize("how", ["completed", "deleted", "deleted-404"])
def test_completed_or_deleted_task_is_never_touched_again(store, how):
    td = FakeTodoist()
    sync_account(td, todo(CASE), store, NOW, adopt=False)
    tid = pairings(store)["93251"]["todoistId"]
    if how == "completed":
        td.tasks[tid]["checked"] = True
    elif how == "deleted":
        td.tasks[tid]["is_deleted"] = True
    else:
        del td.tasks[tid]
    td.calls.clear()
    moved = (CASE[0], CASE[1], CASE[2], LATER)                 # the teacher moves the deadline
    r = sync_account(td, todo(moved), store, NOW + 1, adopt=False)
    assert r == {"created": 0, "updated": 0, "adopted": 0, "skipped": 1}
    assert td.names() == ["get_task"]                            # looked, then left it alone
    assert pairings(store)["93251"]["closed"] is True
    td.calls.clear()
    again = (CASE[0], CASE[1], CASE[2], LATER + 3600000)
    r = sync_account(td, todo(again), store, NOW + 2, adopt=True)            # even on a reconnect scan
    assert r == {"created": 0, "updated": 0, "adopted": 0, "skipped": 1}
    assert td.names() == ["find_tasks"]


def test_task_deleted_between_check_and_update_is_closed(store):
    td = FakeTodoist()
    sync_account(td, todo(CASE), store, NOW, adopt=False)
    td.fail_on["update_due"] = TodoistNotFound("gone")
    r = sync_account(td, todo((CASE[0], CASE[1], CASE[2], LATER)), store, NOW + 1, adopt=False)
    assert r["skipped"] == 1 and pairings(store)["93251"]["closed"] is True


def test_label_removed_by_the_user_still_counts_as_open(store):
    td = FakeTodoist()
    sync_account(td, todo(CASE), store, NOW, adopt=False)
    tid = pairings(store)["93251"]["todoistId"]
    td.tasks[tid]["labels"] = []
    r = sync_account(td, todo((CASE[0], CASE[1], CASE[2], LATER)), store, NOW + 1, adopt=True)
    assert r == {"created": 0, "updated": 1, "adopted": 0, "skipped": 0}
    assert td.names().count("get_task") == 1          # not in the labelled list, so it was looked up


# ------------------------------------------------------------------- Review Focus 3: deadline changed
def test_deadline_change_updates_only_the_due(store):
    td = FakeTodoist()
    sync_account(td, todo(CASE), store, NOW, adopt=False)
    tid = pairings(store)["93251"]["todoistId"]
    td.tasks[tid]["content"] = "edited by me"
    td.tasks[tid]["description"] = "my notes"
    td.calls.clear()
    r = sync_account(td, todo((CASE[0], "renamed on Yungu", "New course", LATER)), store, NOW + 1, adopt=False)
    assert r == {"created": 0, "updated": 1, "adopted": 0, "skipped": 0}
    assert td.calls == [("get_task", tid), ("update_due", tid, due_datetime(LATER))]
    assert td.tasks[tid]["content"] == "edited by me" and td.tasks[tid]["description"] == "my notes"
    assert pairings(store)["93251"] == {"todoistId": tid, "dueMs": LATER}
    td.calls.clear()
    sync_account(td, todo((CASE[0], "renamed on Yungu", "New course", LATER)), store, NOW + 2, adopt=False)
    assert td.calls == []                              # stored due now matches


def test_deadline_removed_clears_the_due(store):
    td = FakeTodoist()
    sync_account(td, todo(CASE), store, NOW, adopt=False)
    sync_account(td, todo((CASE[0], CASE[1], CASE[2], mapping.NO_DEADLINE_MS)), store, NOW + 1, adopt=False)
    assert td.calls[-1] == ("update_due", "td1", None)


# ------------------------------------------------------------------- failures part-way
def test_pairings_made_before_a_failure_are_kept(store):
    td = FakeTodoist()
    real = td.create_task
    made = []

    def flaky(*a):
        if made:
            raise TodoistUnavailable("429")
        made.append(1)
        return real(*a)
    td.create_task = flaky
    with pytest.raises(TodoistUnavailable):
        sync_account(td, todo(CASE, ESSAY), store, NOW, adopt=False)
    assert pairings(store) == {"93251": {"todoistId": "td1", "dueMs": DUE}, "93300": {"pending": NOW}}
    assert "lastSyncAt" not in store.load()
    td.create_task = real
    td.calls.clear()
    r = sync_account(td, todo(CASE, ESSAY), store, NOW + 1, adopt=False)
    assert r == {"created": 1, "updated": 0, "adopted": 0, "skipped": 0} and len(td.tasks) == 2
    assert td.names()[0] == "find_tasks"                 # the pending pairing was settled first: no match
    assert pairings(store)["93300"] == {"todoistId": "td2", "dueMs": LATER}


def test_auth_error_propagates(store):
    td = FakeTodoist()
    td.fail_on["ensure_label"] = TodoistAuthError("401")
    with pytest.raises(TodoistAuthError):
        sync_account(td, todo(CASE), store, NOW, adopt=False)


def test_disconnect_during_a_sync_cancels_it_and_stores_nothing(state, store):
    td = FakeTodoist()
    real = td.create_task

    def create_then_disconnect(*a):
        out = real(*a)
        store.delete()
        return out
    td.create_task = create_then_disconnect
    with pytest.raises(SyncCancelled):
        sync_account(td, todo(CASE, ESSAY), store, NOW, adopt=False)
    assert TodoistStore(state, USER).load() is None
    assert len(td.tasks) == 1                          # stopped at once


def test_not_connected_cancels(state):
    with pytest.raises(SyncCancelled):
        sync_account(FakeTodoist(), todo(CASE), TodoistStore(state, USER), NOW, adopt=False)


def test_reconnect_to_another_todoist_account_during_a_sync_cancels_it(store):
    td = FakeTodoist()
    real = td.create_task

    def create_then_switch(*a):
        out = real(*a)
        store.save({"token": "other", "account": {"id": "99"}, "pairings": {}})
        return out
    td.create_task = create_then_switch
    with pytest.raises(SyncCancelled):
        sync_account(td, todo(CASE, ESSAY), store, NOW, adopt=False)
    assert store.load()["pairings"] == {}              # nothing of account 42's written into 99's


def test_sync_logs_no_token(store, caplog):
    caplog.set_level(logging.DEBUG)
    td = FakeTodoist()
    sync_account(td, todo(CASE), store, NOW, adopt=True)
    td.fail_on["get_task"] = TodoistAuthError("401")
    with pytest.raises(TodoistAuthError):
        sync_account(td, todo((CASE[0], CASE[1], CASE[2], LATER)), store, NOW + 1, adopt=False)
    assert TOKEN not in caplog.text and "R1" not in caplog.text


# ------------------------------------------------------------------- client with token refresh
def test_make_client_is_none_when_not_connected(state):
    assert make_client(TodoistStore(state, USER), "cid", "s") is None


@responses.activate
def test_make_client_refreshes_and_stores_the_rotated_tokens(store):
    responses.get(f"{todoist.API}/user", status=401, json={"error_tag": "UNAUTHORIZED"})
    responses.post(todoist.TOKEN_URL, json={"access_token": "A2", "expires_in": 3600, "refresh_token": "R2"})
    responses.get(f"{todoist.API}/user", json={"id": "42", "full_name": "Chi", "email": "c@x"})
    c = make_client(store, "cid", "s")
    assert c.me()["id"] == "42"
    data = store.load()
    assert data["token"] == "A2" and data["refreshToken"] == "R2"
    assert responses.calls[2].request.headers["Authorization"] == "Bearer A2"


@responses.activate
def test_make_client_drops_the_consumed_refresh_token_when_the_answer_has_no_new_one(store, caplog):
    # Todoist omits refresh_token only when an already-used one is presented again within 60 s; presenting
    # it once more later would revoke all the user's tokens, so it is not kept. Logged, without values.
    caplog.set_level(logging.DEBUG)
    responses.get(f"{todoist.API}/user", status=401, json={})
    responses.post(todoist.TOKEN_URL, json={"access_token": "A2", "expires_in": 3600})
    responses.get(f"{todoist.API}/user", json={"id": "42"})
    make_client(store, "cid", "s").me()
    data = store.load()
    assert data["token"] == "A2" and data["refreshToken"] is None
    assert "without a new refresh token" in caplog.text
    assert "R1" not in caplog.text and "A2" not in caplog.text and TOKEN not in caplog.text


@responses.activate
def test_refresh_never_switches_onto_another_todoist_accounts_token(store):
    responses.get(f"{todoist.API}/user", status=401, json={})
    c = make_client(store, "cid", "s")
    store.connect("OTHER-TOKEN", "OTHER-R", {"id": "99", "name": "Someone", "email": "s@x"})
    with pytest.raises(SyncCancelled):
        c.me()
    assert len(responses.calls) == 1                       # no refresh, no request with the other token
    assert store.load()["token"] == "OTHER-TOKEN"


@responses.activate
def test_refresh_after_disconnect_cancels(store):
    responses.get(f"{todoist.API}/user", status=401, json={})
    c = make_client(store, "cid", "s")
    store.forget_token()
    with pytest.raises(SyncCancelled):
        c.me()
    assert len(responses.calls) == 1


@responses.activate
def test_make_client_without_a_refresh_token_is_an_auth_error(store):
    store.update(lambda d: d.pop("refreshToken"))
    responses.get(f"{todoist.API}/user", status=401, json={})
    with pytest.raises(TodoistAuthError):
        make_client(store, "cid", "s").me()
    assert len(responses.calls) == 1


@responses.activate
def test_make_client_uses_a_token_another_thread_already_refreshed(store):
    responses.get(f"{todoist.API}/user", status=401, json={})
    responses.get(f"{todoist.API}/user", json={"id": "42"})
    c = make_client(store, "cid", "s")
    store.update(lambda d: d.update(token="A-new", refreshToken="R-new"))       # someone refreshed meanwhile
    c.me()
    assert [x.request.url for x in responses.calls if "oauth" in x.request.url] == []
    assert responses.calls[1].request.headers["Authorization"] == "Bearer A-new"


# ------------------------------------------------------------------- fix round 1: creates that go wrong
class Crash(BaseException):
    """The process dying (not an Exception: nothing in the engine may catch it)."""


@pytest.mark.parametrize("error", [TodoistUnavailable("timeout after the server made it"), Crash()])
def test_a_create_that_fails_after_todoist_made_the_task_is_not_duplicated(state, store, error):
    td = FakeTodoist()
    real = td.create_task

    def made_then_failed(*a):
        real(*a)
        raise error
    td.create_task = made_then_failed
    with pytest.raises(type(error)):
        sync_account(td, todo(CASE), store, NOW, adopt=False)
    assert len(td.tasks) == 1 and pairings(store) == {"93251": {"pending": NOW}}
    td.create_task = real
    again = TodoistStore(state, USER)                        # e.g. after a restart
    r = sync_account(td, todo(CASE), again, NOW + 1, adopt=False)
    assert r == {"created": 0, "updated": 0, "adopted": 1, "skipped": 0}
    assert len(td.tasks) == 1 and pairings(again) == {"93251": {"todoistId": "td1", "dueMs": DUE}}
    td.calls.clear()
    sync_account(td, todo(CASE), again, NOW + 2, adopt=False)
    assert td.calls == []                                     # settled: no more scans


def test_a_crash_between_create_and_save_is_not_duplicated(state, store, monkeypatch):
    td = FakeTodoist()
    real_update = TodoistStore.update
    seen = []

    def update_then_die(self, change):
        seen.append(1)
        if len(seen) == 2:                                    # 1st: pending; 2nd: the real pairing
            raise Crash()
        return real_update(self, change)
    monkeypatch.setattr(TodoistStore, "update", update_then_die)
    with pytest.raises(Crash):
        sync_account(td, todo(CASE), store, NOW, adopt=False)
    monkeypatch.setattr(TodoistStore, "update", real_update)
    assert len(td.tasks) == 1 and pairings(store) == {"93251": {"pending": NOW}}
    r = sync_account(td, todo(CASE), TodoistStore(state, USER), NOW + 1, adopt=False)
    assert r["created"] == 0 and r["adopted"] == 1 and len(td.tasks) == 1


def test_a_pending_pairing_with_no_task_and_no_longer_to_do_is_dropped(store):
    td = FakeTodoist()
    store.update(lambda d: d["pairings"].update({"555": {"pending": NOW}}))
    r = sync_account(td, todo(), store, NOW + 1, adopt=False)
    assert r == {"created": 0, "updated": 0, "adopted": 0, "skipped": 0}
    assert pairings(store) == {} and td.names() == ["find_tasks"]


# ------------------------------------------------------------------- fix round 1: labels, content
def test_adoption_matches_the_label_whatever_its_case(store):
    td = FakeTodoist(labels=("yungu",))
    mine = td.add_existing("t", "https://yungu.chihairou.dev/assignments?task=93251", labels=("yungu",),
                           due={"date": "2026-11-05T15:59:00Z", "timezone": "Asia/Shanghai"})
    r = sync_account(td, todo(CASE), store, NOW, adopt=True)
    assert r == {"created": 0, "updated": 0, "adopted": 1, "skipped": 0}
    assert pairings(store)["93251"] == {"todoistId": mine, "dueMs": DUE}
    assert td.label_names == ["yungu"]


def test_an_assignment_without_a_course_is_just_its_title(store):
    td = FakeTodoist()
    sync_account(td, todo((1, "Reading log", "", DUE), (2, "Quiz", None, DUE)), store, NOW, adopt=False)
    assert [c[1] for c in td.calls if c[0] == "create_task"] == ["Reading log", "Quiz"]


# ------------------------------------------------------------------- fix round 1: Disconnect keeps pairings
ME = {"id": "42", "name": "Chi", "email": "c@example.com"}


def test_connect_stores_the_authorization_and_forget_token_keeps_only_the_pairings(state, tmp_path):
    s = TodoistStore(state, USER)
    assert s.connect("T", "R", ME) is False and s.is_connected()
    assert s.load() == {"token": "T", "refreshToken": "R", "account": ME, "pairingsAccount": "42", "pairings": {}}
    s.forget_token()                                     # no pairings: nothing left
    assert s.load() is None and not s.is_connected()
    s.connect("T", "R", ME)
    s.update(lambda d: d.update(lastSyncAt=NOW, error="x", pairings={"1": {"todoistId": "a", "dueMs": DUE}}))
    s.forget_token()
    assert s.load() == {"pairingsAccount": "42", "pairings": {"1": {"todoistId": "a", "dueMs": DUE}}}
    assert not s.is_connected() and make_client(s, "cid", "sec") is None
    assert stat.S_IMODE(os.stat(tmp_path / "state" / "users" / str(USER) / "todoist.json").st_mode) == 0o600
    with pytest.raises(SyncCancelled):
        sync_account(FakeTodoist(), todo(CASE), s, NOW, adopt=False)


def test_disconnect_and_reconnect_of_the_same_todoist_account_recreates_nothing(state):
    s = TodoistStore(state, USER)
    s.connect("T1", "R1", ME)
    td = FakeTodoist()
    sync_account(td, todo(CASE, ESSAY), s, NOW, adopt=True)
    done = pairings(s)["93251"]["todoistId"]
    td.tasks[done]["checked"] = True                     # completed in Todoist
    moved = (CASE[0], CASE[1], CASE[2], LATER)
    sync_account(td, todo(moved, ESSAY), s, NOW + 1, adopt=False)
    assert pairings(s)["93251"]["closed"] is True
    s.forget_token()                                      # Disconnect
    assert s.connect("T2", "R2", ME) is True               # same Todoist account
    td.calls.clear()
    later = (CASE[0], CASE[1], CASE[2], LATER + 3600000)
    r = sync_account(td, todo(later, ESSAY), s, NOW + 2, adopt=True)
    assert r == {"created": 0, "updated": 0, "adopted": 0, "skipped": 1}
    assert td.names() == ["find_tasks"] and len(td.tasks) == 2


def test_reconnect_with_another_todoist_account_starts_fresh(state):
    s = TodoistStore(state, USER)
    s.connect("T1", "R1", ME)
    sync_account(FakeTodoist(), todo(CASE), s, NOW, adopt=True)
    s.forget_token()
    assert s.connect("T9", "R9", {"id": "99", "name": "Other", "email": "o@x"}) is False
    assert s.load()["pairings"] == {} and s.load()["pairingsAccount"] == "99"
    other = FakeTodoist()
    r = sync_account(other, todo(CASE), s, NOW + 1, adopt=True)
    assert r["created"] == 1 and len(other.tasks) == 1


def test_disconnect_during_a_sync_keeps_the_token_forgotten(state):
    s = TodoistStore(state, USER)
    s.connect("T1", "R1", ME)
    td = FakeTodoist()
    real = td.create_task

    def create_then_disconnect(*a):
        out = real(*a)
        s.forget_token()
        return out
    td.create_task = create_then_disconnect
    with pytest.raises(SyncCancelled):
        sync_account(td, todo(CASE, ESSAY), s, NOW, adopt=False)
    data = TodoistStore(state, USER).load()
    assert "token" not in data and "lastSyncAt" not in data
    assert data["pairings"] == {"93251": {"pending": NOW}}   # settled on reconnect of this account
    assert len(td.tasks) == 1
    td.create_task = real
    s.connect("T2", "R2", ME)
    r = sync_account(td, todo(CASE, ESSAY), s, NOW + 1, adopt=True)
    assert r == {"created": 1, "updated": 0, "adopted": 1, "skipped": 0} and len(td.tasks) == 2
