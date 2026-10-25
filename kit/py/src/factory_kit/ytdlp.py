import sys
from contextlib import contextmanager
from urllib.parse import urlparse

import yt_dlp
from yt_dlp.extractor import gen_extractor_classes
from yt_dlp.networking.exceptions import TransportError

from .cli import AtomError


class _StderrLogger:
    def debug(self, msg):
        pass

    def warning(self, msg):
        print(msg, file=sys.stderr)

    error = warning


def client(**options) -> yt_dlp.YoutubeDL:
    return yt_dlp.YoutubeDL(
        {
            "quiet": True,
            "noprogress": True,
            "noplaylist": True,
            "extract_flat": "in_playlist",
            "logger": _StderrLogger(),
            # Without a JS runtime, YouTube hides most formats and some videos.
            "js_runtimes": {"node": {}},
            **options,
        }
    )


def check_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise AtomError("invalid_source", f"Not an http or https URL: {url}")


def offline_key(url: str) -> str | None:
    """The cache key for a URL whose extractor reads the video id from the URL itself, so a cache hit needs no network."""
    for ie in gen_extractor_classes():
        if ie.suitable(url):
            video_id = ie.get_temp_id(url)
            return f"{ie.ie_key()}-{video_id}" if video_id else None
    return None


def video_key(info: dict) -> str:
    if info.get("_type") == "playlist":
        raise AtomError("invalid_source", f"A playlist, not one video: {info.get('webpage_url')}")
    return f"{info['extractor_key']}-{info['id']}"


def _atom_error(e: Exception) -> AtomError:
    seen, cause = set(), e
    while cause is not None and id(cause) not in seen:
        if isinstance(cause, TransportError):
            return AtomError("network_error", str(cause))
        seen.add(id(cause))
        cause = getattr(cause, "cause", None) or (getattr(cause, "exc_info", None) or (None, None))[1] or cause.__context__
    message = str(e).removeprefix("ERROR: ")
    if "Unsupported URL" in message:
        return AtomError("invalid_source", message)
    return AtomError("unavailable", message)


@contextmanager
def errors():
    try:
        yield
    except yt_dlp.utils.YoutubeDLError as e:
        raise _atom_error(e) from None
