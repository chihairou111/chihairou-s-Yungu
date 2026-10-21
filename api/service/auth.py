"""Who is signed in: the owner's saved Yungu login, and the dashboard's access tokens of every account.

Files in the state directory (the owner's only):
* credentials.json  {loginId, password}: the owner's saved password, used for automatic re-login.
* owner.json        {userId, loginId}: fixed by the first successful sign-in; never cleared by sign-out.
* tokens.json       {hashes: [sha256 hex]}: the owner's tokens, only hashes, so the file alone cannot be
                    used to sign in.

Every other account's password is never stored, and its tokens live only in memory (hashed too), each
mapped to the one Yungu userId it was issued for: a restart ends them, as it ends their Yungu session.
"""
import hashlib
import secrets
import threading
from dataclasses import dataclass
from typing import Dict, Optional

from .state import StateDir

CREDENTIALS, OWNER, TOKENS = "credentials.json", "owner.json", "tokens.json"


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
        self._owner: Optional[int] = None         # owner.json, once read: it never changes after that

    # ------------------------------------------------------------ credentials
    def credentials(self) -> Optional[Credentials]:
        c = self._state.read(CREDENTIALS)
        if not isinstance(c, dict) or not c.get("loginId") or not isinstance(c.get("password"), str):
            return None
        return Credentials(c["loginId"], c["password"])

    def owner(self) -> Optional[int]:
        if self._owner is None:
            o = self._state.read(OWNER)
            user_id = o.get("userId") if isinstance(o, dict) else None
            self._owner = user_id if isinstance(user_id, int) and not isinstance(user_id, bool) else None
        return self._owner

    def claim_owner(self, login_id: str, user_id: int) -> bool:
        """After a successful sign-in: is `user_id` the owner? With no owner fixed yet it becomes the owner
        (the first sign-in). One decision under the lock, so two first sign-ins cannot both win."""
        with self._lock:
            owner = self.owner()
            if owner is None:
                self._state.write(OWNER, {"userId": user_id, "loginId": login_id})
                self._owner = user_id
                return True
            return owner == user_id

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
    def _hashes(self) -> list:
        t = self._state.read(TOKENS)
        return list(t.get("hashes") or []) if isinstance(t, dict) else []

    def issue_token(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            if user_id == self.owner():
                self._state.write(TOKENS, {"hashes": self._hashes() + [_hash(token)]})
            else:
                self._memory[_hash(token)] = user_id
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
        if any(secrets.compare_digest(digest, h) for h in self._hashes() if isinstance(h, str)):
            return self.owner()
        return None
