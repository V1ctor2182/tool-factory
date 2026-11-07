# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "numpy>=2", "pillow>=11"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import hashlib
import json
import math
import re
from pathlib import Path
from typing import NamedTuple

import numpy as np
from factory_kit import cli, paths
from factory_kit.cache import Cache
from factory_kit.color import rgb_to_lab
from factory_kit.hash import file_sha256
from PIL import Image

SHEET_COLS = 6
THUMB_W = 480
GAP_FLOOR_MS = 150
PRESENCE_AGREE = 0.8
# Below this many firings, the spread of the gaps is mostly chance: one unchanged page read 0.59, 0.75, and 1.40 at 8 firings.
HUE_MIN_SHARE = 0.015
HUE_FLOOR = 0.003
RHYTHM_MIN_EVENTS = 12
RHYTHM = ("gapCv", "order", "periodicity")
SEVERITY_RANK = {"major": 0, "minor": 1, "departure": 2}


class Rule(NamedTuple):
    metric: str
    how: str
    tolerance: float
    floor: float
    severity: str
    meaning: str


# how: ratio differs when the larger over the smaller passes tolerance, and both below floor count as equal.
# abs differs when the gap passes tolerance. colour compares the closest of the top colours in Lab.
# hues is the largest ratio between two pages' shares of any hue sector that holds a real share on either.
# same needs equal values.
RULES = {
    "idle": [
        Rule("litPeak", "ratio", 2.0, 0.0006, "major", "How much of the screen lights up at rest"),
        Rule("everLit", "ratio", 2.0, 0.001, "major", "How much of the screen ever changes at rest"),
        Rule("ratePerS", "ratio", 1.8, 0.3, "major", "How often something fires at rest"),
        Rule("gapCv", "abs", 0.35, 0, "major", "How even the gaps between firings are"),
        Rule("order", "abs", 0.3, 0, "minor", "Whether firings sweep in order or scatter"),
        Rule("periodicity", "abs", 0.3, 0, "minor", "How strongly the effect repeats on a cycle"),
        Rule("hues", "hues", 3.0, 0, "major", "A colour that flashes at rest on one page and not on the other"),
        Rule("colours", "colour", 15, 0, "minor", "The main colours that change at rest, which include a slow blink that hues skips"),
    ],
    "hover": [
        Rule("responseMs", "abs", 150, 0, "major", "Time from pointer entry to the first change, or no reaction"),
        Rule("riseMs", "abs", 300, 0, "minor", "Time from the first change to the full hover state"),
        Rule("peak", "ratio", 2.5, 0.0005, "major", "How much of the screen the hover changes"),
        Rule("colours", "colour", 15, 0, "minor", "The colour the hover turns"),
        Rule("cursor", "same", 0, 0, "minor", "The cursor over the target"),
        Rule("residualAfterExit", "abs", 0.003, 0, "minor", "What stays changed after the pointer leaves"),
    ],
    "click": [
        Rule("responseMs", "abs", 200, 0, "major", "Time from the click to the first change, or no reaction"),
        Rule("worstGapMs", "abs", 300, GAP_FLOOR_MS, "major", "The longest frame stall after the click"),
        Rule("riseMs", "abs", 400, 0, "minor", "Time from the first change to the full result"),
        Rule("peak", "ratio", 2.5, 0.0005, "major", "How much of the screen the click changes"),
    ],
    "path": [
        Rule("reaction", "ratio", 1.8, 0.0008, "major", "How much the page reacts to a moving pointer"),
        Rule("reachPx", "ratio", 1.5, 0, "minor", "How far from the pointer the reaction spreads"),
    ],
    "load": [Rule("settleMs", "abs", 1200, 0, "major", "How long the page takes to settle after load")],
    "pass": [
        Rule("inertiaMs", "abs", 200, 0, "major", "How long scrolling coasts after the wheel stops"),
        Rule("coastMs", "abs", 200, 0, "major", "How long content keeps moving after the wheel stops"),
        Rule("travelPx", "ratio", 1.3, 20, "minor", "How far the same wheel input scrolls"),
    ],
}


