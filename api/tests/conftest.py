import json
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(API_DIR))   # mapping / yungu_task are top-level modules in api/

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def load():
    def _load(name):
        return json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return _load
