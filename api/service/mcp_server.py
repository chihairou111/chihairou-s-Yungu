"""The read-only MCP endpoint, /mcp: the official `mcp` SDK's low-level Server over its Streamable HTTP
transport, stateless with JSON responses (every POST stands alone: no session to hijack or keep alive, and
each one is authenticated afresh, so a revoked token stops the very next call).

`McpEndpoint` (raw ASGI, mounted at /mcp by app.py) checks `Authorization: Bearer` through `AgentAuth`
(personal tokens and OAuth access tokens) before the SDK sees the request: no token is a 401 with
`WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource", scope="read"`
(MCP authorization spec / RFC 9728 / RFC 6750 §3), a refused Bearer token the same plus
`error="invalid_token"`. GET (and DELETE) are 405: stateless, the server never streams to the client nor
keeps a session to end. The token's `AccountRef` rides in the ASGI scope; the tool handler reads it from the
request the SDK hands it, never from anything the agent sends.

Tools (mcp_tools.py) run in a worker thread for that one account: its own Yungu session and read cache,
60 calls a minute at most (RATE_LIMIT), at most MAX_CONCURRENT_CALLS at once (the rest wait without holding
a thread, so one account cannot take the shared pool), and for an account other than the owner only while
its Yungu session is on (no login is ever attempted for it). Logs: tool name, hashed account id, status,
duration; never arguments, results or tokens.
"""
import hashlib
import json
import logging
import threading
import time
from collections import deque
from contextlib import asynccontextmanager
from typing import Callable, Deque, Dict, Optional

import anyio
from mcp import types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings

from . import mcp_tools
from .agent_tokens import AccountRef, AgentAuth
from .mcp_tools import PUBLIC_URL, SIGN_IN_TO_DASHBOARD, SOMETHING_WRONG, ToolFailure
from .yungu import SignInAgain

log = logging.getLogger("yungu_lms.mcp")
RESOURCE = f"{PUBLIC_URL}/mcp"                  # the canonical URI agents' tokens are bound to (RFC 8707)
RESOURCE_METADATA = f"{PUBLIC_URL}/.well-known/oauth-protected-resource"
SCOPE = "read"                                  # the one scope: everything here is read-only
PUBLIC_HOST = PUBLIC_URL.split("://", 1)[1]
ACCOUNT = "yungu_lms.agent"                     # the ASGI scope key McpEndpoint sets
RATE_LIMIT, RATE_WINDOW_SECONDS = 60, 60.0
MAX_CONCURRENT_CALLS = 4
RATE_LIMITED = "Too many requests: at most 60 tool calls a minute for this account. Try again in a minute."
NOT_RUNNING = "The agent endpoint is starting. Try again in a moment."
INSTRUCTIONS = ("Read-only access to one student's Yungu (task.yungu.org) data: assignments to do and handed in, "
                "assignment details and teacher feedback, the class schedule, courses, behaviour points "
                "(凌云积分) and notifications. Times are China time (UTC+8). Nothing here can hand in, comment or "
                "change anything; links open in the student's dashboard.")


def account_hash(user_id: int) -> str:
    """The account in log lines."""
    return hashlib.sha256(f"yungu-lms:{user_id}".encode()).hexdigest()[:12]


class RateLimit:
    """At most `limit` calls per account in any `window` seconds (sliding); refused calls do not count."""

    def __init__(self, clock: Callable[[], float], limit: int = RATE_LIMIT, window: float = RATE_WINDOW_SECONDS):
        self._clock, self._limit, self._window = clock, limit, window
        self._calls: Dict[int, Deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, user_id: int) -> bool:
        with self._lock:
            now = self._clock()
            if len(self._calls) > 1000:                        # forget accounts that went quiet
                for uid in [u for u, q in self._calls.items() if not q or now - q[-1] >= self._window]:
                    del self._calls[uid]
            times = self._calls.setdefault(user_id, deque())
            while times and now - times[0] >= self._window:
                times.popleft()
            if len(times) >= self._limit:
                return False
            times.append(now)
            return True


def _tool_list():
    """Every tool read-only (and so idempotent, never destructive), over the student's own Yungu only."""
    return [types.Tool(name=name, title=t["title"], description=t["description"], inputSchema=t["schema"],
                       annotations=types.ToolAnnotations(title=t["title"], readOnlyHint=True, destructiveHint=False,
                                                         idempotentHint=True, openWorldHint=False))
            for name, t in mcp_tools.TOOLS.items()]


def _result(summary: str, data: dict) -> types.CallToolResult:
    compact = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return types.CallToolResult(content=[types.TextContent(type="text", text=summary),
                                         types.TextContent(type="text", text=compact)],
                                structuredContent=data)


def _error(message: str) -> types.CallToolResult:
    return types.CallToolResult(content=[types.TextContent(type="text", text=message)], isError=True)


