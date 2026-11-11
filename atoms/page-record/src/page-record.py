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

from factory_kit import chrome, cli, paths, schema
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
STEPS_SCHEMA = json.loads((HERE.parents[2] / "contracts" / "page-steps.schema.json").read_text(encoding="utf-8"))
PAGE_JS = (HERE / "page.js").read_text(encoding="utf-8")

EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)
LOAD_MS = 30_000
ACTION_ERROR_CHARS = 800
LOAD_VIRTUAL_MS = 10_000
STALL_S = 20
SETTLE_STEP_MS = 100
SETTLE_CAP_MS = 5_000
MARGIN_PX = 8
DRAG_MOVES = 10
DRAG_MOVE_MS = 16
SWEEP_DWELL_MS = 800
DRIFT_SAMPLES = 8
DRIFT_GAP_MS = 1500
PARKED = (0, 0)
# Without these, transform and opacity animations run on the compositor thread on real time, outside the virtual clock.
CHROMIUM_ARGS = ["--disable-threaded-animation", "--disable-threaded-scrolling", "--run-all-compositor-stages-before-draw", "--disable-checker-imaging"]
CONTEXT = {"device_scale_factor": 2, "locale": "en-US", "timezone_id": "UTC", "reduced_motion": "no-preference", "service_workers": "block"}


def _steps(path: str) -> dict:
    steps = cli.read_json(path, "invalid_args", f"Cannot read steps file {path}")
    schema.check(steps, STEPS_SCHEMA, "invalid_args", f"{path} is not a page-steps file")
    names = [state["name"] for state in steps["states"]]
    if len(set(names)) < len(names):
        raise cli.AtomError("invalid_args", f"{path}: state names repeat, and page-diff matches states by name: {names}")
    held = False
    for state in steps["states"]:
        for action in state["actions"]:
            if action["do"] == "drag" and held:
                raise cli.AtomError("invalid_args", f"{path}: state {state['name']!r} has a drag while the pointer is held")
            if action["do"] == "drop" and not held:
                raise cli.AtomError("invalid_args", f"{path}: state {state['name']!r} has a drop with no drag before it")
            if action["do"] in ("drag", "drop"):
                held = action["do"] == "drag"
        if held and "sweep" in state:
            raise cli.AtomError("invalid_args", f"{path}: state {state['name']!r} has a sweep while the pointer is held")
    if held:
        raise cli.AtomError("invalid_args", f"{path}: a drag has no drop after it")
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
            self.page.wait_for_timeout(1)

    def step(self, ms: int):
        self.run(ms)
        self.js("drive")

    def advance(self, ms: int):
        self.collect()
        self.step(ms)
        self.collect()

    def settle(self, step=None):
        elapsed = 0
        while True:
            (step or self.advance)(SETTLE_STEP_MS)
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
        loc = self.page.locator(selector).locator("visible=true").first
        if not loc.count():
            raise cli.AtomError("invalid_source", f"{where}: no visible element matches {selector!r}")
        return loc


def _on(s: Session, a: dict, where: str):
    return s.locate(a["selector"], where) if "selector" in a else None


def _paste(s: Session, a: dict, where: str):
    if "selector" in a:
        _on(s, a, where).focus()
    if s.js("paste", a["text"]):
        s.page.keyboard.insert_text(a["text"])


def _drag(s: Session, a: dict, where: str):
    loc = _on(s, a, where)
    loc.scroll_into_view_if_needed()
    box = loc.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    s.page.mouse.move(x, y)
    s.page.mouse.down()
    # Chromium answers a pressed pointer's move over CDP only at the next frame, which a paused clock never reaches, so a blocking move hangs.
    # The page gets the event at once. So the move goes out without waiting for the answer, and the page's own count of moves says when it arrived.
    # The clock stands still until then and moves a fixed step after, so every drag takes the same page time and a spring sees a real velocity.
    for i in range(1, DRAG_MOVES + 1):
        moves = s.js("moves")
        move = s.page._loop.create_task(s.page.mouse._impl_obj.move(x + a["by"]["x"] * i / DRAG_MOVES, y + a["by"]["y"] * i / DRAG_MOVES))
        # Reads the outcome, so closing the browser on an unanswered move does not log an unretrieved task exception.
        move.add_done_callback(lambda t: t.cancelled() or t.exception())
        deadline = time.monotonic() + STALL_S
        while s.js("moves") == moves:
            if time.monotonic() > deadline:
                raise cli.AtomError("invalid_source", f"{where}: a pointer move did not reach the page within {STALL_S}s")
            s.page.wait_for_timeout(5)
        s.advance(DRAG_MOVE_MS)


ACTIONS = {
    "hover": lambda s, a, w: _on(s, a, w).hover(),
    "click": lambda s, a, w: _on(s, a, w).click(),
    "focus": lambda s, a, w: _on(s, a, w).focus(),
    "select": lambda s, a, w: _on(s, a, w).click(click_count=3),
    "scroll": lambda s, a, w: _on(s, a, w).scroll_into_view_if_needed(),
    "type": lambda s, a, w: _on(s, a, w).press_sequentially(a["text"]) if "selector" in a else s.page.keyboard.type(a["text"]),
    "press": lambda s, a, w: _on(s, a, w).press(a["key"]) if "selector" in a else s.page.keyboard.press(a["key"]),
    "paste": _paste,
    "wait": lambda s, a, w: s.advance(a["ms"]),
    "drag": _drag,
    "drop": lambda s, a, w: s.page.mouse.up(),
}