def _lab(hex_: str) -> np.ndarray:
    return rgb_to_lab([int(hex_[i : i + 2], 16) for i in (1, 3, 5)])


def _gap(rule: Rule, x, y) -> float:
    """How far apart two values are, in the rule's own unit. None against a value is infinitely far."""
    if rule.how == "same":
        return 0.0 if x == y else math.inf
    if rule.how == "colour":
        if not x or not y:
            return 0.0 if not x and not y else math.inf
        near = lambda ps, qs: max(min(float(np.linalg.norm(_lab(p["hex"]) - _lab(q["hex"]))) for q in qs[:2]) for p in ps[:2])
        return max(near(x, y), near(y, x))
    if rule.how == "hues":
        if not x or not y:
            return 1.0
        return max([max(p, q) / max(min(p, q), HUE_FLOOR) for p, q in zip(x, y) if max(p, q) >= HUE_MIN_SHARE], default=1.0)
    # A share with a floor has no value when too few frames arrived, and a page that sends no frames at rest is not moving.
    if rule.how == "ratio" and rule.floor > 0:
        x, y = x or 0.0, y or 0.0
    if x is None or y is None:
        return 0.0 if x is None and y is None else math.inf
    if max(x, y) < rule.floor:
        return 1.0 if rule.how == "ratio" else 0.0
    if rule.how == "ratio":
        return max(x, y) / max(min(x, y), rule.floor, 1e-9)
    return abs(x - y)


def _allowed(rule: Rule, noise: float) -> float:
    if not math.isfinite(noise):
        return math.inf
    if rule.how in ("ratio", "hues"):
        return rule.tolerance * max(noise, 1.0) ** 2
    return rule.tolerance + 2 * noise


def _presence(v: dict) -> np.ndarray:
    ys = np.array(v["ys"], dtype=float)
    active = np.zeros(len(ys), bool)
    for lo, hi in v["activeRanges"]:
        active |= (ys >= min(lo, hi)) & (ys <= max(lo, hi))
    span = max(ys.max() - ys.min(), 1)
    grid = np.linspace(0, 1, 200)
    order = np.argsort(ys)
    return active[order][np.clip(np.searchsorted((ys[order] - ys.min()) / span, grid), 0, len(ys) - 1)]


def _walk(a: dict, b: dict, base: dict | None) -> list:
    out = []
    x, y = a["values"], b["values"]
    if len(x["ys"]) > 1 and len(y["ys"]) > 1:
        agree = float((_presence(x) == _presence(y)).mean())
        need = PRESENCE_AGREE
        if base and len(base["values"]["ys"]) > 1:
            need = min(need, float((_presence(x) == _presence(base["values"])).mean()) - 0.05)
        if agree < need:
            out.append(("activeRanges", x["activeRanges"], y["activeRanges"], "major", "Where on the page something moves at rest", 1 - agree))
    ox, oy = x.get("overflow") or {}, y.get("overflow") or {}
    if abs(oy.get("sidewaysPx", 0)) > abs(ox.get("sidewaysPx", 0)) + 1:
        out.append(("sidewaysPx", ox.get("sidewaysPx"), oy.get("sidewaysPx"), "major", "The page moves under a sideways wheel", 1.0))
    if oy.get("scrollWidth", 0) > oy.get("viewport", math.inf) >= ox.get("scrollWidth", 0):
        out.append(("scrollWidth", ox.get("scrollWidth"), oy.get("scrollWidth"), "major", "The page is wider than the viewport", 1.0))
    return out + _transitions(a, b, base)


