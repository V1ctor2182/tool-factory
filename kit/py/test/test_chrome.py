from types import SimpleNamespace

import pytest
from playwright.sync_api import Error as PlaywrightError

from factory_kit import chrome
from factory_kit.cli import AtomError


def _fails(*args, **kwargs):
    raise PlaywrightError("no such channel\nmore detail")


def test_a_failed_start_reports_a_missing_browser():
    playwright = SimpleNamespace(chromium=SimpleNamespace(launch=_fails))
    with pytest.raises(AtomError) as raised:
        chrome.launch(playwright)
    assert raised.value.code == "missing_browser"
    assert str(raised.value) == "Google Chrome did not start: no such channel"


def test_a_failed_load_reports_a_network_error():
    with pytest.raises(AtomError) as raised:
        chrome.goto(SimpleNamespace(goto=_fails), "https://example.test")
    assert raised.value.code == "network_error"
    assert str(raised.value) == "https://example.test did not load: no such channel"


def test_a_load_returns_the_response():
    page = SimpleNamespace(goto=lambda url, wait_until, timeout: (url, wait_until, timeout))
    assert chrome.goto(page, "https://example.test") == ("https://example.test", "domcontentloaded", 60_000)


def _page(title="Shop", forms=0):
    return SimpleNamespace(title=lambda: title, locator=lambda selector: SimpleNamespace(count=lambda: forms))


def _response(headers):
    return SimpleNamespace(headers=headers)


@pytest.mark.parametrize(
    ("page", "response", "reason"),
    [
        (_page(title="Just a moment..."), None, "the page title is 'Just a moment...'"),
        (_page(), _response({"cf-mitigated": "challenge"}), "Cloudflare answered with a challenge"),
        (_page(forms=1), _response({}), "the page shows a challenge form"),
    ],
)
def test_a_bot_check_is_refused_with_its_reason(page, response, reason):
    with pytest.raises(AtomError) as raised:
        chrome.refuse_bot_check(page, response, "https://example.test", "page-links")
    assert raised.value.code == "blocked"
    assert str(raised.value) == f"https://example.test shows a bot check ({reason}). page-links never tries to get past one."


@pytest.mark.parametrize("response", [_response({}), None])
def test_a_plain_page_passes(response):
    chrome.refuse_bot_check(_page(), response, "https://example.test", "page-links")
