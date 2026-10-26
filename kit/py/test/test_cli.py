import json
import subprocess
import sys
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parent.parent / "src"

MANIFEST = {
    "name": "echo",
    "kind": "transform",
    "description": "Echo the inputs.",
    "verbs": [
        {
            "name": "say",
            "description": "Echo one positional and one required flag.",
            "input": {
                "type": "object",
                "properties": {
                    "word": {"type": "string"},
                    "path": {"type": "string", "x-flag": True},
                    "loud": {"type": "boolean"},
                },
                "required": ["word", "path"],
            },
            "output": "echo",
        }
    ],
}

ATOM = """
from pathlib import Path
from factory_kit import cli
cli.main(Path(__file__).parent, {"say": cli.Verb(lambda **args: args, str)})
"""


@pytest.fixture
def atom(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps(MANIFEST))
    (tmp_path / "atom.py").write_text(ATOM)

    def run(*args: str) -> tuple[int, dict]:
        done = subprocess.run(
            [sys.executable, str(tmp_path / "atom.py"), *args, "--json"],
            capture_output=True,
            text=True,
            env={"PYTHONPATH": str(SRC), "PYTHONDONTWRITEBYTECODE": "1", "TOOL_FACTORY_HOME": str(tmp_path / "home")},
        )
        return done.returncode, json.loads(done.stdout)

    return run


def test_a_required_x_flag_input_is_a_flag_and_the_rest_stay_positional(atom):
    assert atom("say", "hi", "--path", "a.json") == (0, {"word": "hi", "path": "a.json", "loud": False, "cacheHit": False})


def test_a_missing_required_flag_is_invalid_args(atom):
    code, out = atom("say", "hi")
    assert code == 1
    assert out["error"]["code"] == "invalid_args"
    assert "--path" in out["error"]["message"]


def test_a_missing_required_positional_is_invalid_args(atom):
    code, out = atom("say", "--path", "a.json")
    assert code == 1
    assert out["error"]["code"] == "invalid_args"
