from yt_dlp.networking.exceptions import HTTPError, TransportError

from .cli import AtomError


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
