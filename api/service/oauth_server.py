"""OAuth 2.1 for agents: the authorization server behind /mcp (MCP authorization spec 2026-07-28).

Discovery: `GET /.well-known/oauth-protected-resource` (RFC 9728; also at the path-inserted
`…/oauth-protected-resource/mcp`) names the resource `https://yungu.chihairou.dev/mcp` and this server as its
authorization server; `GET /.well-known/oauth-authorization-server` (RFC 8414) lists the endpoints. The
authorization endpoint is the dashboard's page `/oauth/authorize` (Next.js): it signs the person in, then asks
this service through the dashboard-only consent API (`POST /oauth/authorize/request`, `/approve`).

- Clients: public only, by dynamic registration (RFC 7591, `POST /oauth/register`): no client secrets; redirect
  URIs https or loopback http (any port at the authorization request, RFC 8252 §7.3), else exact. At most
  MAX_CLIENTS overall; REGISTRATIONS_PER_ADDRESS per address per window; a client unused for CLIENT_IDLE_SECONDS
  goes; at the cap, one never approved for an hour makes room. Stored (no secrets in them) in the top state
  dir's oauth-clients.json (0600).
- Codes: authorization code + PKCE S256 only; bound to client, redirect URI, challenge, account, resource and
  scope; single use (any presentation spends it; a second one revokes what the first bought), CODE_SECONDS.
  Kept in memory only: a restart just means connecting again.
- Grants: one per account and client (connecting the same client again replaces it), at most MAX_GRANTS per
  account, in users/<userId>/agent-tokens.json beside the personal tokens (agent_tokens.py), hashed. Access
  tokens (`yla_…`) last ACCESS_SECONDS and are bound to the resource; refresh tokens (`ylr_…`) rotate on every
  use and lapse REFRESH_SECONDS after their issue; a rotated-out refresh token presented again revokes the
  grant (OAuth 2.1 §4.3.1).
- Access tokens resolve through `AgentAuth` (`OAuthAccessTokenVerifier`): expiry, resource and revocation are
  checked on every /mcp request.

Never logged: tokens, codes, verifiers, challenges, state; log lines carry the hashed account only.
"""
import base64
import hashlib
import json
import logging
import re
import secrets
import threading
import time
import unicodedata
from collections import deque
from typing import Callable, Deque, Dict, List, Optional, Tuple
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit

from .agent_tokens import AccountRef, AgentFiles, live_grants, read_account, token_hash, update_account
from .mcp_server import RESOURCE, SCOPE, account_hash
from .mcp_tools import PUBLIC_URL
from .state import StateDir

log = logging.getLogger("yungu_lms.oauth")

ISSUER = PUBLIC_URL
ACCESS_PREFIX, REFRESH_PREFIX, CLIENT_PREFIX = "yla_", "ylr_", "ylc_"
ACCESS_SECONDS = 3600
REFRESH_SECONDS = 30 * 86400
CODE_SECONDS = 300                       # ≤ 10 min (OAuth 2.1 §4.1.2)
CLIENT_IDLE_SECONDS = 30 * 86400
NEVER_USED_GRACE_SECONDS = 3600          # at the cap, a client never approved for this long makes room
MAX_CLIENTS = 500
MAX_GRANTS_DEFAULT = 20
MAX_GRANTS = MAX_GRANTS_DEFAULT
MAX_CLIENT_NAME = 64
MAX_REDIRECT_URIS = 10
MAX_URI_CHARS = 2000
MAX_BODY_BYTES = 16 * 1024
MAX_TOKEN_CHARS = 512
MAX_CODES, MAX_CODES_PER_ACCOUNT = 1000, 20
REGISTRATIONS_PER_ADDRESS, REGISTRATION_WINDOW_SECONDS = 20, 600.0
USED_REFRESH_KEPT = 50                   # rotated-out refresh hashes kept per grant, for reuse detection
ACCESS_KEPT = 3                          # live access tokens per grant (older ones go at a refresh)
UNNAMED = "Unnamed agent"
GRANT_TYPES = ["authorization_code", "refresh_token"]
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}
BASIC_CHALLENGE = {"WWW-Authenticate": 'Basic realm="yungu-lms"'}     # RFC 6749 §5.2: a 401 names the scheme

