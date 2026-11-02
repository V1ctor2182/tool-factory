# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "jsonschema>=4.18", "numpy>=2", "pillow>=11"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import hashlib
import json
import math
import re
import shutil
import tempfile
from pathlib import Path

import numpy as np
from factory_kit import cli, paths
from factory_kit.cache import Cache
from factory_kit.hash import file_sha256
from jsonschema import Draft202012Validator
from PIL import Image, UnidentifiedImageError

HERE = Path(__file__).resolve().parent
RECORDING_SCHEMA = json.loads((HERE.parents[2] / "contracts" / "page-recording.schema.json").read_text(encoding="utf-8"))

# Bump when the comparison or the score changes, so cached diffs from the old formula stop matching.
VERSION = 2
SCALE = 2
STYLE_CAP = 50
PATH_CAP = 5
MOTION_CAP = 20
SHEET_MAX = 4096
WEIGHTS = {"pixels": 0.5, "frames": 0.2, "styles": 0.2, "animations": 0.1}
TIMING = ("type", "duration", "delay", "easing", "iterations")
KEYFRAME_TIMING = {"offset", "easing", "composite"}
# Largest difference per matrix3d component that still counts as the same motion: translation in CSS pixels, the rest unitless.
MOVE_PX, MATRIX_EPS, OPACITY_EPS = 0.5, 0.01, 0.01
TRANSLATE = {12, 13, 14}
GAP = 4
BACKGROUND = (40, 40, 40, 255)
OUTSIDE = (255, 0, 255, 255)

ZERO = re.compile(r"(?<![\w.#-])-?0(?:\.0+)?(?:px|em|rem|%|s|ms|deg|vh|vw)?(?![\w.%])")
OPAQUE = re.compile(r"rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*1(?:\.0+)?\s*\)")
NTH = re.compile(r"nth-child\((\d+)\)")
NUMBER = re.compile(r"-?\d*\.?\d+(?:e-?\d+)?")


def _r(x: float) -> float:
    return round(float(x), 6)


def _load(path: str) -> dict:
    file = Path(path).expanduser().resolve()
    try:
        recording = json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise cli.AtomError("invalid_source", f"Cannot read {path} as JSON: {e}") from None
    errors = sorted(Draft202012Validator(RECORDING_SCHEMA).iter_errors(recording), key=str)
    if errors:
        raise cli.AtomError("invalid_source", f"{path} is not a page-recording: " + "; ".join(f"{e.json_path}: {e.message}" for e in errors))
    states = {}
    for st in recording["states"]:
        if st["name"] in states:
            raise cli.AtomError("invalid_source", f"{path} has two states named {st['name']!r}")
        state = {**st, **{k: file.parent / st[k] for k in ("screenshot", "styles", "motion")}, "frames": [file.parent / f for f in st["frames"]]}
        for f in [state["screenshot"], *state["frames"], state["styles"], state["motion"]]:
            if not f.is_file():
                raise cli.AtomError("invalid_source", f"{path}: state {st['name']!r} points at {f}, which is not a file")
        states[st["name"]] = state
    return {"path": str(file), "states": states}


def _fingerprint(recording: dict) -> list:
    return [
        {"name": name, "screenshot": file_sha256(s["screenshot"]), "frames": [file_sha256(f) for f in s["frames"]], "styles": file_sha256(s["styles"]), "motion": file_sha256(s["motion"]), "animations": s["animations"]}
        for name, s in recording["states"].items()
    ]


def _rgba(path: Path) -> np.ndarray:
    try:
        with Image.open(path) as im:
            return np.asarray(im.convert("RGBA"), dtype=np.int16)
    except (UnidentifiedImageError, OSError) as e:
        raise cli.AtomError("invalid_source", f"{path} is not an image: {e}") from None


def _css(n: int) -> int | float:
    return n // SCALE if n % SCALE == 0 else n / SCALE


def _size(img: np.ndarray) -> list:
    return [_css(img.shape[1]), _css(img.shape[0])]


def _compare(x: np.ndarray, y: np.ndarray, tolerance: int) -> dict:
    h, w = min(x.shape[0], y.shape[0]), min(x.shape[1], y.shape[1])
    delta = np.abs(x[:h, :w] - y[:h, :w]).max(axis=2)
    overlap = h * w
    union = x.shape[0] * x.shape[1] + y.shape[0] * y.shape[1] - overlap
    mismatch = float((delta > tolerance).sum()) / overlap
    return {"delta": delta, "mismatch": mismatch, "meanDelta": float(delta.mean()), "similarity": (1 - mismatch) * overlap / union}


