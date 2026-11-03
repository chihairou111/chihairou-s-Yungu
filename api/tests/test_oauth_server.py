"""OAuth 2.1 for agents (api/service/oauth_server.py): metadata (RFC 9728, RFC 8414), dynamic client
registration (RFC 7591), the consent API the dashboard's /oauth/authorize page calls, authorization code +
PKCE S256, rotating refresh tokens, revocation (RFC 7009) and "Agent access" — through the app in process,
with the clock injected; no network. The official MCP SDK client runs the whole flow at the end."""
import base64
import hashlib
import logging
import secrets
import threading
from urllib.parse import parse_qsl, urlsplit

import anyio
import httpx2
import pytest
from mcp import Client
from mcp.client.auth import OAuthClientProvider
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.auth import AuthorizationCodeResult, OAuthClientMetadata

from service import oauth_server
from service.yungu import IDLE_SECONDS
from test_mcp_server import call, never_writes, rpc  # noqa: F401
from test_service import (ME, OTHER, SIGN_IN_AGAIN, api, auth, b_auth, b_sign_in, clock, make, mode,  # noqa: F401
                          no_network, sign_in, state_dir, tapi, world)

PUBLIC = "https://yungu.chihairou.dev"
RESOURCE = f"{PUBLIC}/mcp"
REDIRECT = "http://127.0.0.1:33418/callback"
WEB_REDIRECT = "https://claude.ai/api/mcp/auth_callback"
FORM = {"Content-Type": "application/x-www-form-urlencoded"}


# ------------------------------------------------------------------ helpers
def register(api, address="203.0.113.5", **body):
    body = {"client_name": "Claude", "redirect_uris": [REDIRECT], **body}
    body = {k: v for k, v in body.items() if v is not None}
    return api.post("/oauth/register", json=body, headers={"X-Real-IP": address})


def client_id(api, **body):
    r = register(api, **body)
    assert r.status_code == 201, r.text
    return r.json()["client_id"]


def pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def params(cid, challenge, **over):
    p = {"response_type": "code", "client_id": cid, "redirect_uri": REDIRECT, "state": "st-1",
         "code_challenge": challenge, "code_challenge_method": "S256", "scope": "read", "resource": RESOURCE}
    p.update(over)
    return {k: v for k, v in p.items() if v is not None}


def query(url):
    return dict(parse_qsl(urlsplit(url).query))


def approve(api, headers, p, decision="allow"):
    return api.post("/oauth/authorize/approve", json={**p, "decision": decision}, headers=headers)


def get_code(api, headers, cid, challenge, **over):
    r = approve(api, headers, params(cid, challenge, **over))
    assert r.status_code == 200, r.text
    return query(r.json()["redirect"])["code"]


def token(api, form, headers=None):
    return api.post("/oauth/token", data=form, headers={**FORM, **(headers or {})})


def exchange(api, cid, the_code, verifier, **over):
    form = {"grant_type": "authorization_code", "code": the_code, "code_verifier": verifier, "client_id": cid,
            "redirect_uri": REDIRECT, "resource": RESOURCE}
    form.update(over)
    return token(api, {k: v for k, v in form.items() if v is not None})


def refresh(api, cid, the_token, **over):
    form = {"grant_type": "refresh_token", "refresh_token": the_token, "client_id": cid, "resource": RESOURCE}
    form.update(over)
    return token(api, {k: v for k, v in form.items() if v is not None})


def connect(api, headers, **reg):
    """The whole flow for one agent: (client_id, token response)."""
    cid = client_id(api, **reg)
    verifier, challenge = pkce()
    code = get_code(api, headers, cid, challenge)
    r = exchange(api, cid, code, verifier)
    assert r.status_code == 200, r.text
    return cid, r.json()


def works(api, access):
    return rpc(api, f"Bearer {access}").status_code == 200


# ------------------------------------------------------------------ metadata
PRM = {"resource": RESOURCE, "authorization_servers": [PUBLIC], "scopes_supported": ["read"],
       "bearer_methods_supported": ["header"], "resource_name": "Yungu LMS (read-only)"}
ASM = {
    "issuer": PUBLIC,
    "authorization_endpoint": f"{PUBLIC}/oauth/authorize",
    "token_endpoint": f"{PUBLIC}/oauth/token",
    "registration_endpoint": f"{PUBLIC}/oauth/register",
    "revocation_endpoint": f"{PUBLIC}/oauth/revoke",
    "scopes_supported": ["read"],
    "response_types_supported": ["code"],
    "response_modes_supported": ["query"],
    "grant_types_supported": ["authorization_code", "refresh_token"],
    "token_endpoint_auth_methods_supported": ["none"],
    "revocation_endpoint_auth_methods_supported": ["none"],
    "code_challenge_methods_supported": ["S256"],
    "authorization_response_iss_parameter_supported": True,
}


