import json
import os
import sys
import tempfile
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_DIR))   # mapping / yungu_task are top-level modules in api/
# service.app builds a module-level app from YUNGU_STATE_DIR (default: the live /var/lib/yungu-lms) when it
# is imported: point it at a throwaway directory so no test can ever read or move live state.
os.environ["YUNGU_STATE_DIR"] = tempfile.mkdtemp(prefix="yungu-lms-test-state-")

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def load():
    def _load(name):
        return json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return _load
