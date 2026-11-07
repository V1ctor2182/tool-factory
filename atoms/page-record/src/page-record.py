# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "playwright==1.63.0", "jsonschema>=4.18"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import json
import re
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path

from factory_kit import cli, paths, schema
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
STEPS_SCHEMA = json.loads((HERE.parents[2] / "contracts" / "page-steps.schema.json").read_text(encoding="utf-8"))
PAGE_JS = (HERE / "page.js").read_text(encoding="utf-8")

EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)
LOAD_MS = 30_000
LOAD_VIRTUAL_MS = 10_000
STALL_S = 20
SETTLE_STEP_MS = 100
SETTLE_CAP_MS = 5_000
MARGIN_PX = 8
# Without these, transform and opacity animations run on the compositor thread on real time, outside the virtual clock.
CHROMIUM_ARGS = ["--disable-threaded-animation", "--disable-threaded-scrolling", "--run-all-compositor-stages-before-draw", "--disable-checker-imaging"]
CONTEXT = {"device_scale_factor": 2, "locale": "en-US", "timezone_id": "UTC", "reduced_motion": "no-preference", "service_workers": "block"}

CHALLENGE_TITLE = re.compile(r"security checkpoint|just a moment|attention required|verify you are human|access denied", re.I)
CHALLENGE_SELECTORS = "#challenge-form, #cf-challenge-running, iframe[src*='challenges.cloudflare.com'], iframe[src*='hcaptcha.com'], iframe[src*='recaptcha']"


def _steps(path: str) -> dict:
    steps = cli.read_json(path, "invalid_args", f"Cannot read steps file {path}")
    schema.check(steps, STEPS_SCHEMA, "invalid_args", f"{path} is not a page-steps file")
    return {"target": "body", "viewport": {"width": 1280, "height": 800}, "colorScheme": "dark", **steps}


class Session:
    """One page on Chromium's virtual clock. Timers, frames, performance.now, Date, and the animation timeline all move only when advance says so."""

    def __init__(self, page, target: str):
        self.page = page
        self.target = target
        self.seen: dict[str, dict] = {}
        self.cdp = page.context.new_cdp_session(page)
        self.expired = 0
        self.cdp.on("Emulation.virtualTimeBudgetExpired", lambda _: setattr(self, "expired", self.expired + 1))

    def js(self, call: str, *args):
        return self.page.evaluate(f"(args) => window.__uiRecord.{call}(...args)", list(args))

    def run(self, ms: int):
        # Virtual time stands still while a request is in flight, so network speed never changes what a frame shows.
        before = self.expired
        self.cdp.send("Emulation.setVirtualTimePolicy", {"policy": "pauseIfNetworkFetchesPending", "budget": ms})
        deadline = time.monotonic() + STALL_S
        while self.expired == before:
            if time.monotonic() > deadline:
                raise cli.AtomError("network_error", f"{self.page.url} kept a request open for {STALL_S}s, so page time could not advance")
            self.page.wait_for_timeout(5)

    def advance(self, ms: int):
        self.collect()
        self.run(ms)
        self.js("drive")
        self.collect()

    def settle(self):
        elapsed = 0
        while True:
            self.advance(SETTLE_STEP_MS)
            elapsed += SETTLE_STEP_MS
            if elapsed >= SETTLE_CAP_MS or not self.js("unsettled"):
                break

    def collect(self):
        for a in self.js("animations", self.target):
            self.seen.setdefault(json.dumps(a, sort_keys=True), a)

    def screenshot(self, path: Path) -> str:
        self.page.screenshot(path=path, clip=self.js("box", self.target, MARGIN_PX), caret="hide")
        return str(path)

    def locate(self, selector: str, where: str):
        loc = self.page.locator(selector).first
        if not loc.count():
            raise cli.AtomError("invalid_source", f"{where}: no element matches {selector!r}")
        return loc


def _on(s: Session, a: dict, where: str):
    return s.locate(a["selector"], where) if "selector" in a else None


def _paste(s: Session, a: dict, where: str):
    if "selector" in a:
        _on(s, a, where).focus()
    if s.js("paste", a["text"]):
        s.page.keyboard.insert_text(a["text"])


ACTIONS = {
    "hover": lambda s, a, w: _on(s, a, w).hover(),
    "click": lambda s, a, w: _on(s, a, w).click(),
    "focus": lambda s, a, w: _on(s, a, w).focus(),
    "scroll": lambda s, a, w: _on(s, a, w).scroll_into_view_if_needed(),
    "type": lambda s, a, w: _on(s, a, w).press_sequentially(a["text"]) if "selector" in a else s.page.keyboard.type(a["text"]),
    "press": lambda s, a, w: _on(s, a, w).press(a["key"]) if "selector" in a else s.page.keyboard.press(a["key"]),
    "paste": _paste,
    "wait": lambda s, a, w: s.advance(a["ms"]),
}


