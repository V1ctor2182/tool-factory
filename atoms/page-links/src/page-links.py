# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "playwright==1.63.0"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import re
from pathlib import Path
from urllib.parse import urldefrag, urlparse

from factory_kit import cli
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

LOAD_MS = 45_000
CONTEXT = {"viewport": {"width": 1280, "height": 800}, "locale": "en-US", "timezone_id": "UTC", "service_workers": "block"}
CHALLENGE_TITLE = re.compile(r"security checkpoint|just a moment|attention required|verify you are human|access denied", re.I)
CHALLENGE_SELECTORS = "#challenge-form, #cf-challenge-running, iframe[src*='challenges.cloudflare.com'], iframe[src*='hcaptcha.com'], iframe[src*='recaptcha']"
LINKS_JS = "els => els.map(a => [a.href, (a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim()])"


def _blocked(page, response) -> str | None:
    title = page.title()
    if CHALLENGE_TITLE.search(title):
        return f"the page title is {title!r}"
    if response and response.headers.get("cf-mitigated") == "challenge":
        return "Cloudflare answered with a challenge"
    if page.locator(CHALLENGE_SELECTORS).count():
        return "the page shows a challenge form"
    return None


def _origin(url: str) -> tuple[str, str]:
    parsed = urlparse(url)
    return parsed.scheme, parsed.netloc


def _read(url: str) -> tuple[str, list[list[str]]]:
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except PlaywrightError as e:
            raise cli.AtomError("unavailable", f"Headless Chromium is missing. Run: uv run --with playwright==1.63.0 playwright install chromium ({e.message.splitlines()[0]})") from None
        try:
            page = browser.new_context(**CONTEXT).new_page()
            try:
                response = page.goto(url, wait_until="networkidle", timeout=LOAD_MS)
            except PlaywrightTimeout:
                raise cli.AtomError("network_error", f"{url} did not go network idle within {LOAD_MS // 1000}s") from None
            except PlaywrightError as e:
                raise cli.AtomError("network_error", f"{url}: {e.message.splitlines()[0]}") from None
            if reason := _blocked(page, response):
                raise cli.AtomError("blocked", f"{url} shows a bot check ({reason}). page-links never tries to get past one.")
            if response and response.status == 429:
                raise cli.AtomError("rate_limited", f"{url} answered HTTP 429")
            if response and response.status >= 400:
                raise cli.AtomError("unavailable", f"{url} answered HTTP {response.status}")
            return page.url, page.eval_on_selector_all("a[href]", LINKS_JS)
        finally:
            browser.close()


def list_links(url: str, match: str | None = None) -> dict:
    if urlparse(url).scheme not in ("http", "https", "file"):
        raise cli.AtomError("invalid_source", f"Not an http, https, or file URL: {url}")
    try:
        pattern = re.compile(match) if match else None
    except re.error as e:
        raise cli.AtomError("invalid_args", f"--match is not a regular expression: {e}") from None
    landed, links = _read(url)
    items: dict[str, dict] = {}
    for href, text in links:
        link = urldefrag(href).url
        if _origin(link) != _origin(landed) or (pattern and not pattern.search(urlparse(link).path)):
            continue
        items.setdefault(link, {"url": link, "text": text})
    return {"source": url, "items": list(items.values()), "cacheHit": False}


def _text(result: dict) -> str:
    return "\n".join(item["url"] for item in result["items"])


if __name__ == "__main__":
    cli.main(Path(__file__).resolve().parent.parent, {"list": cli.Verb(list_links, _text)})
