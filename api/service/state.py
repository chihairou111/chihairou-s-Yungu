"""The service's state directory: small JSON files, dir 0700, files 0600, atomic writes.

Directory and files are created lazily on the first write, so importing the app touches nothing."""
import json
import logging
import os
import tempfile
import threading
from pathlib import Path
from typing import Any, List, Optional

log = logging.getLogger("yungu_lms.state")


class StateDir:
    def __init__(self, path):
        self.path = Path(path)

    def read(self, name: str) -> Optional[Any]:
        try:
            return json.loads((self.path / name).read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except ValueError:
            log.warning("ignoring unreadable state file %s", name)
            return None

    def write(self, name: str, value: Any) -> None:
        self.path.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.path, 0o700)
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


class SubmittedFiles:
    """Per assignment, the file ids of the last hand-in the service saw: a submit made through it, or a
    Yungu read showing the hand-in (submitted, no draft open), which also catches one made on Yungu.

    Yungu's getAchievementDetail has one file list (`fileModelList`, the draft), so it cannot say
    which files were handed in once the draft is edited after a submit; this list can."""
    FILE = "submitted-files.json"

    def __init__(self, state: StateDir):
        self._state = state
        self._lock = threading.Lock()

    def get(self, assignment_id: int) -> Optional[List[str]]:
        ids = (self._state.read(self.FILE) or {}).get(str(assignment_id))
        return list(ids) if isinstance(ids, list) else None

    def put(self, assignment_id: int, file_ids: List[str]) -> None:
        with self._lock:
            kept = self._state.read(self.FILE) or {}
            kept[str(assignment_id)] = list(file_ids)
            self._state.write(self.FILE, kept)