_CHALLENGE = re.compile(r"[A-Za-z0-9_-]{43}")               # base64url(sha256), no padding
_VERIFIER = re.compile(r"[A-Za-z0-9._~-]{43,128}")          # RFC 7636 §4.1
_SCOPE = re.compile(r"[\x21\x23-\x5b\x5d-\x7e]+( [\x21\x23-\x5b\x5d-\x7e]+)*")     # RFC 6749 §3.3

# The person's words (consent page error card); OAuth codes travel beside them.
UNKNOWN_CLIENT = "This agent isn't registered here, or its registration expired. Start connecting again from the agent."
WRONG_REDIRECT = "This agent's return address doesn't match its registration. Start connecting again from the agent."
BAD_RESPONSE_TYPE = "This agent asked for a kind of sign-in this service doesn't offer."
NO_PKCE = "This agent's request is missing its security check (PKCE with S256)."
BAD_RESOURCE = "This agent asked for access to something other than this service's agent endpoint."
BAD_SCOPE = "This agent's request isn't valid."
BUSY = "Too many sign-ins waiting right now. Try again in a few minutes."


def too_many_agents() -> str:
    return f"You can connect up to {MAX_GRANTS} agents. Disconnect one in Agent access first."


def protected_resource_metadata() -> dict:
    return {"resource": RESOURCE, "authorization_servers": [ISSUER], "scopes_supported": [SCOPE],
            "bearer_methods_supported": ["header"], "resource_name": "Yungu LMS (read-only)"}


def authorization_server_metadata() -> dict:
    return {
        "issuer": ISSUER,
        "authorization_endpoint": f"{PUBLIC_URL}/oauth/authorize",
        "token_endpoint": f"{PUBLIC_URL}/oauth/token",
        "registration_endpoint": f"{PUBLIC_URL}/oauth/register",
        "revocation_endpoint": f"{PUBLIC_URL}/oauth/revoke",
        "scopes_supported": [SCOPE],
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": list(GRANT_TYPES),
        "token_endpoint_auth_methods_supported": ["none"],
        "revocation_endpoint_auth_methods_supported": ["none"],
        "code_challenge_methods_supported": ["S256"],
        "authorization_response_iss_parameter_supported": True,
    }


# ------------------------------------------------------------------ errors
class OAuthError(Exception):
    """An error answer of the registration, token or revocation endpoint: {error, error_description}."""

    def __init__(self, code: str, description: str, status: int = 400, headers: Optional[dict] = None):
        super().__init__(code)
        self.code, self.description, self.status, self.headers = code, description, status, headers or {}

    def body(self) -> dict:
        return {"error": self.code, "error_description": self.description}


class AuthorizeRefused(Exception):
    """A request the consent page must not go ahead with. `redirect`: where to send the person back to the
    client with the error, or None when the client or its return address cannot be trusted (RFC 6749
    §4.1.2.1: never redirect then)."""

    def __init__(self, message: str, code: str, redirect: Optional[str] = None):
        super().__init__(code)
        self.message, self.code, self.redirect = message, code, redirect

    def body(self) -> dict:
        body = {"error": self.message, "code": self.code}
        if self.redirect is not None:
            body["redirect"] = self.redirect
        return body


# ------------------------------------------------------------------ URIs
def redirect_uri_ok(uri) -> bool:
    """https with a host, or http to a loopback host; no fragment, no user info, no whitespace or controls."""
    if not isinstance(uri, str) or not uri or len(uri) > MAX_URI_CHARS:
        return False
    if any(c.isspace() or unicodedata.category(c) == "Cc" for c in uri) or "#" in uri:
        return False
    try:
        parts = urlsplit(uri)
        host = parts.hostname
        parts.port                                  # a bad port raises
    except ValueError:
        return False
    if not host or "@" in parts.netloc:
        return False
    if parts.scheme == "https":
        return True
    return parts.scheme == "http" and host in LOOPBACK_HOSTS


def _without_port(uri: str) -> Optional[tuple]:
    parts = urlsplit(uri)
    if parts.scheme != "http" or parts.hostname not in LOOPBACK_HOSTS:
        return None
    return parts.scheme, parts.hostname, parts.path, parts.query


