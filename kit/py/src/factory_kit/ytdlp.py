from yt_dlp.extractor import gen_extractor_classes
from yt_dlp.networking.exceptions import HTTPError, TransportError

from .cli import AtomError


def offline_key(url: str) -> str | None:
    for ie in gen_extractor_classes():
        if ie.suitable(url):
            video_id = ie.get_temp_id(url)
            return f"{ie.ie_key()}-{video_id}" if video_id else None
    return None


def video_key(info: dict, url: str) -> str:
    if info.get("_type") == "playlist":
        raise AtomError("invalid_source", f"A playlist, not one video: {url}")
    return f"{info['extractor_key']}-{info['id']}"


def _next_cause(e: BaseException) -> BaseException | None:
    if cause := getattr(e, "cause", None):
        return cause
    if exc_info := getattr(e, "exc_info", None):
        return exc_info[1]
    return e.__context__


def atom_error(e: Exception) -> AtomError:
    seen, cause = set(), e
    while cause is not None and id(cause) not in seen:
        if isinstance(cause, TransportError):
            return AtomError("network_error", str(cause))
        if isinstance(cause, HTTPError) and cause.status == 429:
            return AtomError("rate_limited", str(cause))
        seen.add(id(cause))
        cause = _next_cause(cause)
    message = str(e).removeprefix("ERROR: ")
    if "Unsupported URL" in message:
        return AtomError("invalid_source", message)
    return AtomError("unavailable", message)
