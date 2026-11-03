"""Agent access: which dashboard account an MCP Bearer token belongs to.

`AgentAuth.resolve(bearer)` asks each registered verifier in turn and answers the `AccountRef` of the one
account the token was issued for, or None. Verifiers are anything with `verify(token) -> AccountRef | None`
(`Verifier`): personal tokens here; OAuth access tokens (Task 2) register into the same resolver, so /mcp
checks every kind of agent token the same way. Agent tokens are never dashboard tokens: the dashboard routes
keep their own check (auth.py), which knows nothing of these.

Personal tokens (`ylp_…`): made, listed and revoked only from a signed-in dashboard (routes in app.py);
shown once; at most MAX_PERSONAL_TOKENS per account; no expiry until revoked. Stored hashed (sha256),
per account, in users/<userId>/agent-tokens.json (0600, state.py):

    {"personal": [{"id", "name", "hash", "createdAt", "lastUsedAt"}]}       (times: epoch ms, or null)

They survive restarts and the dashboard's sign-out (agent access is managed in "Agent access", like
Todoist); tools still need the account's live Yungu session (mcp_server.py).
"""
import hashlib
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Protocol, Tuple

from .state import StateDir

log = logging.getLogger("yungu_lms.agent")
FILE = "agent-tokens.json"
PERSONAL_PREFIX = "ylp_"
MAX_PERSONAL_TOKENS = 20
MAX_NAME_CHARS = 64
MAX_TOKEN_CHARS = 512             # anything longer is no token of ours: refused before hashing
TOUCH_SECONDS = 60.0              # lastUsedAt is written at most this often per token
_write_lock = threading.Lock()   # every agent-tokens.json read-modify-write, across accounts


@dataclass(frozen=True)
class AccountRef:
    """The one account an agent token belongs to. `kind`: "personal" (or "oauth", Task 2); `credential`:
    the token's (or grant's) id, never the token itself."""
    user_id: int
    kind: str
    credential: str

    def __repr__(self):
        return f"AccountRef(kind={self.kind!r})"          # no ids in an accidental log line


class Verifier(Protocol):
    def verify(self, token: str) -> Optional[AccountRef]: ...


class AgentAuth:
    """Every kind of agent token, through one resolver. Fails closed: a verifier that raises counts as a
    no (logged by exception type only)."""

    def __init__(self, verifiers=()):
        self._verifiers: List[Verifier] = list(verifiers)

    def register(self, verifier: Verifier) -> None:
        self._verifiers.append(verifier)

    def resolve(self, bearer: Optional[str]) -> Optional[AccountRef]:
        if not isinstance(bearer, str) or not bearer or len(bearer) > MAX_TOKEN_CHARS:
            return None
        for verifier in self._verifiers:
            try:
                found = verifier.verify(bearer)
            except Exception as e:
                log.error("agent token check failed: %s", type(e).__name__)
                return None
            if found is not None:
                return found
        return None


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _state(state_dir) -> StateDir:
    return state_dir if isinstance(state_dir, StateDir) else StateDir(state_dir)


def _user_dir(state: StateDir, user_id: int) -> StateDir:
    return state.child("users", str(int(user_id)))


def _entries(data) -> List[dict]:
    rows = data.get("personal") if isinstance(data, dict) else None
    return [r for r in rows or [] if isinstance(r, dict) and isinstance(r.get("id"), str)
            and isinstance(r.get("hash"), str)]


class TooManyTokens(Exception):
    pass


