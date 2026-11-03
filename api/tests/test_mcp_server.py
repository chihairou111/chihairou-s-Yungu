"""The /mcp endpoint (api/service/mcp_server.py) and personal agent tokens (agent_tokens.py, the
/agent/tokens routes): the official MCP SDK client in process over the ASGI app; no network."""
import hashlib
import json
import logging

import os
import threading
from types import SimpleNamespace

import anyio
import httpx2
import pytest
import requests
from fastapi.testclient import TestClient
from mcp import Client, types
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.exceptions import MCPError

from service import mcp_tools
from service.agent_tokens import MAX_PERSONAL_TOKENS, AccountRef, AgentAuth, PersonalTokens
from service.mcp_server import ACCOUNT, MAX_CONCURRENT_CALLS, RATE_LIMIT, RATE_LIMITED
from service.mcp_tools import SIGN_IN_TO_DASHBOARD, SOMETHING_WRONG
from service.yungu import IDLE_SECONDS
from test_service import (B_PW, ENDPOINTS, ME, OTHER, SIGN_IN_AGAIN, UNREACHABLE, api, auth, b_auth,  # noqa: F401
                          b_sign_in, clock, make, mode, no_network, sign_in, state_dir, tapi, world)

BASE = "http://127.0.0.1:8100"
METADATA = "https://yungu.chihairou.dev/.well-known/oauth-protected-resource/mcp"      # RFC 9728 §3.1, path-inserted
CHALLENGE = f'Bearer resource_metadata="{METADATA}", scope="read"'
INVALID = f'Bearer error="invalid_token", resource_metadata="{METADATA}", scope="read"'
TOOL_NAMES = {"list_todo", "list_submitted", "get_assignment", "get_schedule", "list_courses", "get_behaviour",
              "list_notifications"}
WRITES = {"save_draft", "submit", "add_comment", "delete_comment", "create_online_doc", "update_online_doc",
          "mark_notification_read", "mark_submitted", "upload_bytes", "file_redirect"}
RPC_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


@pytest.fixture(autouse=True)
def never_writes(world):
    yield
    for w in (world, world.peer):
        assert not WRITES & {c[0] for c in w.calls}, "an agent reached a Yungu write or a file"


def new_token(api, headers, name="Claude"):
    r = api.post("/agent/tokens", json={"name": name}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def token(api, auth):
    return new_token(api, auth)["token"]


@pytest.fixture
def b_token(api, b_auth):
    return new_token(api, b_auth)["token"]


def session(api, bearer, fn, mode="legacy"):
    """fn(client) with the official SDK client, over the app in process (its lifespan running)."""
    app = api.app

    async def main():
        async with app.router.lifespan_context(app):
            headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
            async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url=BASE,
                                          headers=headers) as http:
                async with Client(streamable_http_client(f"{BASE}/mcp", http_client=http), mode=mode) as client:
                    return await fn(client)
    return anyio.run(main)


def call(api, bearer, name, args=None):
    async def go(client):
        return await client.call_tool(name, args or {})
    return session(api, bearer, go)


def calls(api, bearer, batch):
    """[(name, args)] in one session: the results in order."""
    async def go(client):
        return [await client.call_tool(name, args) for name, args in batch]
    return session(api, bearer, go)


def text_of(result):
    return "\n".join(c.text for c in result.content)


def rpc(api, bearer, method="tools/call", params=None, host=None, origin=None):
    """A bare JSON-RPC POST (stateless: no initialize needed) through a TestClient with the lifespan on."""
    headers = dict(RPC_HEADERS)
    if bearer is not None:
        headers["Authorization"] = bearer
    if host:
        headers["Host"] = host
    if origin:
        headers["Origin"] = origin
    body = {"jsonrpc": "2.0", "id": 1, "method": method,
            "params": params if params is not None else {"name": "list_courses", "arguments": {}}}
    with TestClient(api.app, base_url=BASE) as client:
        return client.post("/mcp", json=body, headers=headers)