@pytest.mark.parametrize("path", ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"])
def test_the_protected_resource_metadata_is_exact(api, path):
    r = api.get(path)
    assert r.status_code == 200 and r.json() == PRM
    assert r.headers["content-type"].startswith("application/json")


def test_the_authorization_server_metadata_is_exact(api):
    r = api.get("/.well-known/oauth-authorization-server")
    assert r.status_code == 200 and r.json() == ASM


def test_the_401_points_at_the_metadata(api):
    r = rpc(api, None)
    assert r.status_code == 401
    assert r.headers["www-authenticate"] == \
        f'Bearer resource_metadata="{PUBLIC}/.well-known/oauth-protected-resource/mcp", scope="read"'
    assert api.get("/.well-known/oauth-protected-resource/mcp").json() == PRM == \
        api.get("/.well-known/oauth-protected-resource").json()                 # both still served


# ------------------------------------------------------------------ registration (RFC 7591)
def test_registration_makes_a_public_client(api, clock):
    r = register(api, token_endpoint_auth_method="client_secret_post", grant_types=["authorization_code"],
                 response_types=["code"], scope="read", application_type="native", logo_uri="https://x.example/l.png")
    assert r.status_code == 201
    body = r.json()
    assert body == {"client_id": body["client_id"], "client_id_issued_at": int(clock.t), "client_name": "Claude",
                    "redirect_uris": [REDIRECT], "grant_types": ["authorization_code", "refresh_token"],
                    "response_types": ["code"], "token_endpoint_auth_method": "none", "scope": "read"}
    assert body["client_id"].startswith("ylc_") and "client_secret" not in body
    assert r.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("uri", [WEB_REDIRECT, "http://localhost:8080/cb", "http://[::1]:9/cb", "http://127.0.0.1/cb",
                                 "https://app.example/cb?x=1", "https://xn--bcher-kva.example/cb", "https://10.0.0.5:8443/cb",
                                 "https://[2001:db8::1]/cb", "https://my-app.example.com/cb%20x",
                                 # the bracket form compared without regard to case; an IPv4 literal is fine
                                 "https://[2001:DB8::1]/cb", "https://[2001:DB8::ABCD]:8443/cb", "https://1.2.3.4/cb",
                                 "https://a1.example/cb", "https://example.x123/cb", "https://0xa.example/cb"])
def test_https_and_loopback_redirect_uris_are_accepted(api, uri):
    assert register(api, redirect_uris=[uri]).status_code == 201


@pytest.mark.parametrize("uris", [["http://example.com/cb"], ["cursor://anysphere/cb"], ["https://x.example/cb#f"],
                                  ["ftp://x.example/cb"], ["not a url"], ["https:///cb"], ["https://u:p@x.example/cb"],
                                  ["https://x.example/c b"], [], None, "https://x.example/cb", [5],
                                  [WEB_REDIRECT, "http://evil.example/cb"], ["https://x.example/" + "a" * 2100],
                                  [f"https://x.example/{i}" for i in range(11)],
                                  # hosts a person could misread on the consent page, or a browser reads otherwise
                                  ["https://claude.ai%2eevil.example/cb"], ["https://evil.example\\.claude.ai/cb"],
                                  ["https://claude.ai\\@evil.example/cb"], ["https://bücher.example/cb"],
                                  ["https://claude.ai%00.evil.example/cb"], ["https://-bad.example/cb"],
                                  ["https://bad-.example/cb"], ["https://a..example/cb"], ["https://claude.ai./cb"],
                                  ["https://under_score.example/cb"], ["https://x.example/a\\b"],
                                  ["https://claude.ai\u3002evil.example/cb"], ["https://[not-ipv6]/cb"],
                                  # a numeric or 0x… last label makes a browser read the host as an IPv4 address
                                  ["https://0x7f.0.0.1/cb"], ["https://example.123/cb"], ["https://claude.ai.0x7f/cb"],
                                  ["https://example.0x/cb"], ["https://example.0XFF/cb"], ["https://1.2.3/cb"],
                                  ["https://01.2.3.4/cb"], ["https://1.2.3.4.5/cb"], ["https://0x7f000001/cb"],
                                  ["https://2130706433/cb"]])
def test_other_redirect_uris_are_refused(api, uris):
    r = register(api, redirect_uris=uris)
    assert r.status_code == 400 and r.json()["error"] == "invalid_redirect_uri" and r.json()["error_description"]


@pytest.mark.parametrize("body", [{"client_name": "x" * 65}, {"grant_types": ["client_credentials"]},
                                  {"grant_types": ["authorization_code", "implicit"]}, {"response_types": ["token"]},
                                  {"client_name": 7}, {"grant_types": "authorization_code"}])
def test_bad_client_metadata_is_refused(api, body):
    r = register(api, **body)
    assert r.status_code == 400 and r.json()["error"] == "invalid_client_metadata"


@pytest.mark.parametrize("raw", [b"not json", b"[1,2]", b'"x"', b"{" + b" " * 20000 + b"}"])
def test_a_registration_that_is_no_json_object_is_refused(api, raw):
    r = api.post("/oauth/register", content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 400 and r.json()["error"] == "invalid_client_metadata"


def test_a_name_is_trimmed_and_a_missing_one_has_a_stand_in(api, auth):
    named = client_id(api, client_name="  Claude Code  ")
    nameless = client_id(api, client_name=None)
    _, challenge = pkce()
    names = [api.post("/oauth/authorize/request", json=params(c, challenge), headers=auth).json()["client"]["name"]
             for c in (named, nameless)]
    assert names == ["Claude Code", "Unnamed agent"]


def test_registrations_are_capped_overall_and_never_used_ones_make_room_after_an_hour(api, auth, monkeypatch, clock):
    monkeypatch.setattr(oauth_server, "MAX_CLIENTS", 3)
    used = client_id(api)
    _, challenge = pkce()
    get_code(api, auth, used, challenge)                       # approved once: never evicted for room
    first, _ = client_id(api, address="198.51.100.1"), client_id(api, address="198.51.100.2")
    r = register(api, address="198.51.100.3")
    assert r.status_code == 503 and r.json()["error"] == "temporarily_unavailable"
    clock.t += 3601
    assert register(api, address="198.51.100.3").status_code == 201        # the oldest never-used one went
    p = params(first, challenge)
    assert api.post("/oauth/authorize/request", json=p, headers=auth).status_code == 400
    assert api.post("/oauth/authorize/request", json=params(used, challenge), headers=auth).status_code == 200


def test_ipv6_addresses_share_a_throttle_per_64(api):
    for i in range(oauth_server.REGISTRATIONS_PER_ADDRESS):
        assert register(api, address=f"2001:db8:1:2::{i + 1:x}").status_code == 201
    assert register(api, address="2001:db8:1:2:ffff:1:2:3").status_code == 429       # the same /64
    assert register(api, address="2001:db8:1:3::1").status_code == 201                # the next /64


def test_without_x_real_ip_the_socket_peer_is_the_address(api):
    body = {"client_name": "Claude", "redirect_uris": [REDIRECT]}
    for _ in range(oauth_server.REGISTRATIONS_PER_ADDRESS):
        assert api.post("/oauth/register", json=body).status_code == 201
    assert api.post("/oauth/register", json=body).status_code == 429
    assert register(api, address="198.51.100.77").status_code == 201


def test_registrations_are_throttled_per_address(api, clock):
    for _ in range(oauth_server.REGISTRATIONS_PER_ADDRESS):
        assert register(api, address="192.0.2.1").status_code == 201
    r = register(api, address="192.0.2.1")
    assert r.status_code == 429 and r.json()["error"] == "temporarily_unavailable"
    assert register(api, address="192.0.2.2").status_code == 201
    clock.t += oauth_server.REGISTRATION_WINDOW_SECONDS
    assert register(api, address="192.0.2.1").status_code == 201


def test_an_unused_client_expires_after_30_days_and_a_used_one_stays(api, auth, clock):
    idle = client_id(api)
    busy, tokens = connect(api, auth)
    _, challenge = pkce()
    clock.t += 29 * 86400
    r = refresh(api, busy, tokens["refresh_token"])
    assert r.status_code == 200
    clock.t += 2 * 86400
    assert api.post("/oauth/authorize/request", json=params(idle, challenge), headers=auth).status_code == 400
    assert api.post("/oauth/authorize/request", json=params(busy, challenge), headers=auth).status_code == 200
    assert refresh(api, busy, r.json()["refresh_token"]).status_code == 200


def test_clients_survive_a_restart(make, api, auth):
    cid = client_id(api)
    restarted = make()
    _, challenge = pkce()
    assert restarted.post("/oauth/authorize/request", json=params(cid, challenge), headers=auth).status_code == 200


# ------------------------------------------------------------------ the consent API
@pytest.mark.parametrize("uri,host", [("https://APP.Example.COM/cb", "app.example.com"),
                                      ("https://xn--bcher-kva.example/cb", "xn--bcher-kva.example"),
                                      ("https://[2001:db8::1]:8443/cb", "2001:db8::1"),
                                      ("https://[2001:DB8::1]/cb", "2001:db8::1")])
def test_the_return_host_shown_is_the_parsed_normalised_host(api, auth, uri, host):
    cid = client_id(api, redirect_uris=[uri])
    _, challenge = pkce()
    r = api.post("/oauth/authorize/request", json=params(cid, challenge, redirect_uri=uri), headers=auth)
    assert r.status_code == 200 and r.json()["client"]["redirectHost"] == host


def test_a_valid_request_names_the_client_and_its_return_host(api, auth):
    cid = client_id(api)
    _, challenge = pkce()
    r = api.post("/oauth/authorize/request", json=params(cid, challenge), headers=auth)
    assert r.status_code == 200
    assert r.json() == {"valid": True, "client": {"name": "Claude", "redirectHost": "127.0.0.1"}}


def test_the_consent_api_needs_a_dashboard_session(api, auth):
    cid, tokens = connect(api, auth)
    _, challenge = pkce()
    for path in ("/oauth/authorize/request", "/oauth/authorize/approve"):
        for headers in ({}, {"Authorization": f"Bearer {tokens['access_token']}"}, {"Authorization": "Bearer nope"}):
            r = api.post(path, json={**params(cid, challenge), "decision": "allow"}, headers=headers)
            assert r.status_code == 401 and r.json() == {"error": SIGN_IN_AGAIN}


@pytest.mark.parametrize("over,code", [
    ({"client_id": "ylc_unknown"}, "invalid_client"),
    ({"client_id": ""}, "invalid_client"),
    ({"redirect_uri": "http://127.0.0.1:33418/other"}, "invalid_request"),
    ({"redirect_uri": "https://evil.example/callback"}, "invalid_request"),
    ({"redirect_uri": "http://127.0.0.1:33418/callback?x=1"}, "invalid_request"),
    ({"redirect_uri": None}, "invalid_request"),
])
def test_an_untrusted_client_or_return_address_gets_no_redirect(api, auth, over, code):
    cid = client_id(api)
    _, challenge = pkce()
    for path in ("/oauth/authorize/request", "/oauth/authorize/approve"):
        r = api.post(path, json={**params(cid, challenge, **over), "decision": "allow"}, headers=auth)
        assert r.status_code == 400
        body = r.json()
        assert body["code"] == code and body["error"] and "redirect" not in body


def test_a_loopback_return_address_may_use_any_port(api, auth):
    cid = client_id(api)
    verifier, challenge = pkce()
    other_port = "http://127.0.0.1:5555/callback"
    r = approve(api, auth, params(cid, challenge, redirect_uri=other_port))
    assert r.status_code == 200 and r.json()["redirect"].startswith(other_port + "?code=")
    code = query(r.json()["redirect"])["code"]
    assert exchange(api, cid, code, verifier, redirect_uri=REDIRECT).status_code == 400     # the one it asked with
    code = get_code(api, auth, cid, challenge, redirect_uri=other_port)
    assert exchange(api, cid, code, verifier, redirect_uri=other_port).status_code == 200


def test_an_https_return_address_must_match_exactly(api, auth):
    cid = client_id(api, redirect_uris=[WEB_REDIRECT])
    _, challenge = pkce()
    for uri in (WEB_REDIRECT + "/", "https://claude.ai:8443/api/mcp/auth_callback", "https://CLAUDE.ai/api/mcp/auth_callback"):
        r = api.post("/oauth/authorize/request", json=params(cid, challenge, redirect_uri=uri), headers=auth)
        assert r.status_code == 400 and "redirect" not in r.json()
    r = api.post("/oauth/authorize/request", json=params(cid, challenge, redirect_uri=WEB_REDIRECT), headers=auth)
    assert r.status_code == 200 and r.json()["client"]["redirectHost"] == "claude.ai"


@pytest.mark.parametrize("over,code", [
    ({"resource": "https://yungu.chihairou.dev"}, "invalid_target"),
    ({"resource": "https://evil.example/mcp"}, "invalid_target"),
    ({"resource": RESOURCE + "/"}, "invalid_target"),
    ({"code_challenge": None}, "invalid_request"),
    ({"code_challenge": "short"}, "invalid_request"),
    ({"code_challenge_method": "plain"}, "invalid_request"),
    ({"code_challenge_method": None}, "invalid_request"),
    ({"response_type": "token"}, "unsupported_response_type"),
    ({"scope": "read\x01"}, "invalid_scope"),
])
def test_other_bad_requests_go_back_to_the_client_with_an_error(api, auth, over, code):
    cid = client_id(api)
    _, challenge = pkce()
    for path in ("/oauth/authorize/request", "/oauth/authorize/approve"):
        r = api.post(path, json={**params(cid, challenge, **over), "decision": "allow"}, headers=auth)
        assert r.status_code == 400
        body = r.json()
        assert body["code"] == code and body["error"]
        back = query(body["redirect"])
        assert body["redirect"].startswith(REDIRECT + "?")
        assert back == {"error": code, "state": "st-1", "iss": PUBLIC}


@pytest.mark.parametrize("over", [{"resource": None}, {"scope": None}, {"scope": "read offline_access"},
                                  {"scope": "openid profile"}, {"response_type": None}, {"state": None},
                                  {"resource": "HTTPS://YUNGU.CHIHAIROU.DEV/mcp"}])
def test_lenient_where_it_is_safe(api, auth, over):
    cid = client_id(api)
    verifier, challenge = pkce()
    r = approve(api, auth, params(cid, challenge, **over))
    assert r.status_code == 200, r.text
    back = query(r.json()["redirect"])
    assert ("state" in back) == ("state" not in over)
    t = exchange(api, cid, back["code"], verifier, resource=None if "resource" in over else RESOURCE)
    assert t.status_code == 200 and t.json()["scope"] == "read"


def test_allow_redirects_with_a_code_the_state_and_the_issuer(api, auth):
    cid = client_id(api, redirect_uris=["https://app.example/cb?keep=1"])
    _, challenge = pkce()
    r = approve(api, auth, params(cid, challenge, redirect_uri="https://app.example/cb?keep=1", state="a b&c"))
    assert r.status_code == 200
    url = r.json()["redirect"]
    assert url.startswith("https://app.example/cb?keep=1&code=")
    back = query(url)
    assert back["keep"] == "1" and back["state"] == "a b&c" and back["iss"] == PUBLIC
    assert len(back["code"]) >= 40


def test_deny_redirects_with_access_denied_and_no_code(api, auth):
    cid = client_id(api)
    _, challenge = pkce()
    r = approve(api, auth, params(cid, challenge), decision="deny")
    assert r.status_code == 200
    assert query(r.json()["redirect"]) == {"error": "access_denied", "state": "st-1", "iss": PUBLIC}
    assert api.get("/agent/tokens", headers=auth).json()["clients"] == []


@pytest.mark.parametrize("decision", ["", "maybe", None])
def test_approve_needs_a_decision(api, auth, decision):
    cid = client_id(api)
    _, challenge = pkce()
    body = {**params(cid, challenge)}
    if decision is not None:
        body["decision"] = decision
    r = api.post("/oauth/authorize/approve", json=body, headers=auth)
    assert r.status_code == 400 and "redirect" not in r.json()


# ------------------------------------------------------------------ the token endpoint
def test_the_code_buys_a_one_hour_access_token_and_a_refresh_token(api, auth, world):
    cid = client_id(api)
    verifier, challenge = pkce()
    code = get_code(api, auth, cid, challenge)
    r = exchange(api, cid, code, verifier)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"access_token", "token_type", "expires_in", "refresh_token", "scope"}
    assert body["token_type"] == "Bearer" and body["expires_in"] == 3600 and body["scope"] == "read"
    assert body["access_token"].startswith("yla_") and body["refresh_token"].startswith("ylr_")
    assert r.headers["cache-control"] == "no-store" and r.headers["pragma"] == "no-cache"
    result = call(api, body["access_token"], "list_courses")
    assert result.is_error is False and result.structured_content["courses"][0]["name"] == "Chinese I"


def misuse_cases():
    other = object()
    return [
        ("wrong verifier", {"code_verifier": secrets.token_urlsafe(48)}, "invalid_grant"),
        ("missing verifier", {"code_verifier": None}, "invalid_grant"),
        ("short verifier", {"code_verifier": "abc"}, "invalid_grant"),
        ("verifier bad charset", {"code_verifier": "+/=" * 15}, "invalid_grant"),
        ("wrong redirect", {"redirect_uri": "http://127.0.0.1:33418/other"}, "invalid_grant"),
        ("missing redirect", {"redirect_uri": None}, "invalid_grant"),
        ("wrong resource", {"resource": "https://evil.example/mcp"}, "invalid_target"),
        ("another client", {"client_id": other}, "invalid_grant"),
        ("unknown client", {"client_id": "ylc_nope"}, "invalid_client"),
        ("missing client", {"client_id": None}, "invalid_request"),
        ("unknown code", {"code": "nope"}, "invalid_grant"),
        ("missing code", {"code": None}, "invalid_request"),
    ]


@pytest.mark.parametrize("name,over,error", misuse_cases(), ids=[c[0] for c in misuse_cases()])
def test_review_focus_3_a_misused_code_is_refused(api, auth, name, over, error):
    cid = client_id(api)
    verifier, challenge = pkce()
    code = get_code(api, auth, cid, challenge)
    over = {k: (client_id(api) if v is not None and not isinstance(v, str) else v) for k, v in over.items()}
    r = exchange(api, cid, code, verifier, **over)
    assert r.status_code in (400, 401) and r.json()["error"] == error and "access_token" not in r.json()
    if name not in ("unknown code", "missing code", "missing client", "unknown client"):
        # a code is good for one try: the right request after a wrong one is refused too
        assert exchange(api, cid, code, verifier).json()["error"] == "invalid_grant"
    assert api.get("/agent/tokens", headers=auth).json()["clients"] == []


def test_review_focus_3_an_expired_code_is_refused(api, auth, clock):
    cid = client_id(api)
    verifier, challenge = pkce()
    code = get_code(api, auth, cid, challenge)
    clock.t += oauth_server.CODE_SECONDS + 1
    r = exchange(api, cid, code, verifier)
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"
    assert oauth_server.CODE_SECONDS <= 600


def test_review_focus_3_a_reused_code_is_refused_and_revokes_what_it_bought(api, auth, world):
    cid = client_id(api)
    verifier, challenge = pkce()
    code = get_code(api, auth, cid, challenge)
    first = exchange(api, cid, code, verifier).json()
    assert works(api, first["access_token"])
    again = exchange(api, cid, code, verifier)
    assert again.status_code == 400 and again.json()["error"] == "invalid_grant"
    assert not works(api, first["access_token"])
    assert refresh(api, cid, first["refresh_token"]).json()["error"] == "invalid_grant"


def test_review_focus_3_a_code_reused_while_its_first_exchange_runs_revokes_that_grant(api, auth, world, monkeypatch):
    cid = client_id(api)
    verifier, challenge = pkce()
    code = get_code(api, auth, cid, challenge)
    server = api.app.state.oauth
    form = (f"grant_type=authorization_code&code={code}&code_verifier={verifier}&client_id={cid}"
            f"&redirect_uri={REDIRECT}").encode()
    original, second = oauth_server.OAuthServer._new_grant, []

    def racing(self, record, code_hash):
        made = original(self, record, code_hash)                     # the grant exists, not yet tied to the code
        try:
            self.token(form, "application/x-www-form-urlencoded", "")
        except oauth_server.OAuthError as e:
            second.append(e.code)
        return made
    monkeypatch.setattr(oauth_server.OAuthServer, "_new_grant", racing)
    with pytest.raises(oauth_server.OAuthError) as first:
        server.token(form, "application/x-www-form-urlencoded", "")
    assert first.value.code == "invalid_grant" and second == ["invalid_grant"]
    assert server.clients_of(ME) == []                                # what the code bought is gone


def test_spent_codes_do_not_count_toward_the_cap_of_waiting_ones(api, auth, monkeypatch):
    monkeypatch.setattr(oauth_server, "MAX_CODES", 2)
    for _ in range(3):
        connect(api, auth)                                            # each code issued, then spent
    cid = client_id(api)
    _, challenge = pkce()
    get_code(api, auth, cid, challenge)
    get_code(api, auth, cid, challenge)
    r = approve(api, auth, params(cid, challenge))                    # two waiting: the cap
    assert r.status_code == 400 and r.json()["code"] == "temporarily_unavailable"


def test_review_focus_3_the_code_belongs_to_the_account_that_approved(api, auth, b_auth, world):
    _, b_tokens = connect(api, b_auth)
    theirs = call(api, b_tokens["access_token"], "list_courses").structured_content["courses"]
    assert theirs and all(c["name"].startswith("B ") for c in theirs)
    assert api.get("/agent/tokens", headers=auth).json()["clients"] == []
    assert len(api.get("/agent/tokens", headers=b_auth).json()["clients"]) == 1


def test_refresh_after_the_hour_rotates_and_a_reused_refresh_token_revokes_the_grant(api, auth, world, clock):
    cid, first = connect(api, auth)
    clock.t += 3601
    assert not works(api, first["access_token"])                       # expired after an hour
    r = refresh(api, cid, first["refresh_token"])
    assert r.status_code == 200
    second = r.json()
    assert second["refresh_token"] != first["refresh_token"] and second["expires_in"] == 3600
    assert second["access_token"].startswith("yla_") and works(api, second["access_token"])
    clock.t += oauth_server.REFRESH_GRACE_SECONDS + 1
    reused = refresh(api, cid, first["refresh_token"])                 # the rotated-out one comes back
    assert reused.status_code == 400 and reused.json()["error"] == "invalid_grant"
    assert not works(api, second["access_token"])                      # the whole grant is gone
    assert refresh(api, cid, second["refresh_token"]).json()["error"] == "invalid_grant"
    assert api.get("/agent/tokens", headers=auth).json()["clients"] == []


def test_a_retried_refresh_within_the_grace_window_is_refused_without_revoking(api, auth, world, clock):
    cid, first = connect(api, auth)
    second = refresh(api, cid, first["refresh_token"]).json()
    clock.t += oauth_server.REFRESH_GRACE_SECONDS - 1
    retried = refresh(api, cid, first["refresh_token"])               # a retry of the same refresh
    assert retried.status_code == 400 and retried.json()["error"] == "invalid_grant"
    assert works(api, second["access_token"])                          # the grant lives on
    third = refresh(api, cid, second["refresh_token"]).json()
    older = refresh(api, cid, first["refresh_token"])                 # two rotations back: reuse, even now
    assert older.json()["error"] == "invalid_grant"
    assert not works(api, third["access_token"])
    assert api.get("/agent/tokens", headers=auth).json()["clients"] == []
    assert oauth_server.REFRESH_GRACE_SECONDS <= 60


def test_concurrent_refreshes_with_one_token_leave_one_winner_and_the_grant(api, auth, world):
    cid, first = connect(api, auth)
    server = api.app.state.oauth
    form = (f"grant_type=refresh_token&refresh_token={first['refresh_token']}&client_id={cid}").encode()
    start, results = threading.Barrier(4), []

    def go():
        start.wait(5)
        try:
            results.append(("ok", server.token(form, "application/x-www-form-urlencoded", "")))
        except oauth_server.OAuthError as e:
            results.append((e.code, None))
    threads = [threading.Thread(target=go) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert sorted(r[0] for r in results) == ["invalid_grant"] * 3 + ["ok"]
    winner = next(r[1] for r in results if r[0] == "ok")
    assert works(api, winner["access_token"])
    assert refresh(api, cid, winner["refresh_token"]).status_code == 200


@pytest.mark.parametrize("over,error", [({"client_id": "other"}, "invalid_grant"), ({"client_id": "ylc_nope"}, "invalid_client"),
                                        ({"resource": "https://evil.example/mcp"}, "invalid_target"),
                                        ({"refresh_token": "ylr_nope"}, "invalid_grant"), ({"refresh_token": None}, "invalid_request")])
def test_a_misused_refresh_token_is_refused_without_rotating(api, auth, over, error):
    cid, first = connect(api, auth)
    if over.get("client_id") == "other":
        over = {"client_id": client_id(api)}
    r = refresh(api, cid, first["refresh_token"], **over)
    assert r.status_code in (400, 401) and r.json()["error"] == error
    assert refresh(api, cid, first["refresh_token"]).status_code == 200          # still the current one


def test_a_refresh_token_lapses_after_30_days_unused(api, auth, clock):
    cid, first = connect(api, auth)
    clock.t += 15 * 86400
    get_code(api, auth, cid, pkce()[1])                    # the client stays registered: only the grant lapses
    clock.t += 15 * 86400 + 1
    assert refresh(api, cid, first["refresh_token"]).json()["error"] == "invalid_grant"
    assert api.get("/agent/tokens", headers=auth).json()["clients"] == []


@pytest.mark.parametrize("form,error", [({"grant_type": "password", "username": "a", "password": "b"}, "unsupported_grant_type"),
                                        ({"grant_type": "client_credentials"}, "unsupported_grant_type"),
                                        ({}, "invalid_request")])
def test_other_grants_are_unsupported(api, form, error):
    r = token(api, form)
    assert r.status_code == 400 and r.json()["error"] == error


def test_the_token_endpoint_takes_forms_only_and_each_parameter_once(api, auth):
    cid = client_id(api)
    verifier, challenge = pkce()
    code = get_code(api, auth, cid, challenge)
    form = {"grant_type": "authorization_code", "code": code, "code_verifier": verifier, "client_id": cid,
            "redirect_uri": REDIRECT, "resource": RESOURCE}
    r = api.post("/oauth/token", json=form)
    assert r.status_code == 400 and r.json()["error"] == "invalid_request"
    r = api.post("/oauth/token", content=f"grant_type=authorization_code&code={code}&code={code}", headers=FORM)
    assert r.status_code == 400 and r.json()["error"] == "invalid_request"


def test_the_client_id_may_come_as_http_basic(api, auth):
    cid = client_id(api)
    verifier, challenge = pkce()
    code = get_code(api, auth, cid, challenge)
    basic = "Basic " + base64.b64encode(f"{cid}:".encode()).decode()
    form = {"grant_type": "authorization_code", "code": code, "code_verifier": verifier, "redirect_uri": REDIRECT,
            "resource": RESOURCE}
    assert token(api, form, {"Authorization": basic}).status_code == 200
    bad = "Basic " + base64.b64encode(b"ylc_nope:").decode()
    r = token(api, {**form, "code": "x"}, {"Authorization": bad})
    assert r.status_code == 401 and r.json()["error"] == "invalid_client" and r.headers["www-authenticate"].startswith("Basic")


# ------------------------------------------------------------------ Review Focus 4: revocation
def test_review_focus_4_disconnecting_in_agent_access_stops_the_next_call(api, auth, world):
    cid, tokens = connect(api, auth)
    assert works(api, tokens["access_token"])
    listed = api.get("/agent/tokens", headers=auth).json()["clients"]
    assert len(listed) == 1
    assert api.delete(f"/agent/clients/{listed[0]['id']}", headers=auth).status_code == 204
    r = rpc(api, f"Bearer {tokens['access_token']}")
    assert r.status_code == 401 and 'error="invalid_token"' in r.headers["www-authenticate"]
    assert refresh(api, cid, tokens["refresh_token"]).json()["error"] == "invalid_grant"
    assert api.get("/agent/tokens", headers=auth).json()["clients"] == []
    assert api.delete(f"/agent/clients/{listed[0]['id']}", headers=auth).status_code == 404


def test_review_focus_4_disconnecting_mid_session_stops_the_next_call(api, auth, world):
    from mcp.shared.exceptions import MCPError
    _, tokens = connect(api, auth)
    app = api.app

    async def main():
        async with app.router.lifespan_context(app):
            async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app), base_url=PUBLIC,
                                          headers={"Authorization": f"Bearer {tokens['access_token']}"}) as http:
                async with Client(streamable_http_client(f"{PUBLIC}/mcp", http_client=http)) as client:
                    first = await client.call_tool("list_courses", {})
                    grant = app.state.oauth.clients_of(ME)[0]["id"]
                    assert app.state.oauth.disconnect(ME, grant)
                    with pytest.raises(MCPError):
                        await client.call_tool("list_courses", {})
                    return first
    assert anyio.run(main).is_error is False


