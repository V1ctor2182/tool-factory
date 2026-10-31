# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import json
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from factory_kit import cli


def _fetch(url: str):
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            body = response.read()
    except urllib.error.HTTPError as e:
        raise cli.AtomError("unavailable", f"HTTP {e.code} from {url}") from None
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        raise cli.AtomError("network_error", f"{url}: {getattr(e, 'reason', e)}") from None
    try:
        return json.loads(body)
    except ValueError:
        raise cli.AtomError("invalid_source", f"Not JSON: {url}") from None


def _source(source: str, item) -> dict:
    if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not isinstance(item.get("files"), list):
        raise cli.AtomError("invalid_source", f"Not a shadcn registry item: {source}")
    files = item["files"]
    exposed = bool(files) and all(isinstance(f, dict) and isinstance(f.get("content"), str) and f["content"] for f in files)
    return {"source": source, "exposed": exposed, "item": item, "cacheHit": False}


def registry(url: str) -> dict:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise cli.AtomError("invalid_source", f"Not an http or https URL: {url}")
    return _source(url, _fetch(url))


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