# ------------------------------------------------------------------ the protocol
def test_the_sdk_client_initializes_lists_seven_read_only_tools_and_calls_one(api, token, world):
    async def go(client):
        tools = (await client.list_tools()).tools
        result = await client.call_tool("list_courses", {})
        return client.server_info, tools, result
    info, tools, result = session(api, token, go)
    assert info.name == "yungu-lms"
    assert {t.name for t in tools} == TOOL_NAMES and len(tools) == 7
    for t in tools:
        assert t.annotations.read_only_hint is True and t.annotations.destructive_hint is False
        assert t.annotations.idempotent_hint is True and t.description and t.input_schema["type"] == "object"
    assert next(t for t in tools if t.name == "get_assignment").input_schema["required"] == ["id"]
    assert result.is_error is False
    assert result.structured_content["courses"][0] == {"id": 1086, "name": "Chinese I"}
    assert result.content[0].text.startswith("13 courses: ")
    assert json.loads(result.content[1].text) == result.structured_content        # the same JSON, as text


def test_the_sdk_client_in_auto_mode_works_too(api, token, world):
    async def go(client):
        return await client.call_tool("list_todo", {})
    result = session(api, token, go, mode="auto")
    assert result.is_error is False and result.structured_content["count"] == 1


def test_every_tool_answers_through_the_endpoint(api, token, world):
    batch = [(name, {"id": 93251} if name == "get_assignment" else {}) for name in sorted(TOOL_NAMES)]
    for result in calls(api, token, batch):
        assert result.is_error is False and result.structured_content is not None


@pytest.mark.parametrize("header,expected", [(None, CHALLENGE), ("Basic abc", CHALLENGE), ("Bearer ", CHALLENGE),
                                             ("Bearer wrong-token", INVALID), ("Bearer ylp_nope", INVALID),
                                             ("Bearer yla_nope", INVALID), ("dashboard", INVALID)])
def test_no_or_an_unknown_token_is_a_401_with_the_resource_metadata(api, auth, world, header, expected):
    """RFC 6750 §3.1: no error code when no Bearer credential came (none, or another scheme); invalid_token
    for a Bearer token we refuse."""
    if header == "dashboard":
        header = auth["Authorization"]                   # a dashboard token is no agent token
    before = len(world.calls)
    r = rpc(api, header)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == expected
    assert len(world.calls) == before


@pytest.mark.parametrize("bearer", [None, "token"])
def test_get_and_delete_are_405_stateless_mode_never_streams(api, token, bearer):
    headers = {"Accept": "text/event-stream"}
    if bearer:
        headers["Authorization"] = f"Bearer {token}"
    with TestClient(api.app, base_url=BASE) as client:
        for method in ("GET", "DELETE"):
            r = client.request(method, "/mcp", headers=headers)
            assert r.status_code == 405 and r.headers["allow"] == "POST"


def test_a_foreign_origin_is_a_403(api, token, world):
    assert rpc(api, f"Bearer {token}", origin="https://evil.example").status_code == 403
    assert rpc(api, f"Bearer {token}", origin="https://yungu.chihairou.dev").status_code == 200


def test_a_foreign_host_is_refused_and_the_public_host_accepted(api, token, world):
    assert rpc(api, f"Bearer {token}", host="evil.example").status_code == 421
    r = rpc(api, f"Bearer {token}", host="yungu.chihairou.dev")
    assert r.status_code == 200 and "H Algebra 2 I" in r.text


# --------------------------------------------------------- Review Focus 1: no write leakage
AGENT_ROUTES = [("GET", "/agent/tokens", None), ("POST", "/agent/tokens", {"name": "x"}),
                ("DELETE", "/agent/tokens/abc", None)]


