# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "yt-dlp[default]"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
from pathlib import Path
from urllib.parse import urlparse

import yt_dlp
from yt_dlp.extractor import gen_extractor_classes
from yt_dlp.networking.exceptions import TransportError

from factory_kit import cli, paths
from factory_kit.cache import Cache

# Single-file formats only, so no download needs ffmpeg to merge streams.
FORMATS = {"audio": "bestaudio[ext=m4a]/bestaudio/best", "video": "best[ext=mp4]/best"}


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


def get(url: str, audio: bool, video: bool) -> dict:
    if audio and video:
        raise cli.AtomError("invalid_args", "Pass --audio or --video, not both.")
    kind = "video" if video else "audio"
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise cli.AtomError("invalid_source", f"Not an http or https URL: {url}")
    cache = Cache("download")

    def hit(key: str) -> dict | None:
        media = cache.get(f"{key}-{kind}")
        return {**media, "source": url} if media and Path(media["path"]).is_file() else None

    if (key := _offline_key(url)) and (media := hit(key)):
        return media
    settings = {
        "quiet": True,
        "noprogress": True,
        "noplaylist": True,
        "extract_flat": "in_playlist",
        # Without a JS runtime, YouTube hides most formats and some videos.
        "js_runtimes": {"node": {}},
        "format": FORMATS[kind],
        "paths": {"home": str(paths.atom_dir("download", "files")), "temp": str(paths.atom_dir("download", "tmp"))},
        "outtmpl": f"%(extractor_key)s-%(id)s-{kind}.%(ext)s",
    }
    try:
        with yt_dlp.YoutubeDL(settings) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get("_type") == "playlist":
                raise cli.AtomError("invalid_source", f"A playlist, not one video: {url}")
            key = f"{info['extractor_key']}-{info['id']}"
            if media := hit(key):
                return media
            info = ydl.process_ie_result(info, download=True)
    except yt_dlp.utils.YoutubeDLError as e:
        raise _atom_error(e) from None
    path = info["requested_downloads"][0]["filepath"]
    media = {
        "source": url,
        "path": path,
        "kind": kind,
        "extractor": info["extractor_key"],
        "id": info["id"],
        "title": info.get("title"),
        "durationSec": info.get("duration"),
    }
    cache.put(f"{key}-{kind}", media)
    return media


if __name__ == "__main__":
    cli.main(Path(__file__).resolve().parent.parent, {"get": cli.Verb(get, lambda media: media["path"])})