def _panels(x: np.ndarray, y: np.ndarray, delta: np.ndarray, tolerance: int) -> list[np.ndarray]:
    """a, b, and the heatmap, each padded to the larger screenshot's size."""
    h, w = max(x.shape[0], y.shape[0]), max(x.shape[1], y.shape[1])
    pa, pb, heat = (np.full((h, w, 4), BACKGROUND, dtype=np.uint8) for _ in range(3))
    pa[: x.shape[0], : x.shape[1]] = x
    pb[: y.shape[0], : y.shape[1]] = y
    heat[: x.shape[0], : x.shape[1]] = OUTSIDE
    heat[: y.shape[0], : y.shape[1]] = OUTSIDE
    oh, ow = delta.shape
    gray = (x[:oh, :ow, :3] @ np.array([0.299, 0.587, 0.114]) * 0.35).astype(np.uint8)
    heat[:oh, :ow, 0] = np.where(delta > tolerance, 96 + delta.astype(np.int32) * 159 // 255, gray)
    heat[:oh, :ow, 1] = np.where(delta > tolerance, 0, gray)
    heat[:oh, :ow, 2] = np.where(delta > tolerance, 0, gray)
    heat[:oh, :ow, 3] = 255
    return [pa, pb, heat]


def _join(images: list[np.ndarray], axis: int) -> np.ndarray:
    shape = list(images[0].shape)
    shape[axis] = GAP
    gap = np.full(shape, BACKGROUND, dtype=np.uint8)
    return np.concatenate([part for im in images for part in (gap, im)][1:], axis=axis)


def _save(canvas: np.ndarray, out: Path) -> str:
    im = Image.fromarray(canvas, "RGBA")
    im.thumbnail((SHEET_MAX, SHEET_MAX))
    im.save(out)
    return str(out)


def _normalize(value) -> str | None:
    if value is None:
        return None
    v = re.sub(r"\s*,\s*", ", ", re.sub(r"\s+", " ", str(value).strip()))
    v = "rgba(0, 0, 0, 0)" if v == "transparent" else v
    return ZERO.sub("0", OPAQUE.sub(r"rgb(\1, \2, \3)", v))


def _path_key(path: str) -> tuple:
    return (path.count(">"), [int(n) for n in NTH.findall(path)], path)


def _styles(path_a: Path, path_b: Path) -> tuple[list, float]:
    a = json.loads(path_a.read_text(encoding="utf-8"))
    b = json.loads(path_b.read_text(encoding="utf-8"))
    shared = sorted(set(a) & set(b), key=_path_key)
    # One cause, such as a missing font, changes the same property the same way on every element, so diffs group by property and values.
    groups: dict[tuple, dict] = {}
    differing = compared = 0
    for path in shared:
        for prop in sorted(set(a[path]) | set(b[path])):
            compared += 1
            va, vb = a[path].get(prop), b[path].get(prop)
            if _normalize(va) != _normalize(vb):
                differing += 1
                group = groups.setdefault((prop, _normalize(va), _normalize(vb)), {"property": prop, "a": va, "b": vb, "count": 0, "paths": []})
                group["count"] += 1
                group["paths"] += [path][: PATH_CAP - len(group["paths"])]
    if not compared:
        return [], 1.0 if not a and not b else 0.0
    return list(groups.values())[:STYLE_CAP], 1 - differing / compared


def _summary(a: dict) -> dict:
    easings = {k.get("easing") for k in a["keyframes"][:-1]}
    easing = easings.pop() if a["easing"] == "linear" and len(easings) == 1 and None not in easings else a["easing"]
    target = a["target"] + (a["pseudoElement"] or "")
    keyframes = [{"offset": k.get("offset"), **{p: _normalize(v) for p, v in sorted(k.items()) if p not in KEYFRAME_TIMING}} for k in a["keyframes"]]
    properties = sorted({p for k in keyframes for p in k if p != "offset"})
    return {
        "type": a["type"], "name": a["name"], "target": target, "properties": properties,
        "duration": a["duration"], "delay": a["delay"], "easing": easing, "iterations": a["iterations"], "keyframes": keyframes,
    }


def _by_target(animations: list) -> dict:
    groups: dict[str, list] = {}
    order = lambda a: (a["type"], a["duration"], a["delay"], a["easing"], str(a["iterations"]))
    for a in sorted(map(_summary, animations), key=order):
        groups.setdefault(a["target"], []).append(a)
    return groups


def _pair(xa: list, xb: list) -> list[tuple]:
    # Names are the author's choice, so a rebuild's renamed keyframes pair by what they animate: equal keyframes first, then the same animated properties.
    pairs = []
    for alike in (lambda p, q: p["keyframes"] == q["keyframes"], lambda p, q: p["properties"] == q["properties"]):
        for p in list(xa):
            q = next((q for q in xb if alike(p, q)), None)
            if q is not None:
                pairs.append((p, q))
                xa.remove(p)
                xb.remove(q)
    return pairs


def _animations(list_a: list, list_b: list) -> tuple[dict, float | None]:
    ga, gb = _by_target(list_a), _by_target(list_b)
    only_a, only_b, changed = [], [], []
    same = total = 0
    public = lambda a: {k: v for k, v in a.items() if k != "keyframes"}
    for target in sorted(set(ga) | set(gb), key=_path_key):
        xa, xb = ga.get(target, []), gb.get(target, [])
        for sa, sb in _pair(xa, xb):
            fields = [f for f in (*TIMING, "keyframes") if sa[f] != sb[f]]
            changed += [{"summary": public(sa), "field": f, "a": sa[f], "b": sb[f]} for f in fields]
            same += not fields
            total += 1
        only_a += map(public, xa)
        only_b += map(public, xb)
        total += len(xa) + len(xb)
    return {"onlyA": only_a, "onlyB": only_b, "changed": changed}, (same / total if total else None)


def _matrix(prop: str, value: str) -> list[float]:
    if prop == "opacity":
        return [float(value)]
    n = [float(v) for v in NUMBER.findall(value.partition("(")[2])] if value and value != "none" else [1, 0, 0, 1, 0, 0]
    return n if len(n) == 16 else [n[0], n[1], 0, 0, n[2], n[3], 0, 0, 0, 0, 1, 0, n[4], n[5], 0, 1]


def _distance(prop: str, va: str | None, vb: str | None) -> float:
    """How far apart two computed values are, in multiples of what still counts as the same. Above 1 they differ."""
    if va is None or vb is None:
        # page-record writes null for a frame where the element is not in the DOM.
        return 0.0 if va == vb else math.inf
    eps = lambda i: OPACITY_EPS if prop == "opacity" else MOVE_PX if i in TRANSLATE else MATRIX_EPS
    return max(abs(x - y) / eps(i) for i, (x, y) in enumerate(zip(_matrix(prop, va), _matrix(prop, vb))))


def _motion(path_a: Path, path_b: Path) -> list:
    ta = json.loads(path_a.read_text(encoding="utf-8"))["tracks"]
    tb = json.loads(path_b.read_text(encoding="utf-8"))["tracks"]
    out = []
    for path in sorted(set(ta) | set(tb), key=_path_key):
        for prop in sorted(set(ta.get(path, {})) | set(tb.get(path, {}))):
            va, vb = ta.get(path, {}).get(prop), tb.get(path, {}).get(prop)
            frame = None
            if va and vb:
                gaps = [_distance(prop, x, y) for x, y in zip(va, vb)]
                if max(gaps, default=0) <= 1:
                    continue
                frame = gaps.index(max(gaps))
            out.append({"path": path, "property": prop, "frame": frame, "a": va, "b": vb})
    return out[:MOTION_CAP]


def _missing(name: str, sa: dict | None, sb: dict | None) -> dict:
    size = lambda s: _size(_rgba(s["screenshot"])) if s else None
    return {
        "name": name, "score": 0.0, "missing": "a" if sa is None else "b",
        "size": {"a": size(sa), "b": size(sb)}, "pixels": None, "frames": [], "styles": [],
        "animations": {"onlyA": [], "onlyB": [], "changed": []}, "motion": [], "image": None, "sheet": None,
    }


def _state(index: int, name: str, sa: dict, sb: dict, tolerance: int, out: Path) -> dict:
    x, y = _rgba(sa["screenshot"]), _rgba(sb["screenshot"])
    settled = _compare(x, y, tolerance)
    slug = f"{index:02d}-" + (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "state")
    image = _save(_join(_panels(x, y, settled["delta"], tolerance), axis=1), out / f"{slug}.png")

    frames, frame_scores, columns = [], [], []
    for i in range(max(len(sa["frames"]), len(sb["frames"]))):
        if i < len(sa["frames"]) and i < len(sb["frames"]):
            fx, fy = _rgba(sa["frames"][i]), _rgba(sb["frames"][i])
            c = _compare(fx, fy, tolerance)
            frames.append({"index": i, "mismatch": _r(c["mismatch"])})
            frame_scores.append(c["similarity"])
            columns.append(_join(_panels(fx, fy, c["delta"], tolerance), axis=0))
        else:
            frames.append({"index": i, "mismatch": None})
            frame_scores.append(0.0)

    sheet = None
    if columns:
        h, w = max(c.shape[0] for c in columns), max(c.shape[1] for c in columns)
        padded = [np.full((h, w, 4), BACKGROUND, dtype=np.uint8) for _ in columns]
        for canvas, c in zip(padded, columns):
            canvas[: c.shape[0], : c.shape[1]] = c
        sheet = _save(_join(padded, axis=1), out / f"{slug}.sheet.png")
    styles, styles_term = _styles(sa["styles"], sb["styles"])
    animations, animations_term = _animations(sa["animations"], sb["animations"])
    terms = {
        "pixels": settled["similarity"],
        "frames": sum(frame_scores) / len(frame_scores) if frame_scores else None,
        "styles": styles_term,
        "animations": animations_term,
    }
    present = {k: t for k, t in terms.items() if t is not None}
    score = sum(WEIGHTS[k] * t for k, t in present.items()) / sum(WEIGHTS[k] for k in present)
    return {
        "name": name, "score": _r(score), "missing": None,
        "size": {"a": _size(x), "b": _size(y)},
        "pixels": {"mismatch": _r(settled["mismatch"]), "meanDelta": _r(settled["meanDelta"])},
        "frames": frames, "styles": styles, "animations": animations, "motion": _motion(sa["motion"], sb["motion"]),
        "image": image, "sheet": sheet,
    }


def compare(a: str, b: str, tolerance: int) -> dict:
    if not 0 <= tolerance <= 255:
        raise cli.AtomError("invalid_args", f"--tolerance must be from 0 to 255, not {tolerance}.")
    ra, rb = _load(a), _load(b)
    fingerprint = {"v": VERSION, "tolerance": tolerance, "a": _fingerprint(ra), "b": _fingerprint(rb)}
    key = hashlib.sha256(json.dumps(fingerprint, sort_keys=True).encode()).hexdigest()
    cache = Cache("page-diff")
    if (cached := cache.get(key)) and all(Path(f).is_file() for s in cached["states"] for f in (s["image"], s["sheet"]) if f):
        return {**cached, "a": ra["path"], "b": rb["path"]}

    names = list(ra["states"]) + [n for n in rb["states"] if n not in ra["states"]]
    staging = Path(tempfile.mkdtemp(dir=paths.atom_dir("page-diff", "tmp")))
    final = paths.atom_dir("page-diff", "files") / key
    try:
        states = []
        for i, name in enumerate(names):
            sa, sb = ra["states"].get(name), rb["states"].get(name)
            states.append(_state(i, name, sa, sb, tolerance, staging) if sa and sb else _missing(name, sa, sb))
        shutil.rmtree(final, ignore_errors=True)
        staging.rename(final)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    for s in states:
        for f in ("image", "sheet"):
            if s[f]:
                s[f] = str(final / Path(s[f]).name)
    result = {"a": ra["path"], "b": rb["path"], "tolerance": tolerance, "score": _r(sum(s["score"] for s in states) / len(states)), "states": states}
    cache.put(key, result)
    return result


def _text(result: dict) -> str:
    lines = [
        f"{s['name']}  {s['score']:.4f}  " + (f"missing in {s['missing']}" if s["missing"] else f"{s['pixels']['mismatch']:.4f}")
        for s in result["states"]
    ]
    return "\n".join([*lines, f"score {result['score']:.4f}"])


if __name__ == "__main__":
    cli.main(HERE.parent, {"compare": cli.Verb(compare, _text)})
