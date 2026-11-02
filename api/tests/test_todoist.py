"""Todoist API v1 client (api/todoist.py): request shapes per api/NOTES.md section 12. No network (responses mocks)."""
import base64
import json
import logging
from urllib.parse import parse_qs, urlparse

import pytest
import requests
import responses

import todoist
from todoist import (API, TodoistAuthError, TodoistClient, TodoistError, TodoistNotFound, TodoistUnavailable,
                     authorize_url, due_datetime, exchange_code, refresh_access_token, revoke_token)

TOKEN = "tok-0123456789abcdef-SECRET"


def body_of(call):
    return json.loads(call.request.body)


def qs(call):
    return {k: v[0] for k, v in parse_qs(urlparse(call.request.url).query).items()}


def task(**over):
    t = {"id": "6Xt1", "content": "[CL Business] 1.8B Case Study", "description": "", "labels": ["Yungu"],
         "checked": False, "is_deleted": False, "due": None, "project_id": "inbox1"}
    t.update(over)
    return t


# ------------------------------------------------------------------- due / time
def test_due_datetime_is_the_exact_instant_in_utc_rfc3339():
    # 2026-11-05 23:59 China time = 15:59 UTC; seconds kept, milliseconds dropped
    ms = 1793894340000 + 999       # 2026-11-05T15:59:00.999Z
    assert due_datetime(ms) == "2026-11-05T15:59:00Z"


# ------------------------------------------------------------------- requests
@responses.activate
def test_every_request_sends_the_bearer_token():
    responses.get(f"{API}/user", json={"id": "42", "full_name": "Chi", "email": "c@example.com",
                                       "token": "SHOULD-NOT-LEAK", "tz_info": {"timezone": "Asia/Shanghai"}})
    me = TodoistClient(TOKEN).me()
    assert responses.calls[0].request.headers["Authorization"] == f"Bearer {TOKEN}"
    assert me == {"id": "42", "name": "Chi", "email": "c@example.com", "timezone": "Asia/Shanghai"}
    assert "SHOULD-NOT-LEAK" not in json.dumps(me)          # /user also answers the token: never passed on


@responses.activate
def test_create_task_body_is_exact_and_has_no_project():
    responses.post(f"{API}/tasks", json=task())
    out = TodoistClient(TOKEN).create_task(
        "[CL Business] 1.8B Case Study", "https://yungu.chihairou.dev/assignments?task=93251",
        "2026-11-05T15:59:00Z", ["Yungu"])
    assert out["id"] == "6Xt1"
    assert body_of(responses.calls[0]) == {
        "content": "[CL Business] 1.8B Case Study",
        "description": "https://yungu.chihairou.dev/assignments?task=93251",
        "due_datetime": "2026-11-05T15:59:00Z",
        "labels": ["Yungu"],
    }


@responses.activate
def test_create_task_without_a_deadline_sends_no_due():
    responses.post(f"{API}/tasks", json=task())
    TodoistClient(TOKEN).create_task("c", "d", None, ["Yungu"])
    assert body_of(responses.calls[0]) == {"content": "c", "description": "d", "labels": ["Yungu"]}


@responses.activate
def test_update_due_sends_only_the_due():
    responses.post(f"{API}/tasks/6Xt1", json=task())
    TodoistClient(TOKEN).update_due("6Xt1", "2026-11-06T15:59:00Z")
    assert body_of(responses.calls[0]) == {"due_datetime": "2026-11-06T15:59:00Z"}


@responses.activate
def test_update_due_none_clears_the_due():
    responses.post(f"{API}/tasks/6Xt1", json=task())
    TodoistClient(TOKEN).update_due("6Xt1", None)
    assert body_of(responses.calls[0]) == {"due_string": "no date"}


@responses.activate
def test_update_due_on_a_gone_task_raises_not_found():
    responses.post(f"{API}/tasks/6Xt1", status=404, json={"error": "Task not found"})
    with pytest.raises(TodoistNotFound):
        TodoistClient(TOKEN).update_due("6Xt1", "2026-11-06T15:59:00Z")


@responses.activate
def test_get_task_returns_the_task_or_none_when_gone():
    responses.get(f"{API}/tasks/6Xt1", json=task(checked=True))
    responses.get(f"{API}/tasks/gone", status=404, json={"error": "Task not found"})
    c = TodoistClient(TOKEN)
    assert c.get_task("6Xt1")["checked"] is True
    assert c.get_task("gone") is None


@responses.activate
def test_find_tasks_filters_by_label_name_and_follows_the_cursor():
    responses.get(f"{API}/tasks", json={"results": [task(id="a")], "next_cursor": "abc.def"})
    responses.get(f"{API}/tasks", json={"results": [task(id="b")], "next_cursor": None})
    out = TodoistClient(TOKEN).find_tasks("Yungu")
    assert [t["id"] for t in out] == ["a", "b"]
    assert qs(responses.calls[0]) == {"label": "Yungu", "limit": "200"}
    assert qs(responses.calls[1]) == {"label": "Yungu", "limit": "200", "cursor": "abc.def"}


