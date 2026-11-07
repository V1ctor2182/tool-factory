# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "numpy>=2", "pillow>=11"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import bisect
import json
import math
from collections import Counter
from pathlib import Path

import numpy as np
from factory_kit import cli
from factory_kit.cache import Cache
from factory_kit.color import rgb_to_lab
from factory_kit.hash import file_sha256
from factory_kit.image import best_shift, load_image

CHANGED = 16
LIT = 40
PRESENT = 0.002
RESPONSE = 0.0005
MAX_SAMPLES = 150
GRID = (16, 10)
POINTS = {"tl": (0.12, 0.08), "tr": (0.98, 0.08), "ctr": (0.5, 0.5), "bl": (0.12, 0.98), "br": (0.98, 0.98)}
PLATEAU_LAB = 6.0
EVENT_MERGE_S = 0.08
PASS_SAMPLE_PX = 40
BRIEF_SHARE = 0.25
HUE_SECTORS = 12
HUE_MIN_CHROMA = 40


KEY_STILLS = 60
MAX_SHIFT = 90
ASSEMBLING = 3
COAST_GAP_S = 0.35


def _load(path: Path) -> np.ndarray:
    return load_image(path, "RGB", np.int16)


def _hex(rgb) -> str:
    return "#%02x%02x%02x" % tuple(int(round(float(v))) for v in rgb)


