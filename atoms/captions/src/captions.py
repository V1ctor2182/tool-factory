# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit[ytdlp]"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import json
from pathlib import Path

from factory_kit import cli, ytdlp
from factory_kit.cache import Cache


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
        "cacheHit": False,
    }


def get(url: str, lang: str) -> dict:
    ytdlp.check_url(url)
    cache = Cache("captions")
    key = ytdlp.offline_key(url)
    if key and (cached := cache.get(f"{key}-{lang}")):
        return {**cached, "source": url, "cacheHit": True}

    with ytdlp.errors(), ytdlp.client(skip_download=True) as ydl:
        info = ydl.extract_info(url, download=False)
        key = ytdlp.video_key(info)
        if cached := cache.get(f"{key}-{lang}"):
            return {**cached, "source": url, "cacheHit": True}
        track = _json3_url(info, lang)
        if track is None:
            raise cli.AtomError("no_captions", f"No {lang} captions for {url}")
        json3 = json.loads(ydl.urlopen(track).read())

    transcript = _transcript(url, lang, json3)
    cache.put(f"{key}-{lang}", transcript)
    return transcript


def parse(path: str, lang: str) -> dict:
    file = Path(path).expanduser().resolve()
    try:
        json3 = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise cli.AtomError("invalid_source", f"Not a readable json3 file: {path}: {e}")
    return _transcript(str(file), lang, json3)


if __name__ == "__main__":
    cli.main(
        Path(__file__).resolve().parent.parent,
        {"get": cli.Verb(get, lambda t: t["text"]), "parse": cli.Verb(parse, lambda t: t["text"])},
    )
