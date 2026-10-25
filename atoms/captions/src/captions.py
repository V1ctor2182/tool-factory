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
from yt_dlp.extractor import gen_extractor_classes
from yt_dlp.networking.exceptions import TransportError

from factory_kit import cli, paths
from factory_kit.cache import Cache
from factory_kit.hash import file_sha256


def _offline_key(url: str) -> str | None:
    for ie in gen_extractor_classes():
        if ie.suitable(url):
            video_id = ie.get_temp_id(url)
            return f"{ie.ie_key()}-{video_id}" if video_id else None
    return None


def _next_cause(e: BaseException) -> BaseException | None:
    if cause := getattr(e, "cause", None):
        return cause
    if exc_info := getattr(e, "exc_info", None):
        return exc_info[1]
    return e.__context__


def _atom_error(e: Exception) -> cli.AtomError:
    seen, cause = set(), e
    while cause is not None and id(cause) not in seen:
        if isinstance(cause, TransportError):
            return cli.AtomError("network_error", str(cause))
        seen.add(id(cause))
        cause = _next_cause(cause)
    message = str(e).removeprefix("ERROR: ")
    if "Unsupported URL" in message:
        return cli.AtomError("invalid_source", message)
    return cli.AtomError("unavailable", message)


def _json3_url(info: dict, lang: str) -> str | None:
    for kind in ("subtitles", "automatic_captions"):
        for track in (info.get(kind) or {}).get(lang, []):
            if track.get("ext") == "json3":
                return track["url"]
    return None


def _transcript(source: str, lang: str, json3: dict) -> dict:
    segments = []
    for event in json3.get("events", []):
        text = " ".join("".join(seg.get("utf8", "") for seg in event.get("segs", [])).split())
        if text:
            start = event["tStartMs"] / 1000
            end = start + event.get("dDurationMs", 0) / 1000
            segments.append({"start": round(start, 2), "end": round(end, 2), "text": text})
    return {
        "source": source,
        "method": "captions",
        "language": lang,
        "model": None,
        "text": " ".join(s["text"] for s in segments),
        "segments": segments,
    }


def get(url: str, lang: str) -> dict:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise cli.AtomError("invalid_source", f"Not an http or https URL: {url}")
    cache = Cache("captions")

    def hit(key: str) -> dict | None:
        value = cache.get(f"{key}-{lang}")
        return {**value, "source": url} if value else None

    if (key := _offline_key(url)) and (value := hit(key)):
        return value
    settings = {
        "quiet": True,
        "noprogress": True,
        "noplaylist": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
        # Without a JS runtime, YouTube hides most formats and some videos.
        "js_runtimes": {"node": {}},
        "cachedir": str(paths.atom_dir("captions", "yt-dlp")),
    }
    try:
        with yt_dlp.YoutubeDL(settings) as ydl:
            info = ydl.extract_info(url, download=False, process=False)
            if info.get("_type") == "playlist":
                raise cli.AtomError("invalid_source", f"A playlist, not one video: {url}")
            key = f"{info['extractor_key']}-{info['id']}"
            if value := hit(key):
                return value
            track = _json3_url(info, lang)
            if track is None:
                raise cli.AtomError("no_captions", f"No {lang} captions for {url}")
            transcript = _transcript(url, lang, json.loads(ydl.urlopen(track).read()))
    except yt_dlp.utils.YoutubeDLError as e:
        raise _atom_error(e) from None
    cache.put(f"{key}-{lang}", transcript)
    return transcript


def parse(path: str, lang: str) -> dict:
    file = Path(path).expanduser().resolve()
    if not file.is_file():
        raise cli.AtomError("invalid_source", f"No such file: {path}")
    key = f"json3-{file_sha256(file)}-{lang}"
    cache = Cache("captions")
    if cached := cache.get(key):
        return {**cached, "source": str(file)}
    try:
        json3 = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise cli.AtomError("invalid_source", f"Not a readable json3 file: {path}: {e}")
    transcript = _transcript(str(file), lang, json3)
    cache.put(key, transcript)
    return transcript


if __name__ == "__main__":
    cli.main(
        Path(__file__).resolve().parent.parent,
        {"get": cli.Verb(get), "parse": cli.Verb(parse)},
    )
