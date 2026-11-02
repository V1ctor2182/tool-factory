# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "yt-dlp[default]"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import json
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp

from factory_kit import cli, paths
from factory_kit.ytdlp import atom_error


def _clean(text: str | None) -> str | None:
    cleaned = " ".join((text or "").split())
    return cleaned or None


def _collect(entries, videos: dict[str, dict]) -> dict[str, dict]:
    for entry in entries or []:
        if entry is None:
            continue
        if entry.get("_type") == "playlist":
            _collect(entry.get("entries"), videos)
        elif url := entry.get("url") or entry.get("webpage_url"):
            videos.setdefault(
                url,
                {
                    "url": url,
                    "id": str(entry.get("id") or url),
                    "title": entry.get("title"),
                    "durationSec": entry.get("duration"),
                    "channel": _clean(entry.get("channel") or entry.get("uploader")),
                },
            )
    return videos


def _videos(entries) -> list[dict]:
    return list(_collect(entries, {}).values())


def _flat(target: str, limit: int | None) -> dict:
    settings = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
        "js_runtimes": {"node": {}},
        "cachedir": str(paths.atom_dir("find-url", "yt-dlp")),
    }
    if limit:
        settings["playlistend"] = limit
    try:
        with yt_dlp.YoutubeDL(settings) as ydl:
            return ydl.extract_info(target, download=False)
    except yt_dlp.utils.YoutubeDLError as e:
        raise atom_error(e) from None


def _check_limit(limit: int | None) -> None:
    if limit is not None and limit < 1:
        raise cli.AtomError("invalid_args", f"--limit must be 1 or more, not {limit}.")


def search(words: str, limit: int, site: str) -> dict:
    _check_limit(limit)
    if not words.strip():
        raise cli.AtomError("invalid_args", "Pass search words.")
    info = _flat(f"{site}{limit}:{words}", limit)
    return {"source": words, "items": _videos(info.get("entries"))[:limit], "cacheHit": False}


def list_(url: str, limit: int | None) -> dict:
    _check_limit(limit)
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise cli.AtomError("invalid_source", f"Not an http or https URL: {url}")
    info = _flat(url, limit)
    if info.get("_type") != "playlist":
        raise cli.AtomError("invalid_source", f"One video, not a playlist or channel: {url}")
    return {"source": url, "items": _videos(info.get("entries"))[:limit], "cacheHit": False}


def parse(path: str) -> dict:
    try:
        info = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
        items = _videos(info["entries"])
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as e:
        raise cli.AtomError("invalid_source", f"Not a yt-dlp flat playlist file: {path}: {e}")
    return {"source": info.get("webpage_url") or info.get("title") or path, "items": items, "cacheHit": False}


def _text(result: dict) -> str:
    return "\n".join(item["url"] for item in result["items"])


if __name__ == "__main__":
    cli.main(
        Path(__file__).resolve().parent.parent,
        {"search": cli.Verb(search, _text), "list": cli.Verb(list_, _text), "parse": cli.Verb(parse, _text)},
    )
