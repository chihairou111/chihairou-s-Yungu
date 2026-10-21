"""The service's state directory: small JSON files, dirs 0700, files 0600, atomic writes.

    credentials.json, owner.json, tokens.json   the owner's (auth.py)
    users/<userId>/submitted-files.json         each account's hand-in record (SubmittedFiles)

Directories and files are created lazily on the first write, so importing the app touches nothing."""
import json
import logging
import os
import tempfile
import threading
from pathlib import Path
from typing import Any, List, Optional

log = logging.getLogger("yungu_lms.state")


class StateDir:
    def __init__(self, path, root=None):
        self.path = Path(path)
        self._root = Path(root) if root is not None else self.path      # the top state dir

    def child(self, *parts: str) -> "StateDir":
        """A subdirectory, created (each level 0700) on its first write."""
        return StateDir(self.path.joinpath(*parts), self._root)

    def _make_dirs(self) -> None:
        here = self._root
        for part in (None, *self.path.relative_to(self._root).parts):
            here = here if part is None else here / part
            here.mkdir(mode=0o700, parents=part is None, exist_ok=True)
            os.chmod(here, 0o700)

    def read(self, name: str) -> Optional[Any]:
        try:
            return json.loads((self.path / name).read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except ValueError:
            log.warning("ignoring unreadable state file %s", name)
            return None

    def exists(self, name: str) -> bool:
        return (self.path / name).exists()

    def has_entries(self, name: str) -> bool:
        """`name` is a directory with anything in it."""
        try:
            return any((self.path / name).iterdir())
        except (FileNotFoundError, NotADirectoryError):
            return False

    def write(self, name: str, value: Any) -> None:
        self._make_dirs()
        fd, tmp = tempfile.mkstemp(dir=self.path, prefix=f".{name}.")       # mkstemp creates it 0600
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(value, f, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path / name)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def delete(self, name: str) -> None:
        (self.path / name).unlink(missing_ok=True)

    def move_in(self, source: "StateDir", name: str) -> None:
        """Move `source`/name here (same file system: one atomic rename)."""
        self._make_dirs()
        os.replace(source.path / name, self.path / name)


class SubmittedFiles:
    """One account's record, in its own users/<userId>/ directory: per assignment, the file ids of the
    last hand-in the service saw: a submit made through it, or a Yungu read showing the hand-in
    (submitted, no draft open), which also catches one made on Yungu.

    Yungu's getAchievementDetail has one file list (`fileModelList`, the draft), so it cannot say
    which files were handed in once the draft is edited after a submit; this list can."""
    FILE = "submitted-files.json"

    def __init__(self, state: StateDir, user_id: int, migrate: bool = False,
                 lock: Optional[threading.Lock] = None):
        """`state` is the top state dir. `migrate` (the owner only, when its account is first used): a
        record at the top, from the single-account service that kept only the owner's, moves into the
        owner's directory. Should both exist (that service ran again after the move), the top one is the
        newer: its assignments are taken over the moved one's, and it goes."""
        self._state = state.child("users", str(int(user_id)))
        self._lock = lock or threading.Lock()          # shared by every record object of the service
        if migrate and state.exists(self.FILE):
            with self._lock:
                if self._state.exists(self.FILE):
                    newer = state.read(self.FILE)
                    kept = self._state.read(self.FILE)
                    merged = {**(kept if isinstance(kept, dict) else {}), **(newer if isinstance(newer, dict) else {})}
                    self._state.write(self.FILE, merged)
                    state.delete(self.FILE)
                    log.info("merged the old top-level hand-in record into the owner's directory")
                else:
                    self._state.move_in(state, self.FILE)
                    log.info("moved the owner's hand-in record into its account directory")

    def get(self, assignment_id: int) -> Optional[List[str]]:
        ids = (self._state.read(self.FILE) or {}).get(str(assignment_id))
        return list(ids) if isinstance(ids, list) else None

    def put(self, assignment_id: int, file_ids: List[str]) -> None:
        with self._lock:
            kept = self._state.read(self.FILE) or {}
            kept[str(assignment_id)] = list(file_ids)
            self._state.write(self.FILE, kept)
