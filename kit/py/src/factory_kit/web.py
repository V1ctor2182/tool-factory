import json
import urllib.error
import urllib.request
from urllib.parse import urlparse

from .cli import AtomError

TIMEOUT_SEC = 30


def check_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise AtomError("invalid_source", f"Not an http or https URL: {url}")


def get_bytes(url: str, atom: str, accept: str = "*/*", none_on: tuple[int, ...] = ()) -> bytes | None:
    """Returns None when the site answers a status in none_on, an answer the caller expects rather than a failure."""
    check_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": f"tool-factory/{atom}", "Accept": accept})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SEC) as response:
            return response.read()
    except urllib.error.HTTPError as e:
        if e.code in none_on:
            return None
        raise AtomError("rate_limited" if e.code == 429 else "unavailable", f"HTTP {e.code} from {url}") from None
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        raise AtomError("network_error", f"{url}: {getattr(e, 'reason', e)}") from None


def get_json(url: str, atom: str, none_on: tuple[int, ...] = ()):
    body = get_bytes(url, atom, "application/json", none_on)
    if body is None:
        return None
    try:
        return json.loads(body)
    except ValueError:
        raise AtomError("invalid_source", f"Not JSON: {url}") from None
