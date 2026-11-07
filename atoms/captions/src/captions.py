# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "yt-dlp[default]"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import json
from pathlib import Path

import yt_dlp

from factory_kit import cli, paths, web
from factory_kit.cache import Cache
from factory_kit.hash import file_sha256
from factory_kit.ytdlp import atom_error, offline_key, video_key


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
    web.check_url(url)
    cache = Cache("captions")

    def hit(key: str) -> dict | None:
        value = cache.get(f"{key}-{lang}")
        return {**value, "source": url} if value else None

    if (key := offline_key(url)) and (value := hit(key)):
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
            while info.get("_type") in ("url", "url_transparent"):
                info = ydl.extract_info(info["url"], ie_key=info.get("ie_key"), download=False, process=False)
            key = video_key(info, url)
            if value := hit(key):
                return value
            track = _json3_url(info, lang)
            if track is None:
                raise cli.AtomError("no_captions", f"No {lang} captions for {url}")
            transcript = _transcript(url, lang, json.loads(ydl.urlopen(track).read()))
    except yt_dlp.utils.YoutubeDLError as e:
        raise atom_error(e) from None
    cache.put(f"{key}-{lang}", transcript)
    return transcript


def parse(path: str, lang: str) -> dict:
    file = cli.existing_file(path)
    key = f"json3-{file_sha256(file)}-{lang}"
    cache = Cache("captions")
    if cached := cache.get(key):
        return {**cached, "source": str(file)}
    json3 = cli.read_json(path, "invalid_source", f"Not a readable json3 file: {path}")
    try:
        transcript = _transcript(str(file), lang, json3)
    except (AttributeError, KeyError, TypeError) as e:
        raise cli.AtomError("invalid_source", f"Not json3 captions, an object whose events have tStartMs: {path}: {e!r}")
    cache.put(key, transcript)
    return transcript


if __name__ == "__main__":
    cli.main(
        Path(__file__).resolve().parent.parent,
        {"get": cli.Verb(get), "parse": cli.Verb(parse)},
    )