def test_an_account_cannot_disconnect_anothers_agent(api, auth, b_auth, world):
    _, tokens = connect(api, auth)
    mine = api.get("/agent/tokens", headers=auth).json()["clients"][0]["id"]
    assert api.delete(f"/agent/clients/{mine}", headers=b_auth).status_code == 404
    assert works(api, tokens["access_token"])
    assert api.delete(f"/agent/clients/{mine}", headers={"Authorization": f"Bearer {tokens['access_token']}"}).status_code == 401


def test_the_revocation_endpoint(api, auth, world):
    cid, tokens = connect(api, auth)
    r = api.post("/oauth/revoke", data={"token": tokens["access_token"], "client_id": cid}, headers=FORM)
    assert r.status_code == 200
    assert not works(api, tokens["access_token"])
    second = refresh(api, cid, tokens["refresh_token"]).json()                 # the grant itself lives on
    assert works(api, second["access_token"])
    r = api.post("/oauth/revoke", data={"token": second["refresh_token"], "token_type_hint": "refresh_token",
                                         "client_id": cid}, headers=FORM)
    assert r.status_code == 200
    assert not works(api, second["access_token"])                               # a refresh token ends the grant
    assert api.post("/oauth/revoke", data={"token": "ylr_unknown"}, headers=FORM).status_code == 200
    assert api.post("/oauth/revoke", data={}, headers=FORM).json()["error"] == "invalid_request"