def _load(s: Session, url: str):
    s.cdp.send("Emulation.setVirtualTimePolicy", {"policy": "pause", "initialVirtualTime": EPOCH.timestamp()})
    try:
        response = s.page.goto(url, wait_until="commit", timeout=LOAD_MS)
    except PlaywrightTimeout:
        raise cli.AtomError("network_error", f"{url} did not answer within {LOAD_MS // 1000}s") from None
    except PlaywrightError as e:
        raise cli.AtomError("network_error", f"{url}: {e.message.splitlines()[0]}") from None
    s.run(LOAD_VIRTUAL_MS)
    chrome.refuse_bot_check(s.page, response, url, "page-record")
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


def _sweep(s: Session, grid: dict, slug: str, out: Path) -> str:
    """Moves the pointer over the target and keeps how the page answers at each point. Runs after the state is recorded, since it leaves the pointer parked."""
    folder = out / f"{slug}.sweep"
    folder.mkdir()
    dwell = grid.get("dwellMs", SWEEP_DWELL_MS)

    # A sweep's animations belong to no state, so it skips collect, which walks the DOM on every step.
    def settled() -> None:
        s.step(dwell)
        s.settle(s.step)

    def shot(name: str) -> str:
        # Device scale 1: many points are kept, and page-diff compares them in cells far coarser than a pixel.
        s.page.screenshot(path=folder / name, clip=clip, caret="hide", scale="css")
        return f"{folder.name}/{name}"

    s.locate(s.target, f"sweep {slug}, the target").scroll_into_view_if_needed()
    s.page.mouse.move(*PARKED)
    settled()
    box = s.js("rect", s.target)
    clip = s.js("box", s.target, MARGIN_PX)
    rest = s.js("motion", s.target)
    sweep = {"cols": grid["cols"], "rows": grid["rows"], "dwellMs": dwell, "rest": shot("rest.png"), "drift": [], "points": []}
    # An animation moves with the pointer parked too, so these show which parts of the page no pointer answer can be read from.
    for i in range(1, DRIFT_SAMPLES + 1):
        s.step(DRIFT_GAP_MS)
        settled()
        sweep["drift"].append(shot(f"rest-{i}.png"))
    for row in range(grid["rows"]):
        for col in range(grid["cols"]):
            x, y = box["width"] * (col + 0.5) / grid["cols"], box["height"] * (row + 0.5) / grid["rows"]
            s.page.mouse.move(box["left"] + x, box["top"] + y)
            settled()
            posed = s.js("motion", s.target)
            changed = {path: diff for path, pose in posed.items() if (diff := {k: v for k, v in pose.items() if v != rest.get(path, {}).get(k)})}
            sweep["points"].append({
                "col": col, "row": row, "x": round(x, 3), "y": round(y, 3),
                "image": shot(f"{row:02d}-{col:02d}.png"),
                "cursor": s.js("cursor", box["left"] + x, box["top"] + y),
                "changed": changed,
            })
    s.page.mouse.move(*PARKED)
    settled()
    file = out / f"{slug}.sweep.json"
    file.write_text(json.dumps(sweep, indent=2), encoding="utf-8")
    return str(file)


def _record(page, steps: dict, url: str, out: Path) -> list[dict]:
    page.add_init_script(PAGE_JS)
    s = Session(page, steps["target"])
    _load(s, url)
    s.page.evaluate("document.fonts.ready.then(() => true)")
    s.locate(s.target, "target")
    s.js("baseline")

    states = []
    for i, state in enumerate(steps["states"]):
        slug = _slug(i, state["name"])
        s.seen = {}
        for j, action in enumerate(state["actions"]):
            where = f"state {state['name']!r} action {j} ({action['do']})"
            try:
                ACTIONS[action["do"]](s, action, where)
            except PlaywrightError as e:
                raise cli.AtomError("invalid_source", f"{where}: {e.message[:ACTION_ERROR_CHARS]}") from None
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
        effects = s.js("effects")
        s.locate(s.target, f"state {state['name']!r}, after its actions settled, the target")
        (out / f"{slug}.dom.html").write_text(s.js("dom", s.target), encoding="utf-8")
        (out / f"{slug}.styles.json").write_text(json.dumps(s.js("styles", s.target), indent=2), encoding="utf-8")
        overlays = []
        for k, overlay in enumerate(s.js("overlays", s.target, MARGIN_PX)):
            (out / f"{slug}.overlay{k}.dom.html").write_text(overlay["dom"], encoding="utf-8")
            (out / f"{slug}.overlay{k}.styles.json").write_text(json.dumps(overlay["styles"], indent=2), encoding="utf-8")
            s.page.screenshot(path=out / f"{slug}.overlay{k}.png", clip=overlay["clip"], caret="hide")
            overlays.append({
                "screenshot": str(out / f"{slug}.overlay{k}.png"),
                "dom": str(out / f"{slug}.overlay{k}.dom.html"),
                "styles": str(out / f"{slug}.overlay{k}.styles.json"),
                "offset": overlay["offset"],
                "at": overlay["at"],
            })
        states.append({
            "name": state["name"],
            "screenshot": s.screenshot(out / f"{slug}.png"),
            "frames": frames,
            "dom": str(out / f"{slug}.dom.html"),
            "styles": str(out / f"{slug}.styles.json"),
            "motion": str(out / f"{slug}.motion.json"),
            "animations": list(s.seen.values()),
            "overlays": overlays,
            "effects": effects,
        })
        if "sweep" in state:
            states[-1]["sweep"] = _sweep(s, state["sweep"], slug, out)
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
