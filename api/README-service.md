# Yungu LMS API service

FastAPI app in `service/`, listening on `127.0.0.1:8100` only. State lives in `YUNGU_STATE_DIR`
(default `/var/lib/yungu-lms`, dirs 0700, files 0600):

    credentials.json   the owner's saved Yungu login (automatic re-login)
    owner.json         {userId, loginId} of the owner: fixed by the first sign-in, never cleared
    tokens.json        {userId, hashes}: the owner's dashboard tokens (an old {hashes} list is bound to
                       the owner on first use)
    users/<userId>/submitted-files.json   each account's hand-in record
    users/<userId>/todoist.json           each account's Todoist link: token, refresh token, Todoist user,
                                          pairings, last sync, last error (kept when the account signs out
                                          or is forgotten; Disconnect drops the token, keeps the pairings)
    users/<userId>/agent-tokens.json      each account's agent access: personal tokens {id, name, hash,
                                          createdAt, lastUsedAt} (sha256 only; kept across restarts and
                                          dashboard sign-out, gone when revoked)

## Accounts
Any Yungu student account can sign in. The **owner** (owner.json) keeps today's behaviour: password saved,
automatic single-flight re-login with the lockout guard and back-off, survives restarts; sign-out deletes
the password and the owner's tokens. **Every other account** has no password stored anywhere (not on disk,
dropped from memory once its login is done): its Yungu session and its tokens (hashed) live in memory only,
so when Yungu ends that session, or the service restarts, its requests answer 401 "Sign in again." and no
login is attempted. Each token maps to one userId; Yungu calls, the read cache, the hand-in record, the
Mark-as-submitted lock and every lock around a login are per account. A state dir from the single-owner
service (with `submitted-files.json` at the top) is moved into `users/<owner>/` on the owner's first request.

- **Fails closed:** an owner.json that exists but is unreadable/invalid, or any other saved state
  (credentials.json, tokens.json, a top-level submitted-files.json, anything under users/) with no owner.json,
  means *no owner*: no saved token counts, no password is saved, every sign-in is an ordinary
  (memory-only) account. A warning is logged. Fix the files by hand (or move them away) to recover.
- **File ids:** an account may open (`/files/<id>`), update (online docs), save to a draft or hand in only
  file ids Yungu showed it through its own session (assignment detail: attachments, its files, comment files)
  or that it made (uploads, documents); never ids from the kept hand-in record. Any other id is a 404 with no
  Yungu call. Memory only, at most 5000 per account:
  after a restart, opening the assignment again makes its files usable.
- **Bounds:** each account's read cache drops expired entries and holds at most 300; an account other than
  the owner unused for 12 h is signed out and forgotten (the owner never, nor an account with Todoist
  connected or a personal agent token); such an account keeps its 10 newest tokens.
- **Sign-in throttling:** login id over 64 or password over 256 characters → 400 before anything else.
  Before any Yungu call: a login id with 5 refused sign-ins in 15 min, or a client address with 10 refused
  sign-ins across all ids in 15 min, gets 429 "Too many attempts. Try again in a few minutes."; past 3
  sign-ins at once, 429 "Too many sign-ins right now. Try again in a moment.". Every Yungu refusal counts
  for its id and its address; Yungu being down does not; a success clears its id's count only (an address's
  refusals just age out). The answer never depends
  on the password typed (nothing is compared against the saved one). The owner's login id (owner.json, or
  the saved login's) has a threshold of 20 across all addresses, is not held by its address's count, and has
  a sign-in slot of its own. The address is `X-Real-IP`, set
  by nginx and passed on by the dashboard's sign-in (trusted because the service listens on 127.0.0.1);
  without it, the socket peer.