@pytest.mark.parametrize("method,path,body", ENDPOINTS + AGENT_ROUTES)
def test_an_agent_token_is_refused_by_every_other_route(api, world, token, method, path, body):
    before = len(world.calls)
    r = api.request(method, path, json=body, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401 and r.json() == {"error": SIGN_IN_AGAIN}
    assert len(world.calls) == before


@pytest.mark.parametrize("method,path,body", AGENT_ROUTES)
@pytest.mark.parametrize("header", [None, "Bearer wrong-token", "Bearer "])
def test_the_agent_token_routes_need_a_dashboard_token(api, auth, world, method, path, body, header):
    headers = {} if header is None else {"Authorization": header}
    r = api.request(method, path, json=body, headers=headers)
    assert r.status_code == 401 and r.json() == {"error": SIGN_IN_AGAIN}


def test_a_non_owner_signed_out_of_the_dashboard_cannot_manage_tokens(api, auth, b_auth):
    assert api.delete("/session", headers=b_auth).status_code == 204
    assert api.get("/agent/tokens", headers=b_auth).status_code == 401


# ------------------------------------------------------- Review Focus 2: one account each
def test_each_token_reads_only_its_own_accounts_data(api, world, token, b_token):
    mine = call(api, token, "get_assignment", {"id": 93251})
    peer_calls = len(world.peer.calls)
    theirs = call(api, b_token, "get_assignment", {"id": 93251})
    assert not mine.structured_content["title"].startswith("B ")
    assert theirs.structured_content["title"].startswith("B ")
    assert theirs.structured_content["myFiles"] == [{"name": "b.txt"}]
    assert len(world.peer.calls) > peer_calls
    a_courses = call(api, token, "list_courses").structured_content["courses"]
    b_courses = call(api, b_token, "list_courses").structured_content["courses"]
    assert not any(c["name"].startswith("B ") for c in a_courses)
    assert b_courses and all(c["name"].startswith("B ") for c in b_courses)
    b_todo = call(api, b_token, "list_submitted").structured_content["assignments"]
    assert b_todo and all(a["title"].startswith("B ") for a in b_todo)


def test_an_id_only_the_other_account_has_is_not_found_for_this_one(api, world, token, b_token):
    peer = world.peer
    peer.mixed[99001] = json.loads(json.dumps(peer.mixed[93251]))
    peer.mixed[99001]["taskTitle"] = "B only-theirs"
    peer.ach[99001] = json.loads(json.dumps(peer.ach[93251]))
    peer.comments[99001] = []
    mine = call(api, token, "get_assignment", {"id": 99001})
    assert mine.is_error is True and text_of(mine) == "No assignment with that id."
    theirs = call(api, b_token, "get_assignment", {"id": 99001})
    assert theirs.is_error is False and theirs.structured_content["title"] == "B only-theirs"


# ------------------------------------------------------- Review Focus 4: revocation
def test_revoking_a_personal_token_stops_the_next_call(api, auth, world):
    made = new_token(api, auth)
    assert rpc(api, f"Bearer {made['token']}").status_code == 200
    assert api.delete(f"/agent/tokens/{made['id']}", headers=auth).status_code == 204
    r = rpc(api, f"Bearer {made['token']}")
    assert r.status_code == 401 and f'resource_metadata="{METADATA}"' in r.headers["www-authenticate"]


def test_revoking_mid_session_stops_the_next_call_in_that_session(api, auth, world):
    made = new_token(api, auth)
    app, statuses = api.app, []

    async def record(response):
        statuses.append(response.status_code)

    async def main():
        async with app.router.lifespan_context(app):
            async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url=BASE,
                                          headers={"Authorization": f"Bearer {made['token']}"},
                                          event_hooks={"response": [record]}) as http:
                async with Client(streamable_http_client(f"{BASE}/mcp", http_client=http)) as client:
                    first = await client.call_tool("list_courses", {})
                    PersonalTokens(app.state.service._state, ME).revoke(made["id"])
                    with pytest.raises(MCPError):
                        await client.call_tool("list_courses", {})
                    return first
    assert anyio.run(main).is_error is False
    assert statuses[-1] == 401 and 401 not in statuses[:-1]