def redirect_matches(registered: List[str], uri: str) -> bool:
    """Exact (simple string comparison), except that a loopback http URI may use any port (RFC 8252 §7.3)."""
    if not isinstance(uri, str) or not uri:
        return False
    if uri in registered:
        return True
    if not redirect_uri_ok(uri):
        return False
    loose = _without_port(uri)
    return loose is not None and any(_without_port(r) == loose for r in registered if redirect_uri_ok(r))


def resource_ok(value: str) -> bool:
    """Our canonical resource URI; scheme and host compared case-insensitively (MCP spec SHOULD)."""
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        return False
    return (parts.scheme.lower() == "https" and (parts.hostname or "") == urlsplit(RESOURCE).hostname
            and port is None and parts.path == "/mcp" and not parts.query and not parts.fragment
            and "@" not in parts.netloc and "#" not in value)


def with_query(uri: str, params: List[Tuple[str, str]]) -> str:
    """`uri` (never with a fragment: see redirect_uri_ok) with `params` added to its query; the registered
    query is kept (RFC 6749 §3.1.2)."""
    extra = urlencode(params, quote_via=quote)
    if "?" not in uri:
        return f"{uri}?{extra}"
    return uri + ("" if uri.endswith(("?", "&")) else "&") + extra


def s256(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def _now_ms(now: Callable[[], float]) -> int:
    return int(now() * 1000)


# ------------------------------------------------------------------ clients
class OAuthClients:
    """Registered clients, oauth-clients.json in the top state dir:
    {"clients": [{id, name, redirectUris, createdAt, lastActiveAt, used}]} (epoch ms)."""
    FILE = "oauth-clients.json"

    def __init__(self, state: StateDir, now: Callable[[], float]):
        self._state, self._now = state, now
        self._lock = threading.Lock()
        self._recent: Dict[str, Deque[float]] = {}        # address -> registration times (seconds)

    def _rows(self) -> List[dict]:
        data = self._state.read(self.FILE)
        rows = data.get("clients") if isinstance(data, dict) else None
        return [r for r in rows or [] if isinstance(r, dict) and isinstance(r.get("id"), str)
                and isinstance(r.get("redirectUris"), list) and isinstance(r.get("lastActiveAt"), int)]

    def _live(self, rows: List[dict], now_ms: int) -> List[dict]:
        return [r for r in rows if now_ms - r["lastActiveAt"] < CLIENT_IDLE_SECONDS * 1000]

    def _throttled(self, address: str, now: float) -> bool:
        if len(self._recent) > 10000:
            self._recent = {a: q for a, q in self._recent.items() if q and now - q[-1] < REGISTRATION_WINDOW_SECONDS}
        times = self._recent.setdefault(address, deque())
        while times and now - times[0] >= REGISTRATION_WINDOW_SECONDS:
            times.popleft()
        if len(times) >= REGISTRATIONS_PER_ADDRESS:
            return True
        times.append(now)
        return False

    def register(self, name: str, redirect_uris: List[str], address: str) -> dict:
        now = self._now()
        now_ms = int(now * 1000)
        with self._lock:
            if self._throttled(address or "-", now):
                raise OAuthError("temporarily_unavailable",
                                 "Too many registrations from this address. Try again later.", status=429)
            rows = self._live(self._rows(), now_ms)
            if len(rows) >= MAX_CLIENTS:
                idle = sorted((r for r in rows if not r.get("used")
                               and now_ms - (r.get("createdAt") or 0) >= NEVER_USED_GRACE_SECONDS * 1000),
                              key=lambda r: r.get("createdAt") or 0)
                if not idle:
                    raise OAuthError("temporarily_unavailable", "Too many registered agents. Try again later.",
                                     status=503)
                gone = {r["id"] for r in idle[:len(rows) - MAX_CLIENTS + 1]}
                rows = [r for r in rows if r["id"] not in gone]
            row = {"id": CLIENT_PREFIX + secrets.token_urlsafe(18), "name": name, "redirectUris": list(redirect_uris),
                   "createdAt": now_ms, "lastActiveAt": now_ms, "used": False}
            self._state.write(self.FILE, {"clients": rows + [row]})
        log.info("registered an agent client (%d registered)", len(rows) + 1)
        return row

    def get(self, client_id: str) -> Optional[dict]:
        if not isinstance(client_id, str) or not client_id.startswith(CLIENT_PREFIX) or len(client_id) > 64:
            return None
        now_ms = _now_ms(self._now)
        return next((r for r in self._live(self._rows(), now_ms) if r["id"] == client_id), None)

    def touch(self, client_id: str) -> None:
        """A use: approval, token exchange or refresh. Keeps the client from expiring."""
        now_ms = _now_ms(self._now)
        with self._lock:
            rows = self._live(self._rows(), now_ms)
            row = next((r for r in rows if r["id"] == client_id), None)
            if row is None or (row.get("used") and now_ms - row["lastActiveAt"] < 60_000):
                return
            row["lastActiveAt"], row["used"] = now_ms, True
            self._state.write(self.FILE, {"clients": rows})


# ------------------------------------------------------------------ codes
class Codes:
    """Authorization codes, in memory, by hash. A redeemed code stays (spent) until it expires, so a second
    presentation is recognised and what the first bought is revoked."""

    def __init__(self, now: Callable[[], float]):
        self._now = now
        self._lock = threading.Lock()
        self._codes: Dict[str, dict] = {}

    def issue(self, record: dict) -> str:
        now = self._now()
        with self._lock:
            self._codes = {h: c for h, c in self._codes.items() if c["expiresAt"] > now}
            waiting = [c for c in self._codes.values() if not c["spent"]]
            mine = sum(c["userId"] == record["userId"] for c in waiting)
            if len(self._codes) >= MAX_CODES or mine >= MAX_CODES_PER_ACCOUNT:
                raise AuthorizeRefused(BUSY, "temporarily_unavailable")
            code = secrets.token_urlsafe(32)
            self._codes[token_hash(code)] = {**record, "expiresAt": now + CODE_SECONDS, "spent": False, "grantId": None}
        return code

    def spend(self, code: str) -> Tuple[Optional[dict], bool]:
        """(the code's record or None, whether it was already spent). Spends it."""
        with self._lock:
            record = self._codes.get(token_hash(code))
            if record is None:
                return None, False
            was = record["spent"]
            record["spent"] = True
            return record, was

    def bought(self, code: str, grant_id: str) -> None:
        with self._lock:
            record = self._codes.get(token_hash(code))
            if record is not None:
                record["grantId"] = grant_id


# ------------------------------------------------------------------ the server
def _form(body: bytes) -> Dict[str, str]:
    try:
        pairs = parse_qsl(body.decode("utf-8"), keep_blank_values=True, strict_parsing=False, max_num_fields=50)
    except (UnicodeDecodeError, ValueError):
        raise OAuthError("invalid_request", "The request body is not a valid form.") from None
    form: Dict[str, str] = {}
    for key, value in pairs:
        if key in form:
            raise OAuthError("invalid_request", f"{key} was sent more than once.")
        form[key] = value
    return {k: v for k, v in form.items() if v != ""}          # an empty parameter is an omitted one


def _basic_client(authorization: str) -> Optional[str]:
    scheme, _, value = (authorization or "").strip().partition(" ")
    if scheme.lower() != "basic":
        return None
    try:
        user = base64.b64decode(value.strip(), validate=True).decode("utf-8").partition(":")[0]
    except (ValueError, UnicodeDecodeError):
        raise OAuthError("invalid_client", "Unreadable client credentials.", 401, BASIC_CHALLENGE) from None
    return unquote(user)


class OAuthServer:
    def __init__(self, state_dir, now: Callable[[], float] = time.time, files: Optional[AgentFiles] = None):
        self._state = state_dir if isinstance(state_dir, StateDir) else StateDir(state_dir)
        self._now = now
        self._files = files or AgentFiles(self._state)
        self.clients = OAuthClients(self._state, now)
        self._codes = Codes(now)
        self.verifier = OAuthAccessTokenVerifier(self._files, self._state, now)

    # -------------------------------------------------------------- registration (RFC 7591)
    def register(self, raw: bytes, address: str) -> dict:
        if len(raw) > MAX_BODY_BYTES:
            raise OAuthError("invalid_client_metadata", "The registration is too large.")
        try:
            meta = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            meta = None
        if not isinstance(meta, dict):
            raise OAuthError("invalid_client_metadata", "Send the client metadata as a JSON object.")
        uris = meta.get("redirect_uris")
        if not isinstance(uris, list) or not uris or len(uris) > MAX_REDIRECT_URIS:
            raise OAuthError("invalid_redirect_uri", f"Give 1 to {MAX_REDIRECT_URIS} redirect_uris.")
        for uri in uris:
            if not redirect_uri_ok(uri):
                raise OAuthError("invalid_redirect_uri", "Each redirect URI must use https, or http to a loopback "
                                                         "address (127.0.0.1, [::1] or localhost), without a fragment.")
        name = meta.get("client_name")
        if name is not None and not isinstance(name, str):
            raise OAuthError("invalid_client_metadata", "client_name must be a string.")
        name = " ".join("".join(" " if unicodedata.category(c)[0] == "C" else c for c in name or "").split())
        if len(name) > MAX_CLIENT_NAME:
            raise OAuthError("invalid_client_metadata", f"client_name must be at most {MAX_CLIENT_NAME} characters.")
        grant_types = meta.get("grant_types", GRANT_TYPES)
        if not isinstance(grant_types, list) or not set(grant_types) <= set(GRANT_TYPES) \
                or "authorization_code" not in grant_types:
            raise OAuthError("invalid_client_metadata",
                             "Only the authorization_code and refresh_token grants are offered.")
        response_types = meta.get("response_types", ["code"])
        if not isinstance(response_types, list) or set(response_types) != {"code"}:
            raise OAuthError("invalid_client_metadata", "Only the code response type is offered.")
        # A public client whatever it asked for (RFC 7591 §3.2.1 lets the server substitute metadata): no secret.
        row = self.clients.register(name or UNNAMED, uris, address)
        return {"client_id": row["id"], "client_id_issued_at": row["createdAt"] // 1000, "client_name": row["name"],
                "redirect_uris": row["redirectUris"], "grant_types": list(GRANT_TYPES), "response_types": ["code"],
                "token_endpoint_auth_method": "none", "scope": SCOPE}

    # -------------------------------------------------------------- the consent API
    def _checked(self, p: dict) -> Tuple[dict, str, Optional[str]]:
        """(client, redirect URI, state) of a valid authorization request, else AuthorizeRefused."""
        client = self.clients.get(p.get("client_id") or "")
        if client is None:
            raise AuthorizeRefused(UNKNOWN_CLIENT, "invalid_client")
        uri = p.get("redirect_uri") or ""
        if not redirect_matches(client["redirectUris"], uri):
            raise AuthorizeRefused(WRONG_REDIRECT, "invalid_request")
        state = p.get("state") or None

        def refuse(message: str, code: str):
            raise AuthorizeRefused(message, code, self._back(uri, [("error", code)], state))
        if (p.get("response_type") or "code") != "code":
            refuse(BAD_RESPONSE_TYPE, "unsupported_response_type")
        if p.get("code_challenge_method") != "S256" or not _CHALLENGE.fullmatch(p.get("code_challenge") or ""):
            refuse(NO_PKCE, "invalid_request")
        scope = p.get("scope") or ""
        if scope and not _SCOPE.fullmatch(scope):
            refuse(BAD_SCOPE, "invalid_scope")
        resource = p.get("resource") or ""
        if resource and not resource_ok(resource):
            refuse(BAD_RESOURCE, "invalid_target")
        return client, uri, state

    def _back(self, uri: str, params: List[Tuple[str, str]], state: Optional[str]) -> str:
        return with_query(uri, params + ([("state", state)] if state else []) + [("iss", ISSUER)])

    def check(self, p: dict) -> dict:
        client, uri, _ = self._checked(p)
        return {"valid": True,
                "client": {"name": client.get("name") or UNNAMED, "redirectHost": urlsplit(uri).hostname}}

    def approve(self, p: dict, user_id: int, decision: str) -> str:
        if decision not in ("allow", "deny"):
            raise AuthorizeRefused("Choose Allow or Deny.", "invalid_request")
        client, uri, state = self._checked(p)
        if decision == "deny":
            return self._back(uri, [("error", "access_denied")], state)
        others = [g for g in live_grants(read_account(self._state, user_id), _now_ms(self._now))
                  if g["clientId"] != client["id"]]
        if len(others) >= MAX_GRANTS:
            raise AuthorizeRefused(too_many_agents(), "access_denied")
        code = self._codes.issue({"clientId": client["id"], "clientName": client.get("name") or UNNAMED,
                                  "redirectUri": uri, "challenge": p["code_challenge"], "userId": int(user_id),
                                  "resource": RESOURCE, "scope": SCOPE})
        self.clients.touch(client["id"])
        return self._back(uri, [("code", code)], state)

    # -------------------------------------------------------------- the token endpoint
    def token(self, raw: bytes, content_type: str, authorization: str) -> dict:
        if len(raw) > MAX_BODY_BYTES:
            raise OAuthError("invalid_request", "The request is too large.")
        if content_type.split(";")[0].strip().lower() != "application/x-www-form-urlencoded":
            raise OAuthError("invalid_request", "Send the request as application/x-www-form-urlencoded.")
        form = _form(raw)
        from_basic = _basic_client(authorization)
        if from_basic is not None and form.get("client_id") not in (None, from_basic):
            raise OAuthError("invalid_request", "Two different client ids.")
        cid = form.get("client_id") or from_basic
        grant_type = form.get("grant_type")
        if grant_type not in GRANT_TYPES:
            if grant_type is None:
                raise OAuthError("invalid_request", "grant_type is missing.")
            raise OAuthError("unsupported_grant_type", "Only authorization_code and refresh_token are offered.")
        if not cid:
            raise OAuthError("invalid_request", "client_id is missing.")
        if self.clients.get(cid) is None:
            if from_basic is not None:
                raise OAuthError("invalid_client", "Unknown client.", 401, BASIC_CHALLENGE)
            raise OAuthError("invalid_client", "Unknown client.")
        if grant_type == "authorization_code":
            return self._exchange(form, cid)
        return self._refresh(form, cid)

    def _resource_of(self, form: dict) -> None:
        resource = form.get("resource")
        if resource is not None and not resource_ok(resource):
            raise OAuthError("invalid_target", "The resource must be this service's agent endpoint.")

    def _exchange(self, form: dict, cid: str) -> dict:
        code = form.get("code")
        if not code:
            raise OAuthError("invalid_request", "code is missing.")
        if len(code) > MAX_TOKEN_CHARS:
            raise OAuthError("invalid_grant", "Unknown or expired code.")
        record, was_spent = self._codes.spend(code)
        if record is None:
            raise OAuthError("invalid_grant", "Unknown or expired code.")
        if was_spent:
            if record.get("grantId"):
                self._drop_grant(record["userId"], record["grantId"])
                log.warning("oauth: an authorization code was reused; its grant is revoked (account=%s)",
                            account_hash(record["userId"]))
            raise OAuthError("invalid_grant", "This code was already used.")
        if record["expiresAt"] <= self._now():
            raise OAuthError("invalid_grant", "Unknown or expired code.")
        if not secrets.compare_digest(record["clientId"], cid):
            raise OAuthError("invalid_grant", "This code was issued to another client.")
        if form.get("redirect_uri") != record["redirectUri"]:
            raise OAuthError("invalid_grant", "redirect_uri does not match the authorization request.")
        verifier = form.get("code_verifier") or ""
        if not _VERIFIER.fullmatch(verifier) or not secrets.compare_digest(s256(verifier), record["challenge"]):
            raise OAuthError("invalid_grant", "The PKCE code_verifier does not match.")
        self._resource_of(form)
        grant_id, tokens = self._new_grant(record, token_hash(code))
        self._codes.bought(code, grant_id)
        self.clients.touch(cid)
        log.info("oauth: an agent connected (account=%s)", account_hash(record["userId"]))
        return tokens

    def _tokens(self) -> Tuple[str, str, dict]:
        access, refresh = ACCESS_PREFIX + secrets.token_urlsafe(32), REFRESH_PREFIX + secrets.token_urlsafe(32)
        return access, refresh, {"access_token": access, "token_type": "Bearer", "expires_in": ACCESS_SECONDS,
                                 "refresh_token": refresh, "scope": SCOPE}

    def _new_grant(self, record: dict, code_hash: str) -> Tuple[str, dict]:
        now_ms = _now_ms(self._now)
        access, refresh, answer = self._tokens()
        grant = {"id": secrets.token_hex(8), "clientId": record["clientId"], "clientName": record["clientName"],
                 "resource": record["resource"], "scope": record["scope"], "createdAt": now_ms, "lastUsedAt": None,
                 "refreshHash": token_hash(refresh), "refreshExpiresAt": now_ms + REFRESH_SECONDS * 1000,
                 "usedRefresh": [],
                 "access": [{"hash": token_hash(access), "expiresAt": now_ms + ACCESS_SECONDS * 1000}],
                 "codeHash": code_hash}

        def change(data):
            kept = [g for g in live_grants(data, now_ms) if g["clientId"] != record["clientId"]]   # replaces its own
            if len(kept) >= MAX_GRANTS:
                return False, None
            return True, {**data, "oauth": kept + [grant]}
        if not update_account(self._state, record["userId"], change):
            raise OAuthError("invalid_grant", too_many_agents())
        return grant["id"], answer

    def _refresh(self, form: dict, cid: str) -> dict:
        presented = form.get("refresh_token")
        if not presented:
            raise OAuthError("invalid_request", "refresh_token is missing.")
        if not presented.startswith(REFRESH_PREFIX) or len(presented) > MAX_TOKEN_CHARS:
            raise OAuthError("invalid_grant", "Unknown or expired refresh token.")
        digest = token_hash(presented)
        hit = self._files.lookup(digest)
        if hit is None or hit.kind not in ("refresh", "used_refresh"):
            raise OAuthError("invalid_grant", "Unknown or expired refresh token.")
        if hit.kind == "used_refresh":
            self._reused(hit.user_id, hit.id)
        self._resource_of(form)
        now_ms = _now_ms(self._now)
        access, refresh, answer = self._tokens()

        def change(data):
            live = live_grants(data, now_ms)                  # the same row objects as in `data`
            grant = next((g for g in live if g["id"] == hit.id), None)
            if grant is None:
                return "gone", None
            if not secrets.compare_digest(grant["refreshHash"], digest):
                if digest in (grant.get("usedRefresh") or []):
                    return "reused", {**data, "oauth": [g for g in live if g["id"] != hit.id]}
                return "gone", None
            if not secrets.compare_digest(grant["clientId"], cid):
                return "client", None
            grant["usedRefresh"] = ((grant.get("usedRefresh") or []) + [digest])[-USED_REFRESH_KEPT:]
            grant["refreshHash"] = token_hash(refresh)
            grant["refreshExpiresAt"] = now_ms + REFRESH_SECONDS * 1000
            fresh = [a for a in grant.get("access") or [] if isinstance(a, dict)
                     and isinstance(a.get("expiresAt"), int) and a["expiresAt"] > now_ms]
            new = {"hash": token_hash(access), "expiresAt": now_ms + ACCESS_SECONDS * 1000}
            grant["access"] = (fresh + [new])[-ACCESS_KEPT:]
            return "ok", {**data, "oauth": live}             # lapsed grants go on the way
        outcome = update_account(self._state, hit.user_id, change)
        if outcome == "reused":
            log.warning("oauth: a rotated-out refresh token was reused; its grant is revoked (account=%s)",
                        account_hash(hit.user_id))
        if outcome != "ok":
            raise OAuthError("invalid_grant", "Unknown or expired refresh token.")
        self.clients.touch(cid)
        return answer

    def _reused(self, user_id: int, grant_id: str):
        self._drop_grant(user_id, grant_id)
        log.warning("oauth: a rotated-out refresh token was reused; its grant is revoked (account=%s)",
                    account_hash(user_id))
        raise OAuthError("invalid_grant", "Unknown or expired refresh token.")

    def _drop_grant(self, user_id: int, grant_id: str) -> bool:
        def change(data):
            rows = data.get("oauth") if isinstance(data.get("oauth"), list) else []
            kept = [g for g in rows if not (isinstance(g, dict) and g.get("id") == grant_id)]
            return len(kept) != len(rows), ({**data, "oauth": kept} if len(kept) != len(rows) else None)
        return update_account(self._state, user_id, change)

    # -------------------------------------------------------------- revocation (RFC 7009)
    def revoke(self, raw: bytes, content_type: str, authorization: str) -> None:
        if len(raw) > MAX_BODY_BYTES:
            raise OAuthError("invalid_request", "The request is too large.")
        if content_type.split(";")[0].strip().lower() != "application/x-www-form-urlencoded":
            raise OAuthError("invalid_request", "Send the request as application/x-www-form-urlencoded.")
        form = _form(raw)
        presented = form.get("token")
        if not presented:
            raise OAuthError("invalid_request", "token is missing.")
        cid = form.get("client_id") or _basic_client(authorization)
        if len(presented) > MAX_TOKEN_CHARS:
            return
        hit = self._files.lookup(token_hash(presented))
        if hit is None or hit.kind == "personal":
            return                                            # unknown (or not ours to revoke here): 200 all the same
        grant = next((g for g in live_grants(read_account(self._state, hit.user_id), _now_ms(self._now))
                      if g["id"] == hit.id), None)
        if grant is None:
            return
        if cid is not None and not secrets.compare_digest(grant["clientId"], cid):
            raise OAuthError("invalid_client", "This token was issued to another client.")
        if hit.kind != "access":
            self._drop_grant(hit.user_id, hit.id)
            return
        digest = token_hash(presented)

        def change(data):
            rows = data.get("oauth") if isinstance(data.get("oauth"), list) else []
            for g in rows:
                if isinstance(g, dict) and g.get("id") == hit.id:
                    g["access"] = [a for a in g.get("access") or []
                                   if not (isinstance(a, dict) and a.get("hash") == digest)]
            return None, {**data, "oauth": rows}
        update_account(self._state, hit.user_id, change)

    # -------------------------------------------------------------- Agent access
    def clients_of(self, user_id: int) -> List[dict]:
        rows = live_grants(read_account(self._state, user_id), _now_ms(self._now))
        return [{"id": g["id"], "name": g.get("clientName") or UNNAMED, "connectedAt": g.get("createdAt"),
                 "lastUsedAt": g.get("lastUsedAt")} for g in sorted(rows, key=lambda g: g.get("createdAt") or 0)]

    def disconnect(self, user_id: int, grant_id: str) -> bool:
        if not any(c["id"] == grant_id for c in self.clients_of(user_id)):
            return False
        return self._drop_grant(user_id, grant_id)


class OAuthAccessTokenVerifier:
    """An OAuth access token's account (for AgentAuth): known, not expired, bound to /mcp, its grant not
    revoked; noting the use (lastUsedAt, at most once a minute) is best effort."""

    def __init__(self, files: AgentFiles, state: StateDir, now: Callable[[], float]):
        self._files, self._state, self._now = files, state, now

    def verify(self, token: str) -> Optional[AccountRef]:
        if not token.startswith(ACCESS_PREFIX):
            return None
        hit = self._files.lookup(token_hash(token))
        now_ms = _now_ms(self._now)
        if hit is None or hit.kind != "access" or not isinstance(hit.expires_at, int) or hit.expires_at <= now_ms:
            return None
        if hit.resource != RESOURCE:
            return None
        try:
            self._touch(hit.user_id, hit.id, now_ms)
        except Exception as e:
            log.warning("could not note an agent's use: %s", type(e).__name__)
        return AccountRef(hit.user_id, "oauth", hit.id)

    def _touch(self, user_id: int, grant_id: str, now_ms: int) -> None:
        def change(data):
            rows = data.get("oauth") if isinstance(data.get("oauth"), list) else []
            grant = next((g for g in rows if isinstance(g, dict) and g.get("id") == grant_id), None)
            last = grant.get("lastUsedAt") if grant else None
            if grant is None or (isinstance(last, int) and now_ms - last < 60_000):
                return None, None
            grant["lastUsedAt"] = now_ms
            return None, {**data, "oauth": rows}
        update_account(self._state, user_id, change)
