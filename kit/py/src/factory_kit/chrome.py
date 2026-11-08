import re

from playwright.sync_api import Error as PlaywrightError

from .cli import AtomError

ARGS = ["--enable-experimental-web-platform-features", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--use-angle=metal"]
VIEWPORT = {"width": 1440, "height": 900}
LOAD_MS = 60_000
CHALLENGE_TITLE = re.compile(r"security checkpoint|just a moment|attention required|verify you are human|access denied", re.I)
CHALLENGE_SELECTORS = "#challenge-form, #cf-challenge-running, iframe[src*='challenges.cloudflare.com'], iframe[src*='hcaptcha.com'], iframe[src*='recaptcha']"


def launch(playwright):
    try:
        return playwright.chromium.launch(headless=True, channel="chrome", args=ARGS)
    except PlaywrightError as e:
        raise AtomError("missing_browser", f"Google Chrome did not start: {e.message.splitlines()[0]}") from None


def goto(page, url: str):
    try:
        return page.goto(url, wait_until="domcontentloaded", timeout=LOAD_MS)
    except PlaywrightError as e:
        raise AtomError("network_error", f"{url} did not load: {e.message.splitlines()[0]}") from None


def _bot_check(page, response) -> str | None:
    title = page.title()
    if CHALLENGE_TITLE.search(title):
        return f"the page title is {title!r}"
    if response and response.headers.get("cf-mitigated") == "challenge":
        return "Cloudflare answered with a challenge"
    if page.locator(CHALLENGE_SELECTORS).count():
        return "the page shows a challenge form"
    return None


def refuse_bot_check(page, response, url: str, atom: str) -> None:
    if reason := _bot_check(page, response):
        raise AtomError("blocked", f"{url} shows a bot check ({reason}). {atom} never tries to get past one.")