# ------------------------------------------- Review Focus 5: no live session, Yungu down
def test_a_non_owner_without_a_live_session_is_told_to_sign_in_and_nothing_logs_in(make, api, world, b_token):
    restarted = make()                                       # S207's memory session ended with the restart
    result = call(restarted, b_token, "list_todo")
    assert result.is_error is True and text_of(result) == SIGN_IN_TO_DASHBOARD
    assert world.peer.logins == ["S207"]


def test_a_non_owner_whose_yungu_session_expired_is_told_to_sign_in(api, world, b_token):
    world.peer.expire_all()
    for _ in range(2):
        result = call(api, b_token, "list_courses")
        assert result.is_error is True and text_of(result) == SIGN_IN_TO_DASHBOARD
    assert world.peer.logins == ["S207"]


def test_yungu_down_is_a_friendly_message_without_a_trace(api, world, token):
    world.fail = requests.ConnectionError("down: https://task.yungu.org/api/x?ticket=ST-secret")
    result = call(api, token, "list_todo")
    assert result.is_error is True and text_of(result) == UNREACHABLE


def test_an_unexpected_failure_is_a_generic_message(api, world, token, monkeypatch, caplog):
    from service.app import Student

    def broken(self, refresh=False):
        raise KeyError("payload-detail-SECRET")
    monkeypatch.setattr(Student, "courses", broken)
    result = call(api, token, "list_courses")
    assert result.is_error is True and text_of(result) == SOMETHING_WRONG
    assert "payload-detail-SECRET" not in caplog.text and "Traceback" not in text_of(result)


def test_the_owner_signed_out_keeps_agent_access_but_must_sign_in_for_data(api, world, auth, token):
    assert api.delete("/session", headers=auth).status_code == 204       # forgets the saved password
    result = call(api, token, "list_courses")
    assert result.is_error is True and text_of(result) == SIGN_IN_TO_DASHBOARD
    assert world.logins == ["S106"]                                      # no login without a password
    sign_in(api)
    assert call(api, token, "list_courses").is_error is False


def test_bad_arguments_and_unknown_tools_are_tool_errors(api, world, token):
    bad, unknown = calls(api, token, [("get_assignment", {"id": "abc"}), ("hand_in", {})])
    assert bad.is_error is True and "id must be a whole number" in text_of(bad)
    assert unknown.is_error is True and text_of(unknown) == "Unknown tool."


# ------------------------------------------------------------------ rate limit
def test_sixty_tool_calls_a_minute_per_account(api, world, token, b_token, clock):
    results = calls(api, token, [("list_courses", {})] * (RATE_LIMIT + 1))
    assert all(r.is_error is False for r in results[:RATE_LIMIT])
    assert results[-1].is_error is True and text_of(results[-1]) == RATE_LIMITED
    yungu_calls = world.count("courses")
    assert call(api, token, "list_courses").is_error is True and world.count("courses") == yungu_calls
    assert call(api, b_token, "list_courses").is_error is False          # another account has its own budget
    clock.t += 60
    assert call(api, token, "list_courses").is_error is False


# ------------------------------------------------------------------ logging
def test_logs_carry_tool_status_and_a_hashed_account_only(api, world, token, caplog):
    caplog.set_level(logging.DEBUG)
    batch = [("list_submitted", {"course": "Zebra-Arg-7731"}), ("get_assignment", {"id": 93251}),
             ("list_courses", {}), ("get_assignment", {"id": 424242}), ("list_notifications", {"limit": 7})]
    results = calls(api, token, batch)
    title = results[1].structured_content["title"]
    # The service side only: the SDK *client* used here logs its own requests at DEBUG (a test artefact).
    text = "\n".join(f"{r.name} {r.getMessage()} {r.exc_text or ''}" for r in caplog.records
                     if not r.name.startswith(("mcp.client", "httpx2")))
    assert "yungu_lms.mcp" in text and "mcp.server" in text
    for secret in (token, token[4:], "Zebra-Arg-7731", "424242", title, "H Algebra 2 I", "Title 7790000"):
        assert secret not in text
    lines = [r.getMessage() for r in caplog.records if r.name == "yungu_lms.mcp"]
    assert any("list_courses" in line and "ok" in line for line in lines)
    assert any("get_assignment" in line and "not_found" in line for line in lines)
    account = hashlib.sha256(f"yungu-lms:{ME}".encode()).hexdigest()[:12]
    assert all(account in line for line in lines if "tool=" in line)
    assert not any(f"={ME}" in line or f" {ME} " in line for line in lines)