def test_revoking_needs_the_client_the_token_was_issued_to(api, auth, world):
    cid, tokens = connect(api, auth)
    r = api.post("/oauth/revoke", data={"token": tokens["refresh_token"], "client_id": client_id(api)}, headers=FORM)
    assert r.status_code in (400, 401) and r.json()["error"] == "invalid_client"
    assert works(api, tokens["access_token"])


# ------------------------------------------------------------------ Agent access
def test_agent_access_lists_connected_agents(api, auth, world, clock):
    connected_at = int(clock.t * 1000)
    _, tokens = connect(api, auth, client_name="Claude Desktop")
    listed = api.get("/agent/tokens", headers=auth).json()
    assert listed["personal"] == []
    assert listed["clients"] == [{"id": listed["clients"][0]["id"], "name": "Claude Desktop",
                                  "connectedAt": connected_at, "lastUsedAt": None}]
    clock.t += 120
    call(api, tokens["access_token"], "list_courses")
    assert api.get("/agent/tokens", headers=auth).json()["clients"][0]["lastUsedAt"] == int(clock.t * 1000)


def test_connecting_the_same_agent_again_replaces_its_grant(api, auth, world):
    cid, first = connect(api, auth)
    verifier, challenge = pkce()
    second = exchange(api, cid, get_code(api, auth, cid, challenge), verifier).json()
    assert len(api.get("/agent/tokens", headers=auth).json()["clients"]) == 1
    assert works(api, second["access_token"]) and not works(api, first["access_token"])


