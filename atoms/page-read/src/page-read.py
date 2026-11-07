# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "playwright==1.63.0"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
from pathlib import Path

from factory_kit import cli
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

ARGS = ["--enable-experimental-web-platform-features", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--use-angle=metal"]
VIEWPORT = {"width": 1440, "height": 900}
LOAD_MS = 60_000
CONSOLE_CHARS = 300
CONSOLE_LINES = 40
READ_JS = (Path(__file__).parent / "read.js").read_text(encoding="utf-8")


def facts(url: str, loadMs: int) -> dict:
    console, errors = [], []
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(headless=True, channel="chrome", args=ARGS)
        except PlaywrightError as e:
            raise cli.AtomError("missing_browser", f"Google Chrome did not start: {e.message.splitlines()[0]}") from None
        try:
            page = browser.new_page(viewport=VIEWPORT, service_workers="block")
            page.on("console", lambda m: len(console) < CONSOLE_LINES and console.append(m.text[:CONSOLE_CHARS]))
            page.on("pageerror", lambda e: errors.append(str(e)[:CONSOLE_CHARS]))
            try:
                response = page.goto(url, wait_until="domcontentloaded", timeout=LOAD_MS)
            except PlaywrightError as e:
                raise cli.AtomError("network_error", f"{url} did not load: {e.message.splitlines()[0]}") from None
            page.wait_for_timeout(loadMs)
            read = page.evaluate(READ_JS)
            trial = bool(response and "origin-trial" in response.headers)
        finally:
            browser.close()
    return {"url": url, "viewport": [VIEWPORT["width"], VIEWPORT["height"]], "console": console, "errors": errors, "originTrial": trial, **read}


def _text(r: dict) -> str:
    safe = sum(t["safe"] for t in r["targets"])
    return "\n".join([
        f"{r['title']}: {r['scrollHeight']:.0f} px tall, {len(r['sections'])} sections, {len(r['canvases'])} canvases",
        f"animations: {r['animations']['scrollDriven']} scroll-driven, {r['animations']['clock']} on the clock",
        f"targets: {len(r['targets'])}, {safe} safe to click",
        f"errors: {len(r['errors'])}",
    ])


if __name__ == "__main__":
    cli.main(Path(__file__).resolve().parent.parent, {"facts": cli.Verb(facts, _text)})
