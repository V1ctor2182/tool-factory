# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "playwright==1.63.0", "jsonschema>=4.18"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import base64
import hashlib
import json
import math
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

from factory_kit import chrome, cli, paths, schema
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PLAN_SCHEMA = json.loads((HERE.parents[2] / "contracts" / "sweep-plan.schema.json").read_text(encoding="utf-8"))
DEFAULT_LOAD_MS = 6_000
SETTLE_MS = 150
STILL_GAP_MS = 300
PRE_MS = 900
EXIT_MS = 1_400
WHEEL_PX = 200
AIM_SCREENS = (0.5, 1, 1.5, 2, 3, 4)
AIM_WAIT_MS = 600
SIDEWAYS_PX = 170
# A worst-frame recorder, so a stall shows even when no frame changes during it.
GAP_JS = "(() => { let last = 0; window.__sweepWorst = 0; const tick = (t) => { if (last) window.__sweepWorst = Math.max(window.__sweepWorst, t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()"


class Cast:
    """A lossless screencast whose frames go to disk as they arrive."""

    def __init__(self, page, out: Path):
        self.page, self.out = page, out
        self.frames, self.t0 = [], None

    def __enter__(self):
        self.out.mkdir(parents=True, exist_ok=True)
        self.cdp = self.page.context.new_cdp_session(self.page)
        self.cdp.on("Page.screencastFrame", self._frame)
        self.t0 = time.time()
        self.cdp.send("Page.startScreencast", {"format": "png"})
        return self

    def _frame(self, e):
        meta = e["metadata"]
        name = f"{len(self.frames):05d}.png"
        (self.out / name).write_bytes(base64.b64decode(e["data"]))
        self.frames.append({"file": f"{self.out.name}/{name}", "t": round(meta["timestamp"] - self.t0, 3), "y": round(meta.get("scrollOffsetY", 0), 1)})
        self.cdp.send("Page.screencastFrameAck", {"sessionId": e["sessionId"]})

    def __exit__(self, *_):
        self.page.wait_for_timeout(80)
        self.cdp.send("Page.stopScreencast")
        self.cdp.detach()

    def now(self) -> float:
        return round(time.time() - self.t0, 3)


def _still(page, path: Path):
    # Playwright's screenshot waits on the page and timed out on a busy WebGL page, so this reads the surface directly.
    cdp = page.context.new_cdp_session(page)
    try:
        path.write_bytes(base64.b64decode(cdp.send("Page.captureScreenshot", {"format": "png", "fromSurface": True})["data"]))
    finally:
        cdp.detach()


