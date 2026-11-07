import pytest
import yt_dlp

from factory_kit import ytdlp
from factory_kit.ytdlp import atom_error


def failure(url: str):
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
        try:
            ydl.extract_info(url, download=False)
        except yt_dlp.utils.YoutubeDLError as e:
            return atom_error(e)
    pytest.fail(f"{url} extracted")


@pytest.mark.parametrize(
    ("path", "code"),
    [("/missing.json", "unavailable"), ("/limited.json", "rate_limited"), ("/page.html", "invalid_source")],
)
def test_maps_failures_to_error_codes(server, path, code):
    assert failure(f"{server}{path}").code == code


def test_reports_an_unreachable_host():
    assert failure("http://127.0.0.1:9/clip").code == "network_error"


def test_finds_a_cache_key_without_the_network():
    assert ytdlp.offline_key("https://www.youtube.com/watch?v=jNQXAC9IVRw") == "Youtube-jNQXAC9IVRw"