def test_at_most_twenty_connected_agents_per_account(api, auth, b_auth, monkeypatch):
    monkeypatch.setattr(oauth_server, "MAX_GRANTS", 2)
    connect(api, auth)
    connect(api, auth)
    cid = client_id(api)
    _, challenge = pkce()
    r = approve(api, auth, params(cid, challenge))
    assert r.status_code == 400 and r.json()["error"] == "You can connect up to 2 agents. Disconnect one in Agent access first."
    assert "redirect" not in r.json()
    connect(api, b_auth)                                                    # another account has its own
    assert oauth_server.MAX_GRANTS == 2 and oauth_server.MAX_GRANTS_DEFAULT == 20


def test_grants_are_stored_hashed_and_survive_a_restart(make, api, auth, world, state_dir):
    cid, tokens = connect(api, auth)
    path = state_dir / "users" / str(ME) / "agent-tokens.json"
    assert mode(path) == 0o600
    text = "\n".join(p.read_text() for p in state_dir.rglob("*.json"))
    for secret in (tokens["access_token"], tokens["refresh_token"], tokens["access_token"][4:]):
        assert secret not in text
    assert hashlib.sha256(tokens["access_token"].encode()).hexdigest() in path.read_text()
    assert mode(state_dir / "oauth-clients.json") == 0o600
    restarted = make()
    assert call(restarted, tokens["access_token"], "list_courses").is_error is False
    assert refresh(restarted, cid, tokens["refresh_token"]).status_code == 200