def _park(page, vp):
    page.mouse.move(vp["width"] - 6, vp["height"] // 3)


def _scroll_y(page) -> float:
    return page.evaluate("scrollY")


def _rest_at(page, y: float, vp: dict) -> float:
    """Wheel to y, the way a person gets there, then wait for smooth scrolling to stop."""
    _park(page, vp)
    limit = page.evaluate("document.documentElement.scrollHeight - innerHeight")
    y = max(0, min(y, limit))
    for _ in range(int(abs(y - _scroll_y(page)) / WHEEL_PX) + 40):
        left = y - _scroll_y(page)
        if abs(left) < 4:
            break
        page.mouse.wheel(0, math.copysign(min(abs(left), WHEEL_PX), left))
        page.wait_for_timeout(50 if abs(left) > WHEEL_PX else 180)
    last = None
    for _ in range(25):
        now = _scroll_y(page)
        if now == last:
            break
        last = now
        page.wait_for_timeout(100)
    return _scroll_y(page)


def _point(page, target: dict, vp: dict) -> list | None:
    if "point" in target:
        return target["point"]
    el = page.query_selector(target["selector"])
    box = el and el.bounding_box()
    if not box or box["width"] < 1:
        return None
    # The middle of the part on screen, since a corner button may sit half off the edge.
    left, right = max(box["x"], 0), min(box["x"] + box["width"], vp["width"])
    top, bottom = max(box["y"], 0), min(box["y"] + box["height"], vp["height"])
    if right - left < 2 or bottom - top < 2:
        return None
    xy = [(left + right) / 2, (top + bottom) / 2]
    return xy if el.evaluate("(e, [x, y]) => { const hit = document.elementFromPoint(x, y); return !!hit && (e === hit || e.contains(hit) || hit.contains(e)); }", xy) else None


def _aim(page, run: dict, vp: dict) -> tuple:
    """Rest at the run's offset. A control that scroll reveals is not there yet, so keep going down until the pointer would really hit it."""
    y = _rest_at(page, run["at"], vp)
    page.wait_for_timeout(SETTLE_MS)
    xy = _point(page, run["target"], vp)
    for k in AIM_SCREENS:
        if xy is not None:
            break
        y = _rest_at(page, run["at"] + k * vp["height"], vp)
        page.wait_for_timeout(AIM_WAIT_MS)
        xy = _point(page, run["target"], vp)
    return y, xy


def _cursor(page, xy: list) -> str:
    return page.evaluate("([x, y]) => { const e = document.elementFromPoint(x, y); return e ? getComputedStyle(e).cursor : ''; }", xy)


def _gap(page) -> float:
    return round(page.evaluate("window.__sweepWorst || 0"), 1)


def _reset_gap(page):
    page.evaluate("window.__sweepWorst = 0")


def _walk(c, run, out):
    page, vp = c["page"], c["vp"]
    end = page.evaluate("document.documentElement.scrollHeight - innerHeight")
    to = end if run["to"] == "end" else min(run["to"], end)
    start = min(run["from"], end)
    step = run["step"] if to >= start else -run["step"]
    count = int(abs(to - start) / run["step"]) + 1
    out.mkdir(parents=True, exist_ok=True)
    stops, widest = [], 0
    for k in range(count):
        y = _rest_at(page, start + k * step, vp)
        page.wait_for_timeout(SETTLE_MS)
        a, b = f"{out.name}/{k:04d}a.png", f"{out.name}/{k:04d}b.png"
        _still(page, out.parent / a)
        page.wait_for_timeout(STILL_GAP_MS)
        _still(page, out.parent / b)
        stops.append({"y": round(y, 1), "a": a, "b": b})
        widest = max(widest, page.evaluate("document.documentElement.scrollWidth"))
    before = page.evaluate("scrollX")
    page.mouse.wheel(SIDEWAYS_PX, 0)
    page.wait_for_timeout(400)
    moved = page.evaluate("scrollX") - before
    page.evaluate("scrollTo(0, scrollY)")
    return {"stops": stops, "overflow": {"scrollWidth": widest, "viewport": vp["width"], "sidewaysPx": round(moved, 1)}}


def _pass(c, run, out):
    page, vp = c["page"], c["vp"]
    y = _rest_at(page, run["at"], vp)
    page.wait_for_timeout(SETTLE_MS)
    events = []
    with Cast(page, out) as cast:
        page.wait_for_timeout(500)
        events.append({"t": cast.now(), "type": "wheel-start"})
        wheel = run.get("wheelPx", 20)
        for _ in range(int(abs(run["distance"]) / wheel)):
            page.mouse.wheel(0, math.copysign(wheel, run["distance"]))
            page.wait_for_timeout(33)
        events.append({"t": cast.now(), "type": "wheel-end"})
        page.wait_for_timeout(run.get("afterMs", 1_500))
    return {"at": run["at"], "scrollY": y, "frames": cast.frames, "events": events}


def _idle(c, run, out):
    page, vp = c["page"], c["vp"]
    y = _rest_at(page, run["at"], vp)
    page.wait_for_timeout(SETTLE_MS * 2)
    _reset_gap(page)
    with Cast(page, out) as cast:
        page.wait_for_timeout(run["forMs"])
    return {"at": run["at"], "scrollY": y, "frames": cast.frames, "events": [], "worstGapMs": _gap(page), "forMs": run["forMs"]}


def _hover(c, run, out):
    page, vp = c["page"], c["vp"]
    y, xy = _aim(page, run, vp)
    if xy is None:
        return {"status": "missing", "detail": f"no reachable target near scroll {run['at']}: {run['target']}", "at": run["at"], "scrollY": y}
    events = []
    with Cast(page, out) as cast:
        page.wait_for_timeout(PRE_MS)
        events.append({"t": cast.now(), "type": "enter", "x": xy[0], "y": xy[1]})
        page.mouse.move(*xy, steps=8)
        page.wait_for_timeout(run.get("holdMs", 2_500))
        cursor = _cursor(page, xy)
        events.append({"t": cast.now(), "type": "exit"})
        _park(page, vp)
        page.wait_for_timeout(EXIT_MS)
    return {"at": run["at"], "scrollY": y, "frames": cast.frames, "events": events, "cursor": cursor}


def _path(c, run, out):
    page, vp = c["page"], c["vp"]
    y = _rest_at(page, run["at"], vp)
    page.wait_for_timeout(SETTLE_MS)
    speed, events = run.get("speed", 500), []
    with Cast(page, out) as cast:
        page.wait_for_timeout(PRE_MS)
        page.mouse.move(*run["points"][0])
        events.append({"t": cast.now(), "type": "start", "x": run["points"][0][0], "y": run["points"][0][1]})
        for (ax, ay), (bx, by) in zip(run["points"], run["points"][1:]):
            n = max(1, int(math.hypot(bx - ax, by - ay) / speed * 30))
            for k in range(1, n + 1):
                x, yy = ax + (bx - ax) * k / n, ay + (by - ay) * k / n
                page.mouse.move(x, yy)
                events.append({"t": cast.now(), "type": "move", "x": round(x), "y": round(yy)})
                page.wait_for_timeout(33)
        events.append({"t": cast.now(), "type": "end"})
        _park(page, vp)
        page.wait_for_timeout(EXIT_MS)
    return {"at": run["at"], "scrollY": y, "frames": cast.frames, "events": events}


def _fresh(c):
    """A page that cannot write to the site or leave it, for runs that act."""
    context = c["browser"].new_context(viewport=c["vp"], service_workers="block")
    context.on("page", lambda p: p.opener() and p.close())
    page = context.new_page()
    page.add_init_script(GAP_JS)
    blocked = {"writes": 0, "navigations": []}
    origin = urlparse(c["url"])

    def guard(route, request):
        if request.is_navigation_request() and request.frame == page.main_frame:
            there = urlparse(request.url)
            if (there.scheme, there.netloc, there.path) != (origin.scheme, origin.netloc, origin.path):
                blocked["navigations"].append(request.url)
                return route.abort()
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            blocked["writes"] += 1
            return route.abort()
        return route.continue_()

    page.route("**/*", guard)
    return context, page, blocked


def _click(c, run, out):
    vp = c["vp"]
    context, page, blocked = _fresh(c)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))
    try:
        page.goto(c["url"], wait_until="domcontentloaded", timeout=chrome.LOAD_MS)
        page.wait_for_timeout(c["loadMs"])
        y, xy = _aim(page, run, vp)
        if xy is None:
            return {"status": "missing", "detail": f"no reachable target near scroll {run['at']}: {run['target']}", "at": run["at"], "scrollY": y, "errors": errors}
        page.mouse.move(*xy, steps=4)
        page.wait_for_timeout(300)
        _reset_gap(page)
        events = []
        with Cast(page, out) as cast:
            page.wait_for_timeout(PRE_MS)
            _reset_gap(page)
            events.append({"t": cast.now(), "type": "click", "x": xy[0], "y": xy[1]})
            page.mouse.click(*xy)
            page.wait_for_timeout(run.get("afterMs", 3_000))
        state = page.evaluate("({ scrollY, hash: location.hash, focus: document.activeElement && document.activeElement.tagName, height: document.documentElement.scrollHeight })")
        return {"at": run["at"], "scrollY": y, "frames": cast.frames, "events": events, "worstGapMs": _gap(page), "state": {**state, "scrollY": round(state["scrollY"], 1), "blocked": blocked}, "errors": errors}
    finally:
        context.close()


