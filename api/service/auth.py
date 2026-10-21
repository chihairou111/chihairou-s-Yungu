"""Who is signed in: the owner's saved Yungu login, and the dashboard's access tokens of every account.

Files in the state directory (the owner's only):
* credentials.json  {loginId, password}: the owner's saved password, used for automatic re-login.
* owner.json        {userId, loginId}: fixed by the first successful sign-in; never cleared by sign-out.
* tokens.json       {userId, hashes: [sha256 hex]}: the owner's tokens, only hashes, so the file alone
                    cannot be used to sign in. They count only while userId is the owner's; the single-owner
                    service's {hashes} list is bound to the owner on first use.

Fails closed: an owner.json that exists but is unreadable or invalid, or saved state (credentials.json,
tokens.json) with no owner.json, means there is no owner. Then no saved token counts, no password is
saved and every sign-in is an ordinary account's, until someone sorts the files out by hand.

Every other account's password is never stored, and its tokens live only in memory (hashed too), each
mapped to the one Yungu userId it was issued for: a restart ends them, as it ends their Yungu session.
"""
import hashlib
import logging
import secrets
import threading
from dataclasses import dataclass
from typing import Dict, List, Optional

from .state import StateDir

log = logging.getLogger("yungu_lms.auth")
CREDENTIALS, OWNER, TOKENS = "credentials.json", "owner.json", "tokens.json"
MAX_TOKENS_PER_ACCOUNT = 10          # an account other than the owner: its newest tokens (devices) only
BROKEN_OWNER = ("owner.json is missing or unreadable while other saved state exists: no account is the "
                "owner, no saved token counts and no password is saved. Move the state files away to start over.")


@dataclass(frozen=True)
class Credentials:
    login_id: str
    password: str

    def __repr__(self):                       # keep the password out of any accidental log line
        return f"Credentials(login_id={self.login_id!r}, password=***)"


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Auth:
    """`_lock` guards the files and `_memory`; no network I/O ever happens under it."""

    def __init__(self, state: StateDir):
        self._state = state
        self._lock = threading.Lock()
        self._memory: Dict[str, int] = {}         # token hash -> userId, for every account but the owner
        self._owner: Optional[int] = None         # owner.json, once read valid: it never changes after that
        self._warned = False

    # ------------------------------------------------------------ credentials
    def credentials(self) -> Optional[Credentials]:
        c = self._state.read(CREDENTIALS)
        if not isinstance(c, dict) or not c.get("loginId") or not isinstance(c.get("password"), str):
            return None
        return Credentials(c["loginId"], c["password"])

    def _record(self):
        """("owner", userId), ("fresh", None): nothing saved at all, or ("broken", None)."""
        if self._owner is not None:
            return "owner", self._owner
        if self._state.exists(OWNER):
            o = self._state.read(OWNER)
            user_id = o.get("userId") if isinstance(o, dict) else None
            if isinstance(user_id, int) and not isinstance(user_id, bool):
                self._owner = user_id
                return "owner", user_id
        elif not self._state.exists(CREDENTIALS) and not self._state.exists(TOKENS):
            return "fresh", None
        if not self._warned:
            self._warned = True
            log.warning(BROKEN_OWNER)
        return "broken", None

    def owner(self) -> Optional[int]:
        return self._record()[1]

    def claim_owner(self, login_id: str, user_id: int) -> bool:
        """After a successful sign-in: is `user_id` the owner? Only on a fresh state dir does it become the
        owner (the first sign-in); never with a broken owner record. One decision under the lock, so two
        first sign-ins cannot both win."""
        with self._lock:
            state, owner = self._record()
            if state == "fresh":
                self._state.delete(CREDENTIALS)            # nothing should be there; never inherit any
                self._state.delete(TOKENS)
                self._state.write(OWNER, {"userId": user_id, "loginId": login_id})
                self._owner = user_id
                return True
            return state == "owner" and owner == user_id

    def remember(self, login_id: str, password: str) -> None:
        """The owner's password (replacing an older one). Never called for any other account."""
        with self._lock:
            self._state.write(CREDENTIALS, {"loginId": login_id, "password": password})

    def forget(self) -> None:
        """The owner's sign-out, or its saved password rejected: drop the password and the owner's tokens."""
        with self._lock:
            self._state.delete(CREDENTIALS)
            self._state.delete(TOKENS)

    # ----------------------------------------------------------------- tokens
    def _owner_hashes(self) -> List[str]:
        """The owner's saved token hashes (call under the lock). Hashes saved for any other userId, or with
        no owner, count for nothing; an old {hashes} list is bound to the owner and written back."""
        owner = self.owner()
        t = self._state.read(TOKENS)
        if owner is None or not isinstance(t, dict):
            return []
        hashes = [h for h in t.get("hashes") or [] if isinstance(h, str)]
        if "userId" not in t:
            self._state.write(TOKENS, {"userId": owner, "hashes": hashes})
            log.info("bound the saved dashboard tokens to the owner")
            return hashes
        user_id = t.get("userId")
        return hashes if isinstance(user_id, int) and not isinstance(user_id, bool) and user_id == owner else []

    def issue_token(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            if user_id == self.owner():
                self._state.write(TOKENS, {"userId": user_id, "hashes": self._owner_hashes() + [_hash(token)]})
            else:
                self._memory[_hash(token)] = user_id
                mine = [h for h, u in self._memory.items() if u == user_id]
                for old in mine[:-MAX_TOKENS_PER_ACCOUNT]:       # oldest first (dicts keep insertion order)
                    del self._memory[old]
        return token

    def drop_tokens(self, user_id: int) -> None:
        """Every in-memory token of `user_id` (an account other than the owner) stops working."""
        with self._lock:
            self._memory = {h: u for h, u in self._memory.items() if u != user_id}

    def user_for(self, token: Optional[str]) -> Optional[int]:
        """The userId a token was issued for, or None."""
        if not token:
            return None
        digest = _hash(token)
        with self._lock:
            user_id = self._memory.get(digest)
            if user_id is not None:
                return user_id
            if any(secrets.compare_digest(digest, h) for h in self._owner_hashes()):
                return self.owner()
        return None