@responses.activate
def test_find_tasks_leaves_out_completed_or_deleted_ones():
    responses.get(f"{API}/tasks", json={"results": [task(id="a"), task(id="b", checked=True),
                                                    task(id="c", is_deleted=True)], "next_cursor": None})
    assert [t["id"] for t in TodoistClient(TOKEN).find_tasks("Yungu")] == ["a"]


@responses.activate
def test_labels_are_paged():
    responses.get(f"{API}/labels", json={"results": [{"id": "1", "name": "Work"}], "next_cursor": "x.y"})
    responses.get(f"{API}/labels", json={"results": [{"id": "2", "name": "Yungu"}], "next_cursor": None})
    assert [l["name"] for l in TodoistClient(TOKEN).labels()] == ["Work", "Yungu"]
    assert qs(responses.calls[1])["cursor"] == "x.y"


@responses.activate
def test_ensure_label_creates_it_once_when_missing():
    responses.get(f"{API}/labels", json={"results": [{"id": "1", "name": "Work"}], "next_cursor": None})
    responses.post(f"{API}/labels", json={"id": "9", "name": "Yungu"})
    c = TodoistClient(TOKEN)
    c.ensure_label("Yungu")
    c.ensure_label("Yungu")                       # remembered: no second list or create
    posts = [x for x in responses.calls if x.request.method == "POST"]
    assert len(posts) == 1 and body_of(posts[0]) == {"name": "Yungu"}
    assert len(responses.calls) == 2


@responses.activate
def test_ensure_label_leaves_an_existing_label_alone_whatever_its_case():
    responses.get(f"{API}/labels", json={"results": [{"id": "1", "name": "yungu"}], "next_cursor": None})
    TodoistClient(TOKEN).ensure_label("Yungu")
    assert [x.request.method for x in responses.calls] == ["GET"]


# ------------------------------------------------------------------- errors
@pytest.mark.parametrize("status", [401, 403])
@responses.activate
def test_rejected_token_raises_auth_error(status):
    responses.get(f"{API}/user", status=status, json={"error_tag": "UNAUTHORIZED", "error_code": 477})
    with pytest.raises(TodoistAuthError):
        TodoistClient(TOKEN).me()


@pytest.mark.parametrize("tag", ["AUTH_INSUFFICIENT_TOKEN_SCOPE", "AUTH_INVALID_TOKEN", "UNAUTHORIZED"])
@responses.activate
def test_a_403_about_the_token_or_its_scope_is_an_auth_error(tag):
    responses.post(f"{API}/tasks", status=403, json={"error_tag": tag})
    with pytest.raises(TodoistAuthError):
        TodoistClient(TOKEN).create_task("c", "d", None, ["Yungu"])


@pytest.mark.parametrize("body", [{"error_tag": "FORBIDDEN"}, {"error_tag": "MAX_ITEMS_LIMIT_REACHED"}, None])
@responses.activate
def test_a_403_that_is_not_about_the_token_is_a_plain_refusal(body):
    responses.post(f"{API}/tasks", status=403, **({"json": body} if body else {"body": "forbidden"}))
    with pytest.raises(TodoistError) as e:
        TodoistClient(TOKEN).create_task("c", "d", None, ["Yungu"])
    assert not isinstance(e.value, (TodoistAuthError, TodoistUnavailable)) and e.value.status == 403


@pytest.mark.parametrize("status", [429, 500, 502, 503])
@responses.activate
def test_rate_limit_and_server_errors_raise_unavailable(status):
    responses.get(f"{API}/user", status=status, json={"error": "x", "error_extra": {"retry_after": 7}},
                  headers={"Retry-After": "7"} if status == 429 else {})
    with pytest.raises(TodoistUnavailable) as e:
        TodoistClient(TOKEN).me()
    if status == 429:
        assert e.value.retry_after == 7


@responses.activate
def test_timeout_and_connection_errors_raise_unavailable():
    responses.get(f"{API}/user", body=requests.Timeout("slow"))
    responses.get(f"{API}/labels", body=requests.ConnectionError("down"))
    c = TodoistClient(TOKEN)
    with pytest.raises(TodoistUnavailable):
        c.me()
    with pytest.raises(TodoistUnavailable):
        c.labels()


@responses.activate
def test_non_json_answer_raises_unavailable():
    responses.get(f"{API}/user", body="<html>maintenance</html>", content_type="text/html")
    with pytest.raises(TodoistUnavailable):
        TodoistClient(TOKEN).me()


@responses.activate
def test_other_client_errors_raise_todoist_error():
    responses.post(f"{API}/tasks", status=400, json={"error_tag": "INVALID_ARGUMENT_VALUE"})
    with pytest.raises(TodoistError) as e:
        TodoistClient(TOKEN).create_task("c", "d", None, ["Yungu"])
    assert not isinstance(e.value, (TodoistAuthError, TodoistUnavailable))