class PersonalTokens:
    """One account's personal tokens. `state_dir`: the service's top state dir (a path or a StateDir)."""

    def __init__(self, state_dir, user_id: int, now: Callable[[], float] = time.time):
        self.user_id = int(user_id)
        self._dir = _user_dir(_state(state_dir), self.user_id)
        self._now = now

    def _load(self) -> dict:
        data = self._dir.read(FILE)
        return data if isinstance(data, dict) else {}

    def _save(self, data: dict) -> None:
        self._dir.write(FILE, data)

    def create(self, name: str) -> Tuple[str, str]:
        """(id, token): the token itself only here, once. TooManyTokens past MAX_PERSONAL_TOKENS; the
        name must already be checked (1..MAX_NAME_CHARS characters)."""
        token = PERSONAL_PREFIX + secrets.token_urlsafe(32)
        token_id = secrets.token_hex(8)
        with _write_lock:
            data = self._load()
            rows = _entries(data)
            if len(rows) >= MAX_PERSONAL_TOKENS:
                raise TooManyTokens()
            rows.append({"id": token_id, "name": name, "hash": _hash(token),
                         "createdAt": int(self._now() * 1000), "lastUsedAt": None})
            self._save({**data, "personal": rows})
        return token_id, token

    def list(self) -> List[dict]:
        return [{"id": r["id"], "name": r.get("name") or "", "createdAt": r.get("createdAt"),
                 "lastUsedAt": r.get("lastUsedAt")} for r in _entries(self._load())]

    def revoke(self, token_id: str) -> bool:
        """True when the token was there (and now is gone)."""
        with _write_lock:
            data = self._load()
            rows = _entries(data)
            kept = [r for r in rows if r["id"] != token_id]
            if len(kept) == len(rows):
                return False
            self._save({**data, "personal": kept})
        return True

    def touch(self, token_id: str) -> None:
        """Note a use (lastUsedAt), at most every TOUCH_SECONDS; a revoked token is left gone."""
        now = int(self._now() * 1000)
        with _write_lock:
            data = self._load()
            rows = _entries(data)
            row = next((r for r in rows if r["id"] == token_id), None)
            last = row.get("lastUsedAt") if row else None
            if row is None or (isinstance(last, int) and now - last < TOUCH_SECONDS * 1000):
                return
            row["lastUsedAt"] = now
            self._save({**data, "personal": rows})


def has_agent_access(state_dir, user_id: int) -> bool:
    """For the idle sweep: the account has an active personal token (Task 2: or OAuth grant). Takes no
    lock; False when the file cannot be read."""
    try:
        return bool(_entries(_user_dir(_state(state_dir), user_id).read(FILE)))
    except OSError:
        return False


class PersonalTokenVerifier:
    """Finds a personal token's account by its hash. Each account's file is read again whenever it changed
    on disk (every write is an atomic replace: a new inode), so a revocation counts from the next call on."""

    def __init__(self, state_dir, now: Callable[[], float] = time.time):
        self._state = _state(state_dir)
        self._now = now
        self._lock = threading.Lock()
        self._seen: Dict[int, Tuple[tuple, Dict[str, str]]] = {}     # userId -> (file stamp, hash -> token id)

    def _accounts(self):
        users = self._state.path / "users"
        try:
            with os.scandir(users) as found:
                names = [e.name for e in found if e.is_dir(follow_symlinks=False)]
        except FileNotFoundError:
            return
        for name in names:
            if name.isascii() and name.isdigit():
                yield int(name), users / name / FILE

    def _hashes(self, user_id: int, path) -> Dict[str, str]:
        try:
            st = os.stat(path)
        except FileNotFoundError:
            self._seen.pop(user_id, None)
            return {}
        stamp = (st.st_ino, st.st_mtime_ns, st.st_size)
        cached = self._seen.get(user_id)
        if cached is not None and cached[0] == stamp:
            return cached[1]
        rows = _entries(_user_dir(self._state, user_id).read(FILE))
        hashes = {r["hash"]: r["id"] for r in rows}
        self._seen[user_id] = (stamp, hashes)
        return hashes

    def verify(self, token: str) -> Optional[AccountRef]:
        if not token.startswith(PERSONAL_PREFIX):
            return None
        digest = _hash(token)
        found = None
        with self._lock:
            for user_id, path in self._accounts():
                for stored, token_id in self._hashes(user_id, path).items():
                    if secrets.compare_digest(stored, digest):
                        found = AccountRef(user_id, "personal", token_id)
        if found is not None:
            PersonalTokens(self._state, found.user_id, self._now).touch(found.credential)
        return found
