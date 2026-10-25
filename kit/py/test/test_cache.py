import os
import subprocess
import sys
from pathlib import Path

import pytest

from factory_kit.cache import Cache

SRC = Path(__file__).resolve().parent.parent / "src"

CRASH_MID_WRITE = """
import os, signal
from factory_kit.cache import Cache

class DiesWhileSerialized(dict):
    def items(self):
        os.kill(os.getpid(), signal.SIGKILL)

Cache("atom").put("key", {"big": "x" * 1_000_000, "last": DiesWhileSerialized(a=1)})
"""


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("TOOL_FACTORY_HOME", str(tmp_path))
    return tmp_path


def entries(home: Path) -> list[str]:
    return sorted(p.name for p in (home / "atom" / "cache").iterdir())


def test_put_then_get_returns_the_value_marked_as_a_hit(home):
    Cache("atom").put("key", {"text": "hello"})
    assert Cache("atom").get("key") == {"text": "hello", "cacheHit": True}


def test_missing_key_returns_none(home):
    assert Cache("atom").get("key") is None


def test_write_that_fails_before_rename_leaves_no_entry(home):
    with pytest.raises(TypeError):
        Cache("atom").put("key", {"big": "x" * 1_000_000, "last": object()})
    assert Cache("atom").get("key") is None
    assert entries(home) == []


def test_process_killed_mid_write_leaves_no_entry_and_a_rerun_converges(home):
    env = {**os.environ, "PYTHONPATH": str(SRC)}
    killed = subprocess.run([sys.executable, "-c", CRASH_MID_WRITE], env=env)
    assert killed.returncode == -9
    assert Cache("atom").get("key") is None
    assert entries(home) == []

    Cache("atom").put("key", {"text": "hello"})
    assert Cache("atom").get("key") == {"text": "hello", "cacheHit": True}
    assert entries(home) == ["key.json"]