# --------------------------------------------------------- personal tokens: routes
def test_personal_tokens_are_shown_once_listed_and_stored_hashed(api, auth, state_dir):
    made = new_token(api, auth, "  My laptop  ")
    assert set(made) == {"id", "name", "token"} and made["name"] == "My laptop"
    assert made["token"].startswith("ylp_") and len(made["token"]) > 40
    listed = api.get("/agent/tokens", headers=auth).json()
    assert listed == {"personal": [{"id": made["id"], "name": "My laptop", "createdAt": listed["personal"][0]["createdAt"],
                                    "lastUsedAt": None}], "clients": []}
    assert isinstance(listed["personal"][0]["createdAt"], int)
    path = state_dir / "users" / str(ME) / "agent-tokens.json"
    assert mode(path) == 0o600 and mode(path.parent) == 0o700
    saved = path.read_text()
    assert made["token"] not in saved and hashlib.sha256(made["token"].encode()).hexdigest() in saved
    assert made["token"] not in api.get("/agent/tokens", headers=auth).text


def test_last_used_is_noted(api, auth, world, clock):
    made = new_token(api, auth)
    call(api, made["token"], "list_courses")
    used = api.get("/agent/tokens", headers=auth).json()["personal"][0]["lastUsedAt"]
    assert used == int(clock.t * 1000)


@pytest.mark.parametrize("name", ["", "   ", "x" * 65, None, 5])
def test_a_token_needs_a_name_of_at_most_64_characters(api, auth, name):
    r = api.post("/agent/tokens", json={"name": name}, headers=auth)
    assert r.status_code == 400 and r.json()["error"]


def test_at_most_twenty_personal_tokens_per_account(api, auth, b_auth):
    for i in range(MAX_PERSONAL_TOKENS):
        new_token(api, auth, f"t{i}")
    r = api.post("/agent/tokens", json={"name": "one more"}, headers=auth)
    assert r.status_code == 400 and r.json() == {"error": "You can have up to 20 tokens. Revoke one first."}
    new_token(api, b_auth)                                    # another account has its own


def test_an_account_sees_and_revokes_only_its_own_tokens(api, auth, b_auth, world):
    mine = new_token(api, auth)
    assert api.get("/agent/tokens", headers=b_auth).json() == {"personal": [], "clients": []}
    assert api.delete(f"/agent/tokens/{mine['id']}", headers=b_auth).status_code == 404
    assert rpc(api, f"Bearer {mine['token']}").status_code == 200
    assert api.delete("/agent/tokens/nope", headers=auth).status_code == 404


def test_personal_tokens_survive_a_restart(make, api, world, token):
    restarted = make()
    assert call(restarted, token, "list_courses").is_error is False


def test_the_resolver_takes_more_kinds_of_token(api, token):
    """Task 2 registers OAuth access tokens into the same resolver."""
    from service.agent_tokens import AccountRef
    resolver: AgentAuth = api.app.state.agent_auth

    class Fake:
        def verify(self, bearer):
            return AccountRef(ME, "oauth", "g1") if bearer == "yla_fake" else None
    resolver.register(Fake())
    assert resolver.resolve("yla_fake") == AccountRef(ME, "oauth", "g1")
    assert resolver.resolve(token).kind == "personal" and resolver.resolve(token).user_id == ME
    assert resolver.resolve("nope") is None and resolver.resolve("") is None
    assert rpc(api, "Bearer yla_fake").status_code == 200