## Todoist sync
Each account can connect its own Todoist (OAuth app; `TODOIST_CLIENT_ID` / `TODOIST_CLIENT_SECRET` from
`/etc/yungu-lms/todoist.env`, root-only 0600, loaded by the unit's `EnvironmentFile=`; without them the
routes answer 503 "Todoist isn't set up on this server."). Code: `todoist.py` (client), `service/todoist_sync.py`
(store + engine), `service/todoist_service.py` (OAuth, status, guard, schedule). Bearer on every route:

    POST   /todoist/connect    → {authorizeUrl}  (state: random, this account's, single use, 10 min)
    POST   /todoist/callback   {code, state} → 204, after the server-side code exchange; a missing, unknown,
                               used, expired or other account's state → 400 "That Todoist link expired. Try
                               connecting again." (nothing stored, the code never sent); Todoist refusing →
                               502 "Todoist didn't accept the connection. Try again."; Todoist down → 502
                               "Can't reach Todoist right now. Try again."
    GET    /todoist            → {connected, account?, state: ok|syncing|error, lastSyncAt?, error?: {code, message}}
    POST   /todoist/sync       → 202 (409 "Connect Todoist first." when not connected)
    DELETE /todoist            → 204: forget the token (pairings kept per Todoist account), revoke it, best effort
    POST   /refresh            also triggers the account's sync (returns at once)

Error codes: `reauth` (token rejected), `todoist_unreachable` (Todoist down, 429/5xx, anything unexpected),
`signin` (the account's Yungu session ended), `yungu_unreachable`. Syncs: right after connect (adopting open
"Yungu"-labelled tasks first), on Refresh, on sign-in, on POST /todoist/sync and every 15 min for every account
connected on disk (one thread in the app lifespan, first round 30 s after start). One sync per account at a
time (a trigger meanwhile runs it once more after), at most 4 accounts at once. The owner syncs through its
automatic re-login; any other account only while its memory session is on (else `signin`, no login tried).
A Todoist outage holds automatic triggers 15 min, doubling up to 2 h; Todoist's Retry-After (capped at 2 h)
holds every trigger; `reauth` holds automatic triggers until Reconnect (Try again still asks Todoist). A 403 is
`reauth` only when Todoist's error tag is about the token or scope. An assignment whose create or due update
Todoist refuses outright (another 4xx) is skipped and tried again next sync; the rest still syncs, the menu shows
`todoist_unreachable`, and nothing is held back. An account with Todoist connected (and not in `reauth`) is not
signed out by the 12 h idle sweep (it stays until Yungu ends its session). Tokens, codes, states and the client secret are never logged or answered.

## Agent access (MCP)
A read-only MCP server for AI agents at `/mcp` (public `https://yungu.chihairou.dev/mcp`), built on the official
`mcp` SDK (2.x): its low-level `Server` behind its Streamable HTTP session manager, **stateless with JSON
responses** (every POST stands alone; legacy `initialize` clients and 2026-07-28 clients both work). The
manager runs inside the app's lifespan. Host/Origin checked (DNS rebinding): `yungu.chihairou.dev` and loopback.
Code: `service/mcp_server.py` (endpoint, auth check, rate limit, logs), `service/mcp_tools.py` (the tools over
`Student`), `service/agent_tokens.py` (`AgentAuth`, personal tokens).

- **Auth:** `Authorization: Bearer <agent token>` on every request, checked before the SDK sees it by
  `AgentAuth.resolve` (a list of verifiers; OAuth access tokens join it next to personal tokens). None, or one
  that resolves to nothing (a dashboard token included) → 401 with
  `WWW-Authenticate: Bearer resource_metadata="https://yungu.chihairou.dev/.well-known/oauth-protected-resource"`
  (plus `error="invalid_token"` when a token was sent). Agent tokens open nothing but `/mcp`: every other route
  keeps the dashboard token check, which knows nothing of them. Revoking stops the next request.
- **Personal tokens** (dashboard Bearer only): `POST /agent/tokens {name}` → `{id, name, token}` (`ylp_…`,
  shown once; name 1–64 characters; at most 20 per account → 400 "You can have up to 20 tokens. Revoke one
  first."), `GET /agent/tokens` → `{personal: [{id, name, createdAt, lastUsedAt}], clients: []}`,
  `DELETE /agent/tokens/{id}` → 204 (404 for another account's or an unknown id). No expiry until revoked;
  dashboard sign-out does not revoke them.
- **Tools** (all `readOnlyHint: true`): `list_todo`, `list_submitted(course?, limit?)`, `get_assignment(id)`,
  `get_schedule(date?, week?)`, `list_courses`, `get_behaviour(month?)`, `list_notifications(unread_only?,
  limit?)`. Each answers a short text summary plus the same data as compact JSON (text and
  `structuredContent`); times are China time ISO 8601; instructions are plain text; attachments are dashboard
  links (`/api/files/<id>`, online documents → the assignment page); never file bytes, never a write (reading
  notifications does not mark them read). They use the account's own session and 60 s read cache.
- **Which account:** the token's. The owner always (automatic re-login); any other account only while its
  Yungu session is on, else the tool error "Sign in to the dashboard again to keep agent access working." with
  no login attempt (also the owner's answer after its sign-out deleted the saved password). Yungu down →
  "Can't reach Yungu right now. Try again."; anything unexpected → "Something went wrong reading Yungu. Try
  again." (no trace). An account with a personal token is not signed out by the 12 h idle sweep.
- **Rate limit:** 60 tool calls per minute per account (sliding) → tool error "Too many requests: at most 60
  tool calls a minute for this account. Try again in a minute.", no Yungu call.
- **Logs:** `tool=<name> account=<sha256 of the userId, 12 hex> status=<ok|sign_in|unavailable|not_found|
  bad_arguments|rate_limited|...> ms=<n>`; never arguments, results or tokens.

## Run by hand
    cd /root/yungu-lms/api
    .venv/bin/pip install -r requirements.txt     # venv: python3 -m venv .venv
    YUNGU_STATE_DIR=/tmp/yungu-state .venv/bin/uvicorn service.app:app --host 127.0.0.1 --port 8100

## systemd
    install -d -m 0700 /etc/yungu-lms
    install -m 0600 /root/.config/yungu-lms/todoist-oauth.env /etc/yungu-lms/todoist.env
    cp deploy/yungu-lms-api.service /etc/systemd/system/
    systemctl daemon-reload && systemctl enable --now yungu-lms-api
    journalctl -u yungu-lms-api -f

## Tests and live smoke
    .venv/bin/python -m pytest -q -W error        # offline, no network
    set -a; . /root/.config/yungu-lms/creds.env; set +a
    .venv/bin/python smoke_live.py                # read-only; saves a token in /root/.config/yungu-lms/smoke-token

The smoke never calls `DELETE /session` (it would delete the saved password) and makes no write calls.
