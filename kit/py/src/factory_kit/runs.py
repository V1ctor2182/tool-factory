import json
import os

from . import paths


def append(record: dict) -> None:
    record = {**record, "caller": os.environ.get("TOOL_FACTORY_CALLER"), "session": os.environ.get("CLAUDE_CODE_SESSION_ID")}
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
    with open(paths.home() / "runs.jsonl", "a", encoding="utf-8") as f:
        f.write(line)