def test_one_accounts_unreadable_token_file_does_not_fail_the_others(api, token, state_dir, caplog):
    for broken in ("998", "999"):                            # before and after ME in any scan order
        os.makedirs(state_dir / "users" / broken / "agent-tokens.json")       # a directory: reading it fails
    ref = api.app.state.agent_auth.resolve(token)
    assert ref is not None and ref.user_id == ME and ref.kind == "personal"
    assert "IsADirectoryError" in caplog.text and token not in caplog.text
    assert rpc(api, f"Bearer {token}").status_code == 200


def test_a_failing_last_used_write_does_not_refuse_the_token(api, token, monkeypatch, caplog):
    def full(self, data):
        raise OSError("disk full")
    monkeypatch.setattr(PersonalTokens, "_save", full)
    ref = api.app.state.agent_auth.resolve(token)
    assert ref is not None and ref.user_id == ME
    assert "OSError" in caplog.text and token not in caplog.text


def test_one_account_runs_at_most_four_tool_calls_at_once(api, world, auth, b_auth, monkeypatch):
    from service.app import Student
    agents = api.app.state.agents
    gate, lock = threading.Event(), threading.Lock()
    running, peak = {ME: 0, OTHER: 0}, {ME: 0, OTHER: 0}

    def slow(self, refresh=False):
        with lock:
            running[self.user_id] += 1
            peak[self.user_id] = max(peak[self.user_id], running[self.user_id])
        try:
            if self.user_id == ME:
                assert gate.wait(10)
            return []
        finally:
            with lock:
                running[self.user_id] -= 1
    monkeypatch.setattr(Student, "courses", slow)

    def ctx(user_id):
        return SimpleNamespace(request=SimpleNamespace(scope={ACCOUNT: AccountRef(user_id, "personal", "t")}))
    params = types.CallToolRequestParams(name="list_courses", arguments={})

    async def main():
        results = []

        async def one(user_id):
            results.append(await agents._call_tool(ctx(user_id), params))
        async with anyio.create_task_group() as tg:
            for _ in range(MAX_CONCURRENT_CALLS + 3):
                tg.start_soon(one, ME)
            try:
                with anyio.fail_after(10):
                    while running[ME] < MAX_CONCURRENT_CALLS:
                        await anyio.sleep(0.01)
                await anyio.sleep(0.1)
                assert running[ME] == MAX_CONCURRENT_CALLS          # the rest wait without a thread
                with anyio.fail_after(10):
                    other = await agents._call_tool(ctx(OTHER), params)    # another account is not held up
                assert other.is_error is False
            finally:
                gate.set()
        return results
    results = anyio.run(main)
    assert len(results) == MAX_CONCURRENT_CALLS + 3 and all(r.is_error is False for r in results)
    assert peak[ME] == MAX_CONCURRENT_CALLS == 4


# ------------------------------------------------------------------ idle sweep
def test_a_non_owner_with_agent_access_is_not_idled_out(api, world, auth, b_auth, b_token, clock):
    service = api.app.state.service
    clock.t += IDLE_SECONDS + 61
    assert api.get("/courses", headers=auth).status_code == 200              # any request sweeps
    assert service.yungu.is_on(OTHER)
    assert call(api, b_token, "list_courses").is_error is False
    assert api.get("/courses", headers=b_auth).status_code == 200


def test_after_revoking_its_last_token_a_non_owner_idles_out_again(api, world, auth, b_auth, clock):
    made = new_token(api, b_auth)
    assert api.delete(f"/agent/tokens/{made['id']}", headers=b_auth).status_code == 204
    clock.t += IDLE_SECONDS + 61
    assert api.get("/courses", headers=auth).status_code == 200
    assert not api.app.state.service.yungu.is_on(OTHER)
