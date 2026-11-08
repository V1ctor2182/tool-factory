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


def test_video_key_names_the_extractor_and_refuses_a_playlist():
    assert ytdlp.video_key({"extractor_key": "Youtube", "id": "abc"}, "u") == "Youtube-abc"
    with pytest.raises(ytdlp.AtomError) as e:
        ytdlp.video_key({"_type": "playlist"}, "https://example.test/p")
    assert (e.value.code, str(e.value)) == ("invalid_source", "A playlist, not one video: https://example.test/p")