def _delta(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.abs(a - b).max(axis=2)


def _sample(frames: list, limit: int = MAX_SAMPLES) -> list:
    if len(frames) <= limit:
        return frames
    return [frames[i * (len(frames) - 1) // (limit - 1)] for i in range(limit)]


def _held(frames: list, for_ms: int | None = None, limit: int = MAX_SAMPLES) -> list:
    """Frames at even times, each held until the next, since a screencast sends a frame only when the picture changes. The run's own length sets the span, since a page that stops changing sends no last frame."""
    times = [f["t"] for f in frames]
    span = max(times[-1] - times[0], (for_ms or 0) / 1000)
    step = span / max(limit - 1, 1)
    if step <= 0:
        return frames
    grid = [times[0] + i * step for i in range(limit)]
    return [{**frames[bisect.bisect_right(times, t + 1e-9) - 1], "t": round(t, 3)} for t in grid]


def _colours(pixels: np.ndarray, top: int = 3) -> list:
    """The most common colours in a pixel list, each as a hex and its share."""
    if not len(pixels):
        return []
    q = (pixels // 16).astype(np.int32)
    keys = q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]
    counts = Counter(keys.tolist()).most_common(top)
    return [{"hex": _hex(pixels[keys == k].mean(axis=0)), "share": round(n / len(pixels), 3)} for k, n in counts]


def _hues(frames: list, root: Path, base: np.ndarray, lit_counts: np.ndarray) -> list:
    """The share of briefly lit pixels in each of 12 hue sectors, so a thin line counts and its fade across many shades stays one colour."""
    brief = (lit_counts > 0) & (lit_counts <= len(frames) * BRIEF_SHARE)
    counts, total = np.zeros(HUE_SECTORS), 0
    if not brief.any():
        return counts.tolist()
    for f in frames:
        img = _load(root / f["file"])
        hit = (_delta(img, base) > LIT) & brief
        if not hit.any():
            continue
        px = img[hit].astype(float)
        hi, lo = px.max(axis=1), px.min(axis=1)
        total += len(px)
        vivid = hi - lo > HUE_MIN_CHROMA
        if not vivid.any():
            continue
        r, g, b_, c = px[vivid, 0], px[vivid, 1], px[vivid, 2], (hi - lo)[vivid]
        top = hi[vivid]
        h = np.where(top == r, ((g - b_) / c) % 6, np.where(top == g, (b_ - r) / c + 2, (r - g) / c + 4))
        counts += np.bincount((h * HUE_SECTORS / 6).astype(int) % HUE_SECTORS, minlength=HUE_SECTORS)
    return [round(float(v) / max(total, 1), 4) for v in counts]


def _point(img: np.ndarray, fx: float, fy: float) -> np.ndarray:
    h, w = img.shape[:2]
    x, y = min(int(fx * w), w - 4), min(int(fy * h), h - 4)
    return np.median(img[max(y - 3, 0) : y + 4, max(x - 3, 0) : x + 4].reshape(-1, 3), axis=0)


def _page_colour(img: np.ndarray) -> np.ndarray:
    small = img[::8, ::8].reshape(-1, 3)
    q = (small // 8).astype(np.int32)
    keys = q[:, 0] * 1024 + q[:, 1] * 32 + q[:, 2]
    values, counts = np.unique(keys, return_counts=True)
    return np.median(small[keys == values[counts.argmax()]], axis=0)


def _segments(flags: list, ys: list) -> list:
    """Scroll ranges where a flag holds, closing one-stop holes, since one pair of stills can land between flashes."""
    closed = [f or (0 < i < len(flags) - 1 and flags[i - 1] and flags[i + 1]) for i, f in enumerate(flags)]
    out, start = [], None
    for i, f in enumerate(closed + [False]):
        if f and start is None:
            start = i
        if not f and start is not None:
            out.append([ys[start], ys[i - 1]])
            start = None
    return out


def _transitions(ys: list, page: np.ndarray, curves: dict) -> list:
    """Each stretch between two stable page colours, with the 10% to 90% span at each fixed screen point."""
    labs = np.array([rgb_to_lab(c) for c in page])
    out, i = [], 0
    while i < len(ys) - 1:
        if np.linalg.norm(labs[i + 1] - labs[i]) < PLATEAU_LAB:
            i += 1
            continue
        j = i + 1
        while j < len(ys) - 1 and np.linalg.norm(labs[j + 1] - labs[j]) >= PLATEAU_LAB:
            j += 1
        a, b = page[i], page[j]
        pad = max(3, j - i)
        lo, hi = max(i - pad, 0), min(j + pad, len(ys) - 1)
        spans, steps = [], []
        axis = b - a
        if axis @ axis > 0:
            for curve in curves.values():
                t = np.clip((curve[lo : hi + 1] - a) @ axis / (axis @ axis), 0, 1)
                t = np.maximum.accumulate(t) if ys[hi] >= ys[lo] else np.maximum.accumulate(t[::-1])[::-1]
                y = np.array(ys[lo : hi + 1], dtype=float)
                if t.max() < 0.9 or t.min() > 0.1:
                    continue
                y10, y90 = float(y[np.argmax(t >= 0.1)]), float(y[np.argmax(t >= 0.9)])
                spans.append(abs(y90 - y10))
                dy = np.abs(np.diff(y))
                steps.append(float((np.abs(np.diff(t)) / np.maximum(dy, 1) * 40).max()))
        out.append({"fromY": ys[i], "toY": ys[j], "from": _hex(a), "to": _hex(b), "spanPx": round(float(np.median(spans))) if spans else None, "largestStepPer40Px": round(float(np.median(steps)), 3) if steps else None, "resolution": round(abs(ys[1] - ys[0]))})
        i = j
    return out


def _walk(run: dict, root: Path) -> dict:
    ys, energy, grids, page = [], [], [], []
    curves = {k: [] for k in POINTS}
    for s in run["stops"]:
        a, b = _load(root / s["a"]), _load(root / s["b"])
        changed = _delta(a, b) > CHANGED
        ys.append(s["y"])
        energy.append(float(changed.mean()))
        h, w = changed.shape
        grids.append([[round(float(changed[r * h // GRID[1] : (r + 1) * h // GRID[1], c * w // GRID[0] : (c + 1) * w // GRID[0]].mean()), 4) for c in range(GRID[0])] for r in range(GRID[1])])
        page.append(_page_colour(a))
        for k, (fx, fy) in POINTS.items():
            curves[k].append(_point(a, fx, fy))
    curves = {k: np.array(v) for k, v in curves.items()}
    present = [e > PRESENT for e in energy]
    keys = [s["a"] for s in run["stops"][:: max(1, len(ys) // KEY_STILLS)]]
    return {
        "values": {
            "ys": ys,
            "energy": [round(e, 5) for e in energy],
            "grid": grids,
            "pageColour": [_hex(c) for c in page],
            "activeRanges": _segments(present, ys),
            "activeShare": round(sum(present) / max(len(ys), 1), 3),
            "transitions": _transitions(ys, np.array(page), curves) if len(ys) > 2 else [],
            "overflow": run.get("overflow"),
        },
        "keyFrames": keys,
    }


def _series(frames: list, root: Path, base: np.ndarray, mask: np.ndarray | None = None) -> list:
    out = []
    for f in frames:
        d = _delta(_load(root / f["file"]), base) > CHANGED
        if mask is not None:
            d &= ~mask
        out.append(float(d.mean()))
    return out


def _base_noise(pre: list, root: Path):
    images = [_load(root / f["file"]) for f in _sample(pre, 12)]
    base = np.median(np.stack(images), axis=0).astype(np.int16)
    noise = np.zeros(base.shape[:2], bool)
    for im in images:
        noise |= _delta(im, base) > CHANGED
    return base, noise


def _idle(run: dict, root: Path) -> dict:
    frames = _held(run["frames"], run.get("forMs")) if len(run["frames"]) > 1 else run["frames"]
    if len(frames) < 2:
        return {"values": {"frames": len(run["frames"]), "litPeak": 0.0, "litMean": 0.0, "events": 0, "ratePerS": 0.0, "colours": [], "worstGapMs": run.get("worstGapMs")}, "keyFrames": [f["file"] for f in frames]}
    base = np.median(np.stack([_load(root / f["file"]) for f in _sample(frames, 15)]), axis=0).astype(np.int16)
    h, w = base.shape[:2]
    ts = np.array([f["t"] for f in frames])
    cells = np.zeros((len(frames), GRID[1], GRID[0]))
    lit_share, pixels = [], []
    lit_counts = np.zeros((h, w), np.int32)
    for i, f in enumerate(frames):
        img = _load(root / f["file"])
        d = _delta(img, base) > LIT
        lit_counts += d
        lit_share.append(float(d.mean()))
        if d.any():
            picked = img[d]
            pixels.append(picked[:: max(1, len(picked) // 2000)])
        for r in range(GRID[1]):
            for c in range(GRID[0]):
                cells[i, r, c] = d[r * h // GRID[1] : (r + 1) * h // GRID[1], c * w // GRID[0] : (c + 1) * w // GRID[0]].mean()
    on = cells > 0.002
    events = []
    for r in range(GRID[1]):
        for c in range(GRID[0]):
            rising = np.flatnonzero(on[1:, r, c] & ~on[:-1, r, c]) + 1
            events += [(float(ts[k]), c, r) for k in rising]
    events.sort()
    merged = []
    for e in events:
        if merged and e[0] - merged[-1][-1][0] < EVENT_MERGE_S:
            merged[-1].append(e)
        else:
            merged.append([e])
    onsets = [m[0][0] for m in merged]
    gaps = np.diff(onsets) if len(onsets) > 2 else np.array([])
    duration = max(float(ts[-1] - ts[0]), 0.001)
    # How steady the turn from one flash to the next is: 1 is a sweep around the screen, near 0 is scattered.
    angles = [math.atan2(np.mean([e[2] for e in m]) - GRID[1] / 2, np.mean([e[1] for e in m]) - GRID[0] / 2) for m in merged]
    turns = np.diff(angles)
    order = float(abs(np.exp(1j * turns).mean())) if len(turns) > 2 else None
    grid_t = np.arange(ts[0], ts[-1], 0.05)
    held = np.array(lit_share)[np.clip(np.searchsorted(ts, grid_t, side="right") - 1, 0, len(ts) - 1)] if len(grid_t) else np.array([])
    periodicity = None
    if len(held) > 40 and held.std() > 0:
        x = held - held.mean()
        ac = np.correlate(x, x, "full")[len(x) - 1 :]
        ac = ac / ac[0]
        lo, hi = 10, len(ac) * 2 // 3
        periodicity = round(float(ac[lo:hi].max()), 3) if hi > lo else None
    ever = lit_counts > 0
    ys, xs = np.nonzero(ever)
    peak = int(np.argmax(lit_share))
    return {
        "values": {
            "frames": len(run["frames"]),
            "fps": round(len(run["frames"]) / duration, 1),
            "litPeak": round(max(lit_share), 5),
            "litMean": round(float(np.mean(lit_share)), 5),
            "everLit": round(float(ever.mean()), 5),
            "box": [round(float(xs.min()) / w, 3), round(float(ys.min()) / h, 3), round(float(xs.max()) / w, 3), round(float(ys.max()) / h, 3)] if len(xs) else None,
            "events": len(merged),
            "ratePerS": round(len(merged) / duration, 2),
            "gapMeanS": round(float(gaps.mean()), 3) if len(gaps) else None,
            "gapCv": round(float(gaps.std() / max(gaps.mean(), 0.001)), 3) if len(gaps) else None,
            "together": round(sum(len({(e[1], e[2]) for e in m}) > 3 for m in merged) / max(len(merged), 1), 3),
            "order": round(order, 3) if order is not None else None,
            "periodicity": periodicity,
            "colours": _colours(np.concatenate(pixels)) if pixels else [],
            "hues": _hues(frames, root, base, lit_counts),
            "worstGapMs": run.get("worstGapMs"),
        },
        "keyFrames": sorted({f["file"] for f in _sample(frames, 8)} | {frames[peak]["file"]}),
    }


def _reaction(run: dict, root: Path, start: str) -> dict:
    """A hover or a click: how the frames depart from the seconds before the input."""
    t0 = next(e["t"] for e in run["events"] if e["type"] == start)
    pre = [f for f in run["frames"] if f["t"] <= t0]
    post = [f for f in run["frames"] if f["t"] > t0]
    worst = run.get("worstGapMs")
    if not pre or not post:
        return {"values": {"responseMs": None, "peak": 0.0, "worstGapMs": worst, "state": run.get("state"), "cursor": run.get("cursor")}, "keyFrames": [f["file"] for f in run["frames"][:1]]}
    base, noise = _base_noise(pre, root)
    frames = _sample(post, 80)
    share = _series(frames, root, base, noise)
    ts = np.array([f["t"] - t0 for f in frames])
    peak = max(share)
    reacted = peak > RESPONSE
    first = int(np.argmax(np.array(share) > RESPONSE)) if reacted else 0
    top = int(np.argmax(share))
    img = _load(root / frames[top]["file"])
    d = (_delta(img, base) > CHANGED) & ~noise
    ys, xs = np.nonzero(d)
    h, w = d.shape
    near_peak = np.flatnonzero(np.array(share) >= 0.9 * peak)
    values = {
        "responseMs": round(float(ts[first]) * 1000) if reacted else None,
        "riseMs": round(float(ts[near_peak[0]] - ts[first]) * 1000) if reacted else None,
        "peak": round(peak, 5),
        "box": [round(float(xs.min()) / w, 3), round(float(ys.min()) / h, 3), round(float(xs.max()) / w, 3), round(float(ys.max()) / h, 3)] if len(xs) else None,
        "colours": _colours(img[d][:: max(1, int(d.sum()) // 4000)]) if d.any() else [],
        "worstGapMs": worst,
        "state": run.get("state"),
        "cursor": run.get("cursor"),
    }
    exit_t = next((e["t"] for e in run["events"] if e["type"] == "exit"), None)
    if exit_t is not None:
        after = [s for s, f in zip(share, frames) if f["t"] > exit_t]
        values["residualAfterExit"] = round(after[-1], 5) if after else None
    return {"values": values, "keyFrames": [pre[-1]["file"], frames[top]["file"], frames[-1]["file"]]}


def _path(run: dict, root: Path) -> dict:
    moves = [e for e in run["events"] if e["type"] in ("start", "move")]
    pre = [f for f in run["frames"] if f["t"] <= moves[0]["t"]]
    during = [f for f in run["frames"] if moves[0]["t"] < f["t"] <= moves[-1]["t"]]
    if not pre or not during:
        return {"values": {"reaction": 0.0, "reachPx": None}, "keyFrames": [f["file"] for f in run["frames"][:1]]}
    base, noise = _base_noise(pre, root)
    frames = _sample(during, 40)
    times = np.array([m["t"] for m in moves])
    shares, reach = [], []
    top, top_share = frames[0], -1.0
    for f in frames:
        d = (_delta(_load(root / f["file"]), base) > CHANGED) & ~noise
        share = float(d.mean())
        shares.append(share)
        if share > top_share:
            top, top_share = f, share
        m = moves[min(int(np.searchsorted(times, f["t"])), len(moves) - 1)]
        ys, xs = np.nonzero(d[::2, ::2])
        if len(xs):
            reach.append(float(np.percentile(np.hypot(xs * 2 - m["x"], ys * 2 - m["y"]), 90)))
    return {
        "values": {"reaction": round(float(np.mean(shares)), 5), "reactionPeak": round(max(shares), 5), "reachPx": round(float(np.median(reach))) if reach else None},
        "keyFrames": [pre[-1]["file"], top["file"], during[-1]["file"]],
    }


def _load_run(run: dict, root: Path) -> dict:
    frames = run["frames"]
    if len(frames) < 2:
        return {"values": {"settleMs": None, "frames": len(frames)}, "keyFrames": [f["file"] for f in frames]}
    final = _load(root / frames[-1]["file"])
    picked = _sample(frames, 60)
    share = []
    for f in picked:
        img = _load(root / f["file"])
        share.append(float((_delta(img, final) > CHANGED).mean()) if img.shape == final.shape else 1.0)
    # A short burst is a loop passing through, so assembling means several samples in a row.
    changed = [s > 0.01 for s in share]
    moving = [picked[i + ASSEMBLING - 1]["t"] for i in range(len(picked) - ASSEMBLING + 1) if all(changed[i : i + ASSEMBLING])]
    keys = [picked[int(k * (len(picked) - 1) / 11)]["file"] for k in range(12)]
    return {"values": {"settleMs": round(moving[-1] * 1000) if moving else 0, "frames": len(frames), "colours": _colours(final[::8, ::8].reshape(-1, 3))}, "keyFrames": keys}


def _curve(frames: list, root: Path) -> dict | None:
    """How the page colour runs from the start of a pass to its end, at about 40 px per sample."""
    picked, last = [], None
    for f in frames:
        if last is None or abs(f["y"] - last) >= PASS_SAMPLE_PX:
            picked.append(f)
            last = f["y"]
    if len(picked) < 4:
        return None
    images = [_load(root / f["file"]) for f in picked]
    a, b = _page_colour(images[0]), _page_colour(images[-1])
    axis = b - a
    if axis @ axis < 100:
        return None
    y = np.array([f["y"] for f in picked], dtype=float)
    spans, steps = [], []
    for fx, fy in POINTS.values():
        t = np.clip((np.array([_point(im, fx, fy) for im in images]) - a) @ axis / (axis @ axis), 0, 1)
        t = np.maximum.accumulate(t)
        if t.max() < 0.9 or t.min() > 0.1:
            continue
        spans.append(abs(float(y[np.argmax(t >= 0.9)] - y[np.argmax(t >= 0.1)])))
        steps.append(float((np.abs(np.diff(t)) / np.maximum(np.abs(np.diff(y)), 1) * 40).max()))
    return {"fromY": picked[0]["y"], "toY": picked[-1]["y"], "from": _hex(a), "to": _hex(b), "spanPx": round(float(np.median(spans))) if spans else None, "largestStepPer40Px": round(float(np.median(steps)), 3) if steps else None, "resolution": PASS_SAMPLE_PX}


def _coast(frames: list, root: Path, end: float) -> int | None:
    """How long content keeps moving after the wheel stops, found by lining up each frame with the next."""
    after = [f for f in frames if f["t"] >= end - 0.1]
    if len(after) < 3:
        return None
    grey = [_load(root / f["file"]).astype(float).mean(axis=2) for f in after]
    by_axis = [[g.mean(axis=0) for g in grey], [g.mean(axis=1) for g in grey]]
    steps = [[best_shift(p[k], p[k + 1], MAX_SHIFT)[0] for k in range(len(p) - 1)] for p in by_axis]
    moving = max(steps, key=lambda s: sum(abs(v) for v in s))
    # A coast keeps one direction. A flash elsewhere on a plain page lines up at a large shift that flips sign from frame to frame.
    last, sign = None, 0
    for k, v in enumerate(moving):
        if not v:
            continue
        if v * sign < 0 or (last is not None and after[k + 1]["t"] - after[last + 1]["t"] > COAST_GAP_S):
            break
        last, sign = k, v
    return 0 if last is None else round(max(0, after[last + 1]["t"] - end) * 1000)


def _pass(run: dict, root: Path) -> dict:
    frames = run["frames"]
    end = next(e["t"] for e in run["events"] if e["type"] == "wheel-end")
    ys = [(f["t"], f["y"]) for f in frames]
    final = ys[-1][1] if ys else 0
    moving = [t for t, y in ys if abs(y - final) > 1]
    keys = [frames[int(k * (len(frames) - 1) / 4)]["file"] for k in range(5)] if frames else []
    curve = _curve(frames, root) if frames else None
    return {"values": {"coastMs": _coast(frames, root, end), "inertiaMs": round(max(0, (moving[-1] if moving else end) - end) * 1000), "travelPx": round(abs(final - ys[0][1])) if ys else 0, "transitions": [curve] if curve else []}, "keyFrames": keys}


MEASURES = {
    "walk": _walk,
    "idle": _idle,
    "hover": lambda r, root: _reaction(r, root, "enter"),
    "click": lambda r, root: _reaction(r, root, "click"),
    "path": _path,
    "load": _load_run,
    "pass": _pass,
}


def measure(sweep: str) -> dict:
    file = Path(sweep).expanduser()
    spec = cli.read_json(file, "invalid_source", f"{sweep} is not a sweep")
    cache = Cache("motion-measure")
    key = file_sha256(file)
    if cached := cache.get(key):
        return {**cached, "source": str(file)}
    root = file.parent
    runs = []
    for run in spec["runs"]:
        entry = {"id": run["id"], "kind": run["kind"], "status": run["status"], "detail": run.get("detail", ""), "errors": run.get("errors", [])}
        if run["status"] == "ok":
            r = MEASURES[run["kind"]](run, root)
            entry |= {"values": r["values"], "keyFrames": [str(root / k) for k in r["keyFrames"]]}
        else:
            entry |= {"values": {}, "keyFrames": []}
        runs.append(entry)
    result = {"source": str(file), "url": spec["url"], "loadErrors": spec.get("loadErrors", []), "cacheHit": False, "runs": runs}
    cache.put(key, result)
    return result


def _text(r: dict) -> str:
    def line(run):
        v = run["values"]
        brief = {k: v[k] for k in ("activeRanges", "transitions", "events", "gapCv", "responseMs", "peak", "reaction", "reachPx", "settleMs", "inertiaMs") if k in v and k != "transitions"}
        if "transitions" in v:
            brief["transitions"] = len(v["transitions"])
        return f"{run['id']} {run['status']} {json.dumps(brief)}"
    return "\n".join(line(run) for run in r["runs"])


if __name__ == "__main__":
    cli.main(Path(__file__).resolve().parent.parent, {"measure": cli.Verb(measure, _text)})