@responses.activate
def test_401_refreshes_once_and_retries_with_the_new_token():
    responses.get(f"{API}/user", status=401, json={"error_tag": "UNAUTHORIZED"})
    responses.get(f"{API}/user", json={"id": "42", "full_name": "Chi", "email": "c@x"})
    seen = []

    def refresh():
        seen.append(1)
        return "new-token"
    c = TodoistClient(TOKEN, refresh=refresh)
    assert c.me()["id"] == "42"
    assert seen == [1] and c.token == "new-token"
    assert responses.calls[1].request.headers["Authorization"] == "Bearer new-token"


@responses.activate
def test_a_second_401_after_refresh_is_an_auth_error():
    responses.get(f"{API}/user", status=401, json={})
    responses.get(f"{API}/user", status=401, json={})
    with pytest.raises(TodoistAuthError):
        TodoistClient(TOKEN, refresh=lambda: "new-token").me()


@responses.activate
def test_the_token_never_reaches_logs_or_error_messages(caplog):
    caplog.set_level(logging.DEBUG)
    responses.get(f"{API}/user", status=401, json={"error": "Unauthorized"})
    responses.get(f"{API}/labels", status=503, body="down")
    responses.post(f"{API}/tasks", status=400, json={"error": "bad"})
    c = TodoistClient(TOKEN)
    errors = []
    for call in (c.me, c.labels, lambda: c.create_task("c", "d", None, [])):
        with pytest.raises(TodoistError) as e:
            call()
        errors.append(f"{e.value!s} {e.value!r}")
    assert TOKEN not in caplog.text
    assert all(TOKEN not in x for x in errors)
    assert TOKEN not in repr(c)


# ------------------------------------------------------------------- OAuth
def test_authorize_url_asks_for_read_write_with_the_state():
    url = authorize_url("cid", "st4te", "https://yungu.chihairou.dev/api/todoist/callback")
    u = urlparse(url)
    assert f"{u.scheme}://{u.netloc}{u.path}" == "https://app.todoist.com/oauth/authorize"
    assert {k: v[0] for k, v in parse_qs(u.query).items()} == {
        "client_id": "cid", "scope": "data:read_write", "state": "st4te", "response_type": "code",
        "redirect_uri": "https://yungu.chihairou.dev/api/todoist/callback"}


@responses.activate
def test_exchange_code_posts_the_form_and_returns_the_tokens():
    responses.post(todoist.TOKEN_URL, json={"access_token": "A", "token_type": "Bearer", "expires_in": 3600,
                                            "refresh_token": "R", "scope": "data:read_write"})
    out = exchange_code("cid", "csecret", "the-code", "https://r/cb")
    assert out == {"access_token": "A", "refresh_token": "R", "expires_in": 3600}
    assert {k: v[0] for k, v in parse_qs(responses.calls[0].request.body).items()} == {
        "client_id": "cid", "client_secret": "csecret", "code": "the-code", "redirect_uri": "https://r/cb"}


@responses.activate
def test_legacy_long_lived_token_has_no_refresh_token():
    responses.post(todoist.TOKEN_URL, json={"access_token": "A", "token_type": "Bearer", "expires_in": 315360000})
    assert exchange_code("cid", "s", "c", "https://r/cb") == {"access_token": "A", "refresh_token": None,
                                                              "expires_in": 315360000}


@responses.activate
def test_bad_code_is_an_auth_error():
    responses.post(todoist.TOKEN_URL, status=400, json={"error": "bad_authorization_code"})
    with pytest.raises(TodoistAuthError):
        exchange_code("cid", "s", "c", "https://r/cb")


@responses.activate
def test_refresh_posts_the_refresh_grant():
    responses.post(todoist.TOKEN_URL, json={"access_token": "A2", "expires_in": 3600, "refresh_token": "R2"})
    assert refresh_access_token("cid", "s", "R1") == {"access_token": "A2", "refresh_token": "R2", "expires_in": 3600}
    assert {k: v[0] for k, v in parse_qs(responses.calls[0].request.body).items()} == {
        "client_id": "cid", "client_secret": "s", "grant_type": "refresh_token", "refresh_token": "R1"}


@responses.activate
def test_refresh_invalid_grant_is_an_auth_error_and_5xx_is_unavailable():
    responses.post(todoist.TOKEN_URL, status=400, json={"error": "invalid_grant"})
    responses.post(todoist.TOKEN_URL, status=502, body="bad gateway")
    with pytest.raises(TodoistAuthError):
        refresh_access_token("cid", "s", "R1")
    with pytest.raises(TodoistUnavailable):
        refresh_access_token("cid", "s", "R1")


@responses.activate
def test_revoke_uses_basic_auth_and_the_form():
    responses.post(f"{API}/revoke", body="")
    revoke_token("cid", "csecret", "A")
    call = responses.calls[0]
    assert call.request.headers["Authorization"] == "Basic " + base64.b64encode(b"cid:csecret").decode()
    assert {k: v[0] for k, v in parse_qs(call.request.body).items()} == {"token": "A", "token_type_hint": "access_token"}
