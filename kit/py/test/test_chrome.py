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