def test_a_personal_token_and_an_oauth_grant_live_side_by_side(api, auth, world):
    made = api.post("/agent/tokens", json={"name": "Laptop"}, headers=auth).json()
    _, tokens = connect(api, auth)
    assert api.delete(f"/agent/tokens/{made['id']}", headers=auth).status_code == 204
    assert works(api, tokens["access_token"]) and not works(api, made["token"])
    listed = api.get("/agent/tokens", headers=auth).json()
    assert listed["personal"] == [] and len(listed["clients"]) == 1


def test_an_oauth_token_opens_no_dashboard_route(api, auth, world):
    from test_service import ENDPOINTS
    _, tokens = connect(api, auth)
    before = len(world.calls)
    for method, path, body in ENDPOINTS:
        r = api.request(method, path, json=body, headers={"Authorization": f"Bearer {tokens['access_token']}"})
        assert r.status_code == 401, path
    assert len(world.calls) == before


# ------------------------------------------------------------------ idle sweep
def test_a_non_owner_with_an_oauth_grant_is_kept_and_idles_out_after_disconnecting(api, world, auth, b_auth, clock):
    service = api.app.state.service
    _, tokens = connect(api, b_auth)
    clock.t += IDLE_SECONDS + 61
    assert api.get("/courses", headers=auth).status_code == 200            # any request sweeps
    assert service.yungu.is_on(OTHER)
    grant = api.get("/agent/tokens", headers=b_auth).json()["clients"][0]["id"]
    assert api.delete(f"/agent/clients/{grant}", headers=b_auth).status_code == 204
    clock.t += IDLE_SECONDS + 61
    assert api.get("/courses", headers=auth).status_code == 200
    assert not service.yungu.is_on(OTHER)


