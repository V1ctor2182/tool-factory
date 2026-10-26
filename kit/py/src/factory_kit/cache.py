import json
import os
import re
import tempfile
from pathlib import Path

from . import paths


class Cache:
    def __init__(self, atom: str):
        self._entries = paths.atom_dir(atom, "cache")
        self._staging = paths.atom_dir(atom, "tmp")

    def _path(self, key: str) -> Path:
        return self._entries / (re.sub(r"[^A-Za-z0-9._-]", "_", key) + ".json")

    def get(self, key: str) -> dict | None:
        try:
            value = json.loads(self._path(key).read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        return {**value, "cacheHit": True}

    def put(self, key: str, value: dict) -> None:
        fd, tmp = tempfile.mkstemp(dir=self._staging, suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({k: v for k, v in value.items() if k != "cacheHit"}, f, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self._path(key))
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