def _transitions(a: dict, b: dict, base: dict | None) -> list:
    out = []
    tx, ty = a["values"]["transitions"], b["values"]["transitions"]
    known = base and len(base["values"]["transitions"]) != len(tx)
    if len(tx) != len(ty) and not known:
        out.append(("transitionCount", len(tx), len(ty), "major", "How many page colour changes the range holds", abs(len(tx) - len(ty))))
    if a["kind"] == "walk" and a["values"]["transitions"] and a["values"]["transitions"][0]["resolution"] > 100:
        return out
    for k, (p, q) in enumerate(zip(tx, ty)):
        sp, sq = p["spanPx"], q["spanPx"]
        if sp and sq and max(sp, sq) / min(sp, sq) > 1.5:
            out.append((f"transitions[{k}].spanPx", sp, sq, "major", "How many pixels of scroll a colour change takes, 10% to 90%", max(sp, sq) / min(sp, sq)))
        lp, lq = p["largestStepPer40Px"], q["largestStepPer40Px"]
        if lp is not None and lq is not None and abs(lp - lq) > 0.2:
            out.append((f"transitions[{k}].largestStepPer40Px", lp, lq, "major", "The hardest jump in a colour change, per 40 px of scroll", abs(lp - lq)))
    return out


def _state(a: dict, b: dict) -> list:
    sx, sy = a["values"].get("state") or {}, b["values"].get("state") or {}
    out = []
    if bool(sx.get("hash")) != bool(sy.get("hash")):
        out.append(("state.hash", sx.get("hash"), sy.get("hash"), "major", "Whether the click changes the URL hash", 1.0))
    if abs(sx.get("scrollY", 0) - sy.get("scrollY", 0)) > 200 and (abs(sx.get("scrollY", 0) - a["values"].get("at", 0)) > 50):
        out.append(("state.scrollY", sx.get("scrollY"), sy.get("scrollY"), "minor", "Where the click leaves the scroll position", 1.0))
    nx, ny = sx.get("blocked", {}).get("navigations", []), sy.get("blocked", {}).get("navigations", [])
    if bool(nx) != bool(ny):
        out.append(("state.navigates", bool(nx), bool(ny), "minor", "Whether the click leaves the page", 1.0))
    return out


def _rules(kind: str, a: dict, b: dict, base: dict | None) -> list:
    out = []
    for rule in RULES.get(kind, []):
        if rule.metric not in a["values"] and rule.metric not in b["values"]:
            continue
        if rule.metric in RHYTHM and min(a["values"].get("events", 0), b["values"].get("events", 0)) < RHYTHM_MIN_EVENTS:
            continue
        x, y = a["values"].get(rule.metric), b["values"].get(rule.metric)
        noise = _gap(rule, x, base["values"].get(rule.metric)) if base else (1.0 if rule.how == "ratio" else 0.0)
        gap = _gap(rule, x, y)
        if gap > _allowed(rule, noise):
            out.append((rule.metric, x, y, rule.severity, rule.meaning, gap))
    return out


def _read(path: str, what: str) -> dict:
    return cli.read_json(path, "invalid_source", f"{what} {path} is not readable JSON")