# ------------------------------------------------------------------ logs
def test_no_token_code_or_verifier_reaches_a_log(api, auth, world, caplog, clock):
    caplog.set_level(logging.DEBUG)
    cid = client_id(api)
    verifier, challenge = pkce()
    code = get_code(api, auth, cid, challenge)
    first = exchange(api, cid, code, verifier).json()
    exchange(api, cid, code, verifier)                                         # a reused code: logged
    cid2, tokens = connect(api, auth)
    call(api, tokens["access_token"], "list_courses")
    clock.t += 3601
    second = refresh(api, cid2, tokens["refresh_token"]).json()
    clock.t += oauth_server.REFRESH_GRACE_SECONDS + 1
    refresh(api, cid2, tokens["refresh_token"])                               # a reused refresh token: logged
    text = "\n".join(f"{r.name} {r.getMessage()}" for r in caplog.records
                     if not r.name.startswith(("mcp.client", "httpx2")))
    for secret in (code, verifier, challenge, first["access_token"], first["refresh_token"], tokens["access_token"],
                   tokens["refresh_token"], second["access_token"], second["refresh_token"], f"={ME}", f" {ME} "):
        assert secret not in text
    assert "yungu_lms.oauth" in text and text.count("reused") >= 2


# ------------------------------------------------------------------ the official SDK client, end to end
class MemoryStorage:
    def __init__(self):
        self.tokens, self.client = None, None

    async def get_tokens(self):
        return self.tokens

    async def set_tokens(self, tokens):
        self.tokens = tokens

    async def get_client_info(self):
        return self.client

    async def set_client_info(self, client_info):
        self.client = client_info


