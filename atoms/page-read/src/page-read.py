# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "playwright==1.63.0"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
from pathlib import Path

from factory_kit import chrome, cli
from playwright.sync_api import sync_playwright

CONSOLE_CHARS = 300
CONSOLE_LINES = 40
READ_JS = (Path(__file__).parent / "read.js").read_text(encoding="utf-8")


def facts(url: str, loadMs: int) -> dict:
    console, errors = [], []
    with sync_playwright() as p:
        browser = chrome.launch(p)
        try:
            page = browser.new_page(viewport=chrome.VIEWPORT, service_workers="block")
            page.on("console", lambda m: len(console) < CONSOLE_LINES and console.append(m.text[:CONSOLE_CHARS]))
            page.on("pageerror", lambda e: errors.append(str(e)[:CONSOLE_CHARS]))
            response = chrome.goto(page, url)
            page.wait_for_timeout(loadMs)
            read = page.evaluate(READ_JS)
            trial = bool(response and "origin-trial" in response.headers)
        finally:
            browser.close()
    return {"url": url, "viewport": [chrome.VIEWPORT["width"], chrome.VIEWPORT["height"]], "console": console, "errors": errors, "originTrial": trial, **read}


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
