from playwright.sync_api import Error as PlaywrightError

from .cli import AtomError

ARGS = ["--enable-experimental-web-platform-features", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--use-angle=metal"]
VIEWPORT = {"width": 1440, "height": 900}
LOAD_MS = 60_000


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