def test_the_sdk_client_discovers_registers_authorizes_calls_and_refreshes(api, auth, world, clock):
    app = api.app
    seen = {}

    async def main():
        async with app.router.lifespan_context(app):
            transport = httpx2.ASGITransport(app=app)
            async with httpx2.AsyncClient(transport=transport, base_url=PUBLIC) as browser:
                async def redirect_handler(url):
                    assert url.startswith(f"{PUBLIC}/oauth/authorize?")
                    q = query(url)
                    seen["authorize"] = q
                    r = await browser.post("/oauth/authorize/request", json=q, headers=auth)
                    assert r.status_code == 200, r.text
                    seen["client"] = r.json()["client"]
                    r = await browser.post("/oauth/authorize/approve", json={**q, "decision": "allow"}, headers=auth)
                    seen["redirect"] = r.json()["redirect"]

                async def callback_handler():
                    q = query(seen["redirect"])
                    return AuthorizationCodeResult(code=q["code"], state=q.get("state"), iss=q.get("iss"))

                provider = OAuthClientProvider(
                    server_url=f"{PUBLIC}/mcp",
                    client_metadata=OAuthClientMetadata(client_name="SDK agent", redirect_uris=[REDIRECT],
                                                        grant_types=["authorization_code", "refresh_token"],
                                                        response_types=["code"], token_endpoint_auth_method="none"),
                    storage=MemoryStorage(), redirect_handler=redirect_handler, callback_handler=callback_handler)
                async with httpx2.AsyncClient(transport=transport, base_url=PUBLIC, auth=provider) as http:
                    async with Client(streamable_http_client(f"{PUBLIC}/mcp", http_client=http)) as client:
                        tools = (await client.list_tools()).tools
                        first = await client.call_tool("list_todo", {})
                        before = provider.context.current_tokens
                        clock.t += 3601                                 # the server's hour is up
                        provider.context.token_expiry_time = 1          # and the client knows it
                        second = await client.call_tool("list_courses", {})
                        after = provider.context.current_tokens
                        return tools, first, second, before, after
    tools, first, second, before, after = anyio.run(main)
    assert len(tools) == 7 and first.is_error is False and second.is_error is False
    assert seen["client"] == {"name": "SDK agent", "redirectHost": "127.0.0.1"}
    assert seen["authorize"]["resource"] == RESOURCE and seen["authorize"]["scope"] == "read"
    assert seen["authorize"]["code_challenge_method"] == "S256"
    assert before.refresh_token != after.refresh_token and before.access_token != after.access_token
    assert len(api.get("/agent/tokens", headers=auth).json()["clients"]) == 1
