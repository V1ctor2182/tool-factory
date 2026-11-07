# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "numpy>=2", "pillow>=11"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import json
import re
from pathlib import Path

import numpy as np
from factory_kit import cli
from factory_kit.cache import Cache
from factory_kit.hash import file_sha256
from factory_kit.image import best_shift, load_image

MAX_SHIFT = 90
MAX_TURN = 60
RINGS = (0.45, 0.7, 0.95)
NOISE = 0.2
GAIN = 0.2
RIGID = 0.6
QUIET_S = 0.25
FRAME_S = 0.017
MAX_LEAD_S = 0.05
PERIOD_SHARE = 0.5
MIN_MOVE = {"px": 2, "deg": 2}
MIN_FIT_SAMPLES = 6
MIN_MOVE_SAMPLES = 3
CHANGED = 16
ACTIVE = 0.002
MAX_SAMPLES = 400
TOP_FITS = 3
TIE = 0.01
LINEAR = "linear"
EXPONENTIAL = "exponential"
BEZIER = re.compile(r"cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)")


def _bad(message: str) -> cli.AtomError:
    return cli.AtomError("invalid_source", message)


def _grey(path: Path) -> np.ndarray:
    return load_image(path, "L", np.float32)


def _best_shift(ref: np.ndarray, now: np.ndarray) -> tuple[int, float]:
    return best_shift(ref, now, min(MAX_SHIFT, len(ref) // 3))


def _best_turn(ref: np.ndarray, now: np.ndarray) -> tuple[int, float]:
    """The same for rings of samples, where a shift is a turn in degrees."""
    costs = [np.abs(np.roll(ref, s, axis=1) - now).mean() for s in range(-MAX_TURN, MAX_TURN + 1)]
    best = int(np.argmin(costs))
    return best - MAX_TURN, float(costs[best])


def _follow(profiles: list, best_step) -> tuple[np.ndarray, float | None]:
    """A running position. The reference stays put until a shift is found, so a slow tail adds up instead of rounding to nothing."""
    ref, pos, out, gains = profiles[0], 0, [0], []
    for p in profiles[1:]:
        none = float(np.abs(ref - p).mean())
        if none > NOISE:
            step, best = best_step(ref, p)
            if step and best < none * (1 - GAIN):
                pos += step
                ref = p
                gains.append(1 - best / none)
        out.append(pos)
    return np.array(out, dtype=float), round(float(np.median(gains)), 3) if gains else None


def _spans(t: np.ndarray, moving: np.ndarray) -> list:
    """Index pairs around each burst of motion, closing gaps shorter than QUIET_S."""
    hits = np.flatnonzero(moving)
    spans = []
    for i in hits:
        if spans and t[i] - t[spans[-1][1]] <= QUIET_S:
            spans[-1][1] = int(i)
        else:
            spans.append([int(i), int(i)])
    return spans


def _bezier(x1: float, y1: float, x2: float, y2: float):
    s = np.linspace(0, 1, 2001)
    xs = 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s**2 * x2 + s**3
    ys = 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s**2 * y2 + s**3
    return lambda u: np.interp(np.clip(u, 0, 1), xs, ys)


def _fits(t: np.ndarray, v: np.ndarray, start: float, end: float, begin: float, delta: float, eases: dict, lead: float = 0.0) -> list:
    """The curves closest to one move. Frames just after it count, so a curve cannot fit by running long. The true start lies up to lead before the first changed frame."""
    keep = (t >= start - lead) & (t <= end + QUIET_S)
    if ((t >= start) & (t <= end)).sum() < MIN_MOVE_SAMPLES or keep.sum() < MIN_FIT_SAMPLES or not delta:
        return []
    u, p = t[keep] - start, (v[keep] - begin) / delta
    span = max(end - start, FRAME_S)
    rms = lambda model: float(np.sqrt(((model - p) ** 2).mean()))
    offsets = np.unique(np.linspace(0, lead, 5))
    out = []
    for name, ease in eases.items():
        lengths = [span] if name == LINEAR else np.geomspace(max(span * 0.7, 0.05), span * 4, 48)
        err, length = min((rms(ease((u + o) / d)), float(d)) for d in lengths for o in offsets)
        out.append({"ease": name, "durationS": round(length, 3), "tauMs": None, "error": round(err, 4)})
    err, tau = min((rms(1 - np.exp(-np.maximum(u + o, 0) / k)), float(k)) for k in np.geomspace(span / 12, span, 48) for o in offsets)
    out.append({"ease": EXPONENTIAL, "durationS": None, "tauMs": round(tau * 1000), "error": round(err, 4)})
    return sorted(out, key=lambda f: f["error"])[:TOP_FITS]


def _start(t: np.ndarray, a: int) -> float:
    return float(t[a] - min(t[a] - t[a - 1], FRAME_S))


def _moves(t: np.ndarray, v: np.ndarray, unit: str, eases: dict) -> list:
    out = []
    changed = np.diff(v, prepend=v[0]) != 0
    for a, b in _spans(t, changed):
        begin, final = float(v[a - 1]), float(v[b])
        path = v[a - 1 : b + 1]
        if abs(path - begin).max() < MIN_MOVE[unit]:
            continue
        delta = final - begin
        over = float(((path - final) * (1 if delta >= 0 else -1)).max())
        start = _start(t, a)
        out.append({"startS": round(start, 3), "durationS": round(float(t[b]) - start, 3), "delta": round(delta, 1), "overshoot": round(over, 1), "fits": _fits(t, v, float(t[a]), float(t[b]), begin, delta, eases, min(float(t[a] - t[a - 1]), MAX_LEAD_S))})
    return out


def _bursts(t: np.ndarray, share: np.ndarray) -> list:
    out = []
    for a, b in _spans(t, share > ACTIVE):
        start = _start(t, a)
        out.append({"startS": round(start, 3), "durationS": round(float(t[b]) - start, 3), "delta": round(float(share[a : b + 1].max()), 4), "overshoot": None, "fits": []})
    return out


def _coast(t: np.ndarray, v: np.ndarray, moves: list, wheel_end: float | None, eases: dict, rigid: bool) -> dict | None:
    """The part of the motion after the wheel stops, fitted on its own, since the wheel drives everything before it."""
    last = max((m["startS"] + m["durationS"] for m in moves), default=None)
    if wheel_end is None or last is None or last <= wheel_end:
        return None
    ms = round((last - wheel_end) * 1000)
    if not rigid:
        return {"ms": ms, "delta": None, "fits": []}
    begin = float(v[max(int(np.searchsorted(t, wheel_end, side="right")) - 1, 0)])
    delta = float(v[int(np.searchsorted(t, last + 1e-6, side="left")) - 1]) - begin
    return {"ms": ms, "delta": round(delta, 1), "fits": _fits(t, v, wheel_end, last, begin, delta, eases)}


def _channel(name: str, unit: str, t: np.ndarray, v: np.ndarray, moves: list, rigid: float | None, wheel_end: float | None, eases: dict) -> dict:
    # A tail too small to see would otherwise split the period.
    peak = max((abs(m["delta"]) for m in moves), default=0)
    gaps = np.diff([m["startS"] for m in moves if abs(m["delta"]) >= peak * PERIOD_SHARE])
    kept = range(len(t)) if len(t) <= MAX_SAMPLES else [i * (len(t) - 1) // (MAX_SAMPLES - 1) for i in range(MAX_SAMPLES)]
    return {
        "name": name,
        "unit": unit,
        "rigid": rigid,
        "coast": _coast(t, v, moves, wheel_end, eases, rigid is not None),
        "periodS": round(float(np.median(gaps)), 3) if len(gaps) >= 2 else None,
        "periodCv": round(float(gaps.std() / max(gaps.mean(), 0.001)), 3) if len(gaps) >= 2 else None,
        "moves": moves,
        "samples": [[round(float(a), 3), round(float(b), 4)] for a, b in zip(t[kept], v[kept])],
    }


def _box(text: str, shape: tuple) -> list:
    try:
        x0, y0, x1, y1 = (int(p) for p in text.split(","))
    except ValueError:
        raise cli.AtomError("invalid_args", f"{text} is not x0,y0,x1,y1") from None
    h, w = shape
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, w), min(y1, h)
    if x1 - x0 < 4 or y1 - y0 < 4:
        raise cli.AtomError("invalid_args", f"the box {text} leaves too little of a {w} by {h} frame")
    return [x0, y0, x1, y1]


def _eases(bundle: str | None) -> dict:
    eases = {LINEAR: lambda u: np.clip(u, 0, 1)}
    if not bundle:
        return eases
    try:
        listed = json.loads(Path(bundle).expanduser().read_text(encoding="utf-8")).get("easings", [])
    except (OSError, json.JSONDecodeError) as e:
        raise _bad(f"{bundle} is not a bundle: {e}") from None
    for entry in listed:
        if m := BEZIER.fullmatch(entry["value"].strip()):
            eases[entry["value"]] = _bezier(*(float(g) for g in m.groups()))
    return eases


def trace(sweep: str, run: str, box: str, bundle: str | None = None) -> dict:
    file = Path(sweep).expanduser()
    try:
        spec = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise _bad(f"{sweep} is not a sweep: {e}") from None
    entry = next((r for r in spec["runs"] if r["id"] == run), None)
    if entry is None or "frames" not in entry:
        raise cli.AtomError("invalid_args", f"{sweep} has no run {run} with frames")
    root = file.parent
    frames = entry["frames"]
    missing = sum(not (root / f["file"]).exists() for f in frames)
    if missing or len(frames) < 2:
        raise _bad(f"{run} lost {missing} of {len(frames)} frames. Sweep it with page-sweep capture, which keeps them all")
    eases = _eases(bundle)
    bundle_key = file_sha256(Path(bundle).expanduser()) if bundle else ""
    key = f"{file_sha256(file)}-{run}-{box}-{bundle_key}"
    cache = Cache("motion-trace")
    if cached := cache.get(key):
        return {**cached, "source": str(file)}

    full = _grey(root / frames[0]["file"])
    x0, y0, x1, y1 = rect = _box(box, full.shape)
    t = np.array([f["t"] for f in frames], dtype=float)
    cx, cy, radius = (x0 + x1) / 2, (y0 + y1) / 2, min(x1 - x0, y1 - y0) / 2
    angles = np.deg2rad(np.arange(360))
    rings = [((cx + radius * k * np.cos(angles)).astype(int), (cy + radius * k * np.sin(angles)).astype(int)) for k in RINGS]
    across, down, round_, share, last = [], [], [], [], full[y0:y1, x0:x1]
    touched = np.zeros((y1 - y0, x1 - x0), bool)
    for f in frames:
        grey = _grey(root / f["file"])
        crop = grey[y0:y1, x0:x1]
        across.append(crop.mean(axis=0))
        down.append(crop.mean(axis=1))
        round_.append(np.stack([grey[ys, xs] for xs, ys in rings]))
        hit = np.abs(crop - last) > CHANGED
        share.append(float(hit.mean()))
        if share[-1] > ACTIVE:
            touched |= hit
            last = crop

    wheel_end = next((e["t"] for e in entry.get("events", []) if e["type"] == "wheel-end"), None)
    channels = []
    for name, unit, profiles, best_step in (("x", "px", across, _best_shift), ("y", "px", down, _best_shift), ("angle", "deg", round_, _best_turn)):
        v, rigid = _follow(profiles, best_step)
        if rigid is not None and rigid >= RIGID:
            if moves := _moves(t, v, unit, eases):
                channels.append(_channel(name, unit, t, v, moves, rigid, wheel_end, eases))
    activity = np.array(share)
    channels.append(_channel("activity", "share", t, activity, _bursts(t, activity), None, wheel_end, eases))
    ys, xs = np.nonzero(touched)
    active = [int(xs.min()) + x0, int(ys.min()) + y0, int(xs.max()) + x0 + 1, int(ys.max()) + y0 + 1] if len(xs) else None
    result = {"source": str(file), "run": run, "box": rect, "activeBox": active, "frames": len(frames), "spanS": round(float(t[-1] - t[0]), 3), "wheelEndS": wheel_end, "cacheHit": False, "channels": channels}
    cache.put(key, result)
    return result


def _curve(fits: list) -> str:
    """The best curve, plus any others too close to call."""
    named = [f"{f['ease']} {f['tauMs']} ms tau" if f["tauMs"] is not None else f"{f['ease']} over {f['durationS']} s" for f in fits if f["error"] <= fits[0]["error"] + TIE]
    return f", {' or '.join(named)}, error {fits[0]['error']}" if fits else ""


def _text(r: dict) -> str:
    lines = [f"{r['run']} box {r['box']}, changes within {r['activeBox']}, {r['frames']} frames over {r['spanS']} s"]
    for c in r["channels"]:
        extras = {k: c[k] for k in ("rigid", "periodS", "periodCv") if c[k] is not None}
        lines.append(f"{c['name']} ({c['unit']}) {len(c['moves'])} moves {json.dumps(extras)}")
        for m in c["moves"]:
            over = f", over {m['overshoot']}" if m["overshoot"] else ""
            lines.append(f"  {m['startS']} s for {m['durationS']} s, {m['delta']}{over}{_curve(m['fits'])}")
        if c["coast"]:
            lines.append(f"  after the wheel {c['coast']['ms']} ms, {c['coast']['delta']}{_curve(c['coast']['fits'])}")
    return "\n".join(lines)


if __name__ == "__main__":
    cli.main(Path(__file__).resolve().parent.parent, {"trace": cli.Verb(trace, _text)})