def _load(c, run, out):
    context = c["browser"].new_context(viewport=c["vp"], service_workers="block")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))
    try:
        with Cast(page, out) as cast:
            page.goto(c["url"], wait_until="commit", timeout=chrome.LOAD_MS)
            page.wait_for_timeout(run.get("forMs", 8_000))
        return {"frames": cast.frames, "events": [], "errors": errors}
    finally:
        context.close()


RUNNERS = {"load": _load, "walk": _walk, "pass": _pass, "idle": _idle, "hover": _hover, "path": _path, "click": _click}


def capture(plan: str, url: str | None) -> dict:
    spec = cli.read_json(plan, "invalid_args", f"{plan} is not a readable JSON file")
    schema.check(spec, PLAN_SCHEMA, "invalid_args", f"{plan} is not a sweep plan")
    target = url or spec["url"]
    ids = [r["id"] for r in spec["runs"]]
    if len(set(ids)) != len(ids):
        raise cli.AtomError("invalid_args", f"{plan} repeats a run id")
    vp, load_ms = spec.get("viewport", chrome.VIEWPORT), spec.get("loadMs", DEFAULT_LOAD_MS)
    stamp = hashlib.sha256(f"{target}{time.time()}".encode()).hexdigest()[:12]
    out = paths.atom_dir("page-sweep", "files", f"{urlparse(target).netloc or 'file'}-{stamp}".replace(":", "_"))
    with sync_playwright() as p:
        browser = chrome.launch(p)
        try:
            context = browser.new_context(viewport=vp, service_workers="block")
            page = context.new_page()
            page.add_init_script(GAP_JS)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)[:300]))
            chrome.goto(page, target)
            page.wait_for_timeout(load_ms)
            load_errors = list(errors)
            c = {"page": page, "browser": browser, "vp": vp, "url": target, "loadMs": load_ms}
            runs = []
            for run in spec["runs"]:
                errors.clear()
                try:
                    result = RUNNERS[run["kind"]](c, run, out / run["id"])
                except (PlaywrightTimeout, PlaywrightError) as e:
                    result = {"status": "failed", "detail": e.message.splitlines()[0]}
                runs.append({"id": run["id"], "kind": run["kind"], "status": "ok", **result, "errors": result.get("errors", []) + errors})
                print(f"{run['id']} {runs[-1]['status']}", file=sys.stderr, flush=True)
        finally:
            browser.close()
    sweep = {"url": target, "sweep": str(out / "sweep.json"), "viewport": [vp["width"], vp["height"]], "loadErrors": load_errors, "runs": runs}
    (out / "sweep.json").write_text(json.dumps(sweep), encoding="utf-8")
    return sweep


def _text(r: dict) -> str:
    def count(run):
        return len(run.get("frames", run.get("stops", [])))
    return "\n".join(f"{run['id']} {run['kind']} {run['status']} {count(run)} frames, {len(run['errors'])} errors" for run in r["runs"])


if __name__ == "__main__":
    cli.main(HERE.parent, {"capture": cli.Verb(capture, _text)})