def _sheet(a: dict, b: dict, out: Path) -> str | None:
    rows = []
    for run in (a, b):
        images = []
        for f in run["keyFrames"]:
            with Image.open(f) as im:
                im = im.convert("RGB")
                images.append(im.resize((THUMB_W, round(im.height * THUMB_W / im.width))))
        rows.append(images)
    if not any(rows):
        return None
    count = max(len(r) for r in rows)
    cols, bands = min(count, SHEET_COLS), (count + SHEET_COLS - 1) // SHEET_COLS
    height = max(i.height for r in rows for i in r)
    sheet = Image.new("RGB", (cols * THUMB_W + (cols - 1) * 4, bands * (height * 2 + 16) - 8), (128, 128, 128))
    for r, images in enumerate(rows):
        for k, im in enumerate(images):
            sheet.paste(im, ((k % cols) * (THUMB_W + 4), (k // cols) * (height * 2 + 16) + r * (height + 4)))
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    return str(out)


def compare(a: str, b: str, baseline: str | None, departures: str | None) -> dict:
    files = [p for p in (a, b, baseline, departures) if p]
    for p in files:
        if not Path(p).expanduser().is_file():
            raise cli.AtomError("invalid_source", f"{p} is not a file")
    key = hashlib.sha256("".join(file_sha256(Path(p).expanduser()) + ("|" if p else "") for p in files).encode() + str((bool(baseline), bool(departures))).encode()).hexdigest()
    cache = Cache("motion-diff")
    if (cached := cache.get(key)) and all(Path(r["sheet"]).is_file() for r in cached["runs"] if r["sheet"]):
        return cached
    ra, rb = _read(a, "a"), _read(b, "b")
    rc = _read(baseline, "baseline") if baseline else None
    deliberate = _read(departures, "departures") if departures else []
    by_b = {r["id"]: r for r in rb["runs"]}
    by_c = {r["id"]: r for r in rc["runs"]} if rc else {}
    final = paths.atom_dir("motion-diff", "files", key[:16])
    differences, runs, compared = [], [], 0

    def add(run, metric, x, y, severity, meaning, size, sheet):
        if any(d.get("run") in ("*", run["id"]) and d.get("metric") == metric for d in deliberate):
            severity = "departure"
        differences.append({"run": run["id"], "kind": run["kind"], "metric": metric, "a": x, "b": y, "severity": severity, "meaning": meaning, "sheet": sheet, "size": round(size, 3) if math.isfinite(size) else None})

    for run in ra["runs"]:
        other = by_b.get(run["id"])
        if run["status"] != "ok":
            runs.append({"id": run["id"], "kind": run["kind"], "sheet": None})
            continue
        if other is None or other["status"] != "ok":
            add(run, "run", "ok", other["status"] if other else "absent", "major", "The run could not happen on the rebuild. " + (other or {}).get("detail", ""), math.inf, None)
            runs.append({"id": run["id"], "kind": run["kind"], "sheet": None})
            continue
        compared += 1
        sheet = _sheet(run, other, final / f"{re.sub(r'[^A-Za-z0-9._-]', '_', run['id'])}.png")
        runs.append({"id": run["id"], "kind": run["kind"], "sheet": sheet})
        base = by_c.get(run["id"])
        base = base if base and base["status"] == "ok" else None
        found = _rules(run["kind"], run, other, base)
        if run["kind"] == "walk":
            found += _walk(run, other, base)
        if run["kind"] == "pass":
            found += _transitions(run, other, base)
        if run["kind"] == "click":
            found += _state(run, other)
        if len(other.get("errors", [])) > len(run.get("errors", [])):
            found.append(("errors", len(run.get("errors", [])), other["errors"][:3], "major", "Page errors during the run", math.inf))
        for f in found:
            add(run, *f, sheet)
    differences.sort(key=lambda d: (SEVERITY_RANK[d["severity"]], -(d["size"] if d["size"] is not None else math.inf)))
    counts = {s: sum(d["severity"] == s for d in differences) for s in SEVERITY_RANK}
    result = {"a": str(a), "b": str(b), "cacheHit": False, "summary": {"major": counts["major"], "minor": counts["minor"], "departures": counts["departure"], "runsCompared": compared}, "differences": differences, "runs": runs}
    cache.put(key, result)
    return result


def _text(r: dict) -> str:
    s = r["summary"]
    lines = [f"{s['major']} major, {s['minor']} minor, {s['departures']} departures over {s['runsCompared']} runs"]
    lines += [f"{d['severity']} {d['run']} {d['metric']}: {json.dumps(d['a'])[:60]} vs {json.dumps(d['b'])[:60]}. {d['meaning']}" for d in r["differences"]]
    return "\n".join(lines)


if __name__ == "__main__":
    cli.main(Path(__file__).resolve().parent.parent, {"compare": cli.Verb(compare, _text)})