def _blocked(page, response) -> str | None:
    title = page.title()
    if CHALLENGE_TITLE.search(title):
        return f"the page title is {title!r}"
    if response and response.headers.get("cf-mitigated") == "challenge":
        return "Cloudflare answered with a challenge"
    if page.locator(CHALLENGE_SELECTORS).count():
        return "the page shows a challenge form"
    return None


def _load(s: Session, url: str):
    s.cdp.send("Emulation.setVirtualTimePolicy", {"policy": "pause", "initialVirtualTime": EPOCH.timestamp()})
    try:
        response = s.page.goto(url, wait_until="commit", timeout=LOAD_MS)
    except PlaywrightTimeout:
        raise cli.AtomError("network_error", f"{url} did not answer within {LOAD_MS // 1000}s") from None
    except PlaywrightError as e:
        raise cli.AtomError("network_error", f"{url}: {e.message.splitlines()[0]}") from None
    s.run(LOAD_VIRTUAL_MS)
    reason = _blocked(s.page, response)
    if reason:
        raise cli.AtomError("blocked", f"{url} shows a bot check ({reason}). page-record never tries to get past one.")
    if response and response.status >= 400:
        raise cli.AtomError("unavailable", f"{url} answered HTTP {response.status}")
    if s.page.evaluate("document.readyState") != "complete":
        raise cli.AtomError("network_error", f"{url} did not finish loading within {LOAD_VIRTUAL_MS // 1000}s of page time")


def _slug(i: int, name: str) -> str:
    return f"{i:02d}-" + (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "state")


def _tracks(samples: list[dict]) -> dict:
    # Main-thread motion, such as a spring writing style.transform each frame, never appears in getAnimations(), so the computed values are the only record of it.
    tracks: dict[str, dict] = {}
    for path in samples[0] if samples else {}:
        for prop in ("transform", "opacity"):
            values = [sample.get(path, {}).get(prop) for sample in samples]
            if len(set(values)) > 1:
                tracks.setdefault(path, {})[prop] = values
    return tracks


def _record(page, steps: dict, url: str, out: Path) -> list[dict]:
    page.add_init_script(PAGE_JS)
    s = Session(page, steps["target"])
    _load(s, url)
    s.page.evaluate("document.fonts.ready.then(() => true)")
    s.locate(s.target, "target")

    states = []
    for i, state in enumerate(steps["states"]):
        slug = _slug(i, state["name"])
        s.seen = {}
        for j, action in enumerate(state["actions"]):
            ACTIONS[action["do"]](s, action, f"state {state['name']!r} action {j} ({action['do']})")
        s.js("drive")
        s.collect()
        frames, samples, every = [], [], None
        if "frames" in state:
            every, total = state["frames"]["everyMs"], state["frames"]["forMs"]
            for k in range(-(-total // every)):
                if k:
                    s.advance(every)
                frames.append(s.screenshot(out / f"{slug}-f{k:03d}.png"))
                samples.append(s.js("motion", s.target))
        (out / f"{slug}.motion.json").write_text(json.dumps({"everyMs": every, "tracks": _tracks(samples)}, indent=2), encoding="utf-8")
        s.settle()
        s.locate(s.target, f"state {state['name']!r}, after its actions settled, the target")
        (out / f"{slug}.dom.html").write_text(s.js("dom", s.target), encoding="utf-8")
        (out / f"{slug}.styles.json").write_text(json.dumps(s.js("styles", s.target), indent=2), encoding="utf-8")
        states.append({
            "name": state["name"],
            "screenshot": s.screenshot(out / f"{slug}.png"),
            "frames": frames,
            "dom": str(out / f"{slug}.dom.html"),
            "styles": str(out / f"{slug}.styles.json"),
            "motion": str(out / f"{slug}.motion.json"),
            "animations": list(s.seen.values()),
        })
    return states


def capture(steps: str, url: str | None = None) -> dict:
    plan = _steps(steps)
    source = url or plan["url"]
    out = paths.atom_dir("page-record", datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(3))
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(args=CHROMIUM_ARGS)
        except PlaywrightError as e:
            raise cli.AtomError("unavailable", f"Headless Chromium is missing. Run: uv run --with playwright==1.63.0 playwright install chromium ({e.message.splitlines()[0]})") from None
        try:
            context = browser.new_context(viewport=plan["viewport"], color_scheme=plan["colorScheme"], **CONTEXT)
            states = _record(context.new_page(), plan, source, out)
        finally:
            browser.close()
    result = {"source": source, "steps": str(Path(steps).expanduser().resolve()), "dir": str(out), "states": states, "cacheHit": False}
    (out / "recording.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def _text(result: dict) -> str:
    return "\n".join(st["screenshot"] for st in result["states"])


if __name__ == "__main__":
    cli.main(HERE.parent, {"capture": cli.Verb(capture, _text)})
