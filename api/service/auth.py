"""The owner's saved Yungu login and the dashboard's access tokens, kept in the state directory.

* credentials.json  {loginId, password}: the saved password used for automatic re-login.
* owner.json        {userId, loginId}: fixed by the first successful sign-in; never cleared by sign-out,
                    so the dashboard stays one person's.
* tokens.json       {hashes: [sha256 hex]}: only hashes, so the file alone cannot be used to sign in.
"""
import hashlib
import secrets
import threading
from dataclasses import dataclass
from typing import Optional

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
    def __init__(self, state: StateDir):
        self._state = state
        self._lock = threading.Lock()

    # ------------------------------------------------------------ credentials
    def credentials(self) -> Optional[Credentials]:
        c = self._state.read(CREDENTIALS)
        if not isinstance(c, dict) or not c.get("loginId") or not isinstance(c.get("password"), str):
            return None
        return Credentials(c["loginId"], c["password"])

    def owner(self) -> Optional[int]:
        o = self._state.read(OWNER)
        return o.get("userId") if isinstance(o, dict) else None

    def remember(self, login_id: str, password: str, user_id: int) -> None:
        """Save the password (replacing an older one) and fix the owner on the first sign-in."""
        with self._lock:
            self._state.write(CREDENTIALS, {"loginId": login_id, "password": password})
            if self.owner() is None:
                self._state.write(OWNER, {"userId": user_id, "loginId": login_id})

    def forget(self) -> None:
        """Sign-out, or a saved password Yungu rejected: drop the password and every token."""
        with self._lock:
            self._state.delete(CREDENTIALS)
            self._state.delete(TOKENS)

    # ----------------------------------------------------------------- tokens
    def _hashes(self) -> list:
        t = self._state.read(TOKENS)
        return list(t.get("hashes") or []) if isinstance(t, dict) else []

    def issue_token(self) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._state.write(TOKENS, {"hashes": self._hashes() + [_hash(token)]})
        return token

    def valid(self, token: Optional[str]) -> bool:
        if not token:
            return False
        digest = _hash(token)
        return any(secrets.compare_digest(digest, h) for h in self._hashes() if isinstance(h, str))
