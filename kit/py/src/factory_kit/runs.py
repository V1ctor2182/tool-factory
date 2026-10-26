import json

from . import paths


def append(record: dict) -> None:
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
    with open(paths.home() / "runs.jsonl", "a", encoding="utf-8") as f:
        f.write(line)
