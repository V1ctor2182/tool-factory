from contextlib import contextmanager
from typing import Callable
from urllib.parse import urlparse

import yt_dlp
from yt_dlp.extractor import gen_extractor_classes
from yt_dlp.networking.exceptions import TransportError

from .cache import Cache
from .cli import AtomError


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


def _atom_error(e: Exception) -> AtomError:
    seen, cause = set(), e
    while cause is not None and id(cause) not in seen:
        if isinstance(cause, TransportError):
            return AtomError("network_error", str(cause))
        seen.add(id(cause))
        cause = _next_cause(cause)
    message = str(e).removeprefix("ERROR: ")
    if "Unsupported URL" in message:
        return AtomError("invalid_source", message)
    return AtomError("unavailable", message)


@contextmanager
def _errors():
    try:
        yield
    except yt_dlp.utils.YoutubeDLError as e:
        raise _atom_error(e) from None


def cached(
    cache: Cache,
    url: str,
    variant: str,
    fetch: Callable[[yt_dlp.YoutubeDL, dict], dict],
    usable: Callable[[dict], bool] = lambda value: True,
    process: bool = True,
    **options,
) -> dict:
    # Most extractors read the video id from the URL itself, so a cache hit usually needs no network.
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise AtomError("invalid_source", f"Not an http or https URL: {url}")

    def hit(key: str) -> dict | None:
        value = cache.get(f"{key}-{variant}")
        return {**value, "source": url} if value and usable(value) else None

    if (key := _offline_key(url)) and (value := hit(key)):
        return value
    settings = {
        "quiet": True,
        "noprogress": True,
        "noplaylist": True,
        "extract_flat": "in_playlist",
        # Without a JS runtime, YouTube hides most formats and some videos.
        "js_runtimes": {"node": {}},
        **options,
    }
    with _errors(), yt_dlp.YoutubeDL(settings) as ydl:
        info = ydl.extract_info(url, download=False, process=process)
        if info.get("_type") == "playlist":
            raise AtomError("invalid_source", f"A playlist, not one video: {url}")
        key = f"{info['extractor_key']}-{info['id']}"
        if value := hit(key):
            return value
        value = fetch(ydl, info)
    cache.put(f"{key}-{variant}", value)
    return value
