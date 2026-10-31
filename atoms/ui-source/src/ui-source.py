# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import json
from pathlib import Path

from factory_kit import cli, web


def _source(source: str, item) -> dict:
    if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not isinstance(item.get("files"), list):
        raise cli.AtomError("invalid_source", f"Not a shadcn registry item: {source}")
    files = item["files"]
    exposed = bool(files) and all(isinstance(f, dict) and isinstance(f.get("content"), str) and f["content"] for f in files)
    return {"source": source, "exposed": exposed, "item": item, "cacheHit": False}


def registry(url: str) -> dict:
    return _source(url, web.get_json(url, "ui-source"))


def parse(path: str) -> dict:
    try:
        item = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise cli.AtomError("invalid_source", f"Not a registry item file: {path}: {e}") from None
    return _source(path, item)


def _text(result: dict) -> str:
    if not result["exposed"]:
        return ""
    return "\n".join(f["path"] for f in result["item"]["files"])


if __name__ == "__main__":
    cli.main(
        Path(__file__).resolve().parent.parent,
        {"registry": cli.Verb(registry, _text), "parse": cli.Verb(parse, _text)},
    )