class AgentMcp:
    """The MCP server for agents. `student(user_id)`: that account's Student for an agent, or SignInAgain
    (the owner always; another account only while its Yungu session is on: never a login)."""

    def __init__(self, auth: AgentAuth, student: Callable[[int], object], monotonic: Callable[[], float]):
        self._student = student
        self._monotonic = monotonic
        self._limit = RateLimit(monotonic)
        self._busy: Dict[int, anyio.Semaphore] = {}          # per account: at most MAX_CONCURRENT_CALLS
        self._manager: Optional[StreamableHTTPSessionManager] = None
        self.server = Server("yungu-lms", version="1", title="Yungu LMS (read-only)", instructions=INSTRUCTIONS,
                             get_tool_input_schema=lambda name: (mcp_tools.TOOLS.get(name) or {}).get("schema"),
                             on_list_tools=self._list_tools, on_call_tool=self._call_tool)
        self.endpoint = McpEndpoint(auth, lambda: self._manager)
        self._security = TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=[PUBLIC_HOST, "127.0.0.1", "127.0.0.1:*", "localhost", "localhost:*", "[::1]:*"],
            allowed_origins=[PUBLIC_URL, "http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"])

    @asynccontextmanager
    async def run(self):
        """The SDK's session manager, for the app's lifespan (a new one each time: one runs only once)."""
        manager = StreamableHTTPSessionManager(app=self.server, stateless=True, json_response=True,
                                               security_settings=self._security)
        async with manager.run():
            self._manager = manager
            self._busy = {}                                   # semaphores belong to this event loop
            try:
                yield
            finally:
                self._manager = None

    async def _list_tools(self, ctx, params) -> types.ListToolsResult:
        return types.ListToolsResult(tools=_tool_list())

    async def _call_tool(self, ctx, params: types.CallToolRequestParams) -> types.CallToolResult:
        started = time.monotonic()
        name = params.name if params.name in mcp_tools.TOOLS else "unknown"
        ref = getattr(getattr(ctx, "request", None), "scope", {}).get(ACCOUNT)
        if not isinstance(ref, AccountRef):                   # cannot happen behind McpEndpoint: fail closed
            log.warning("tool=%s account=- status=no_account", name)
            return _error(SIGN_IN_TO_DASHBOARD)
        status, result = "ok", None
        try:
            if not self._limit.allow(ref.user_id):           # before any wait: refused calls take no slot
                raise ToolFailure(RATE_LIMITED, "rate_limited")
            busy = self._busy.get(ref.user_id)
            if busy is None:
                busy = self._busy[ref.user_id] = anyio.Semaphore(MAX_CONCURRENT_CALLS)
            async with busy:
                summary, data = await anyio.to_thread.run_sync(self._run, ref.user_id, params.name, params.arguments)
            result = _result(summary, data)
        except ToolFailure as e:
            status, result = e.status, _error(e.message)
        except Exception as e:                                # never a trace to the agent, nor its text in a log
            status, result = f"failed:{type(e).__name__}", _error(SOMETHING_WRONG)
        log.info("tool=%s account=%s status=%s ms=%d", name, account_hash(ref.user_id), status,
                 (time.monotonic() - started) * 1000)
        return result

    def _run(self, user_id: int, name: str, arguments):
        try:
            me = self._student(user_id)
        except SignInAgain:
            raise ToolFailure(SIGN_IN_TO_DASHBOARD, "sign_in") from None
        return mcp_tools.run(me, name, arguments)


class McpEndpoint:
    """Raw ASGI at /mcp: the Bearer check, then the SDK's Streamable HTTP handler."""

    def __init__(self, auth: AgentAuth, manager: Callable[[], Optional[StreamableHTTPSessionManager]]):
        self._auth = auth
        self._manager = manager

    async def __call__(self, scope, receive, send):
        if scope.get("method") != "POST":                     # stateless: no stream to open, no session to end
            return await _json(send, 405, {"error": "Method Not Allowed"}, headers=[(b"allow", b"POST")])
        value = next((v.decode("latin-1") for k, v in scope.get("headers") or [] if k == b"authorization"), "")
        scheme, _, bearer = value.strip().partition(" ")
        bearer = bearer.strip() if scheme.lower() == "bearer" else ""
        ref = await anyio.to_thread.run_sync(self._auth.resolve, bearer) if bearer else None
        if ref is None:
            return await _challenge(send, invalid=bool(bearer))
        manager = self._manager()
        if manager is None:
            return await _json(send, 503, {"error": NOT_RUNNING})
        await manager.handle_request({**scope, ACCOUNT: ref}, receive, send)


async def _json(send, status: int, body: dict, headers=()) -> None:
    data = json.dumps(body).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(data)).encode()),
                            (b"cache-control", b"no-store"), *headers]})
    await send({"type": "http.response.body", "body": data})


async def _challenge(send, invalid: bool) -> None:
    """401 per RFC 6750 §3 / RFC 9728: where to find how to get a token, the scope to ask for, and an error
    code only when a Bearer token came and was refused (none for no credential or another scheme)."""
    params = ('error="invalid_token", ' if invalid else "") + \
        f'resource_metadata="{RESOURCE_METADATA}", scope="{SCOPE}"'
    await _json(send, 401, {"error": "invalid_token" if invalid else "unauthorized",
                            "error_description": "A valid agent token is required."},
                headers=[(b"www-authenticate", f"Bearer {params}".encode())])
