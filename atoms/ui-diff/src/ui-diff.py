# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "jsonschema>=4.18", "numpy>=2", "pillow>=11"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import hashlib
import json
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
RECORDING_SCHEMA = json.loads((HERE.parents[2] / "contracts" / "ui-recording.schema.json").read_text(encoding="utf-8"))

# Bump when the comparison or the score changes, so cached diffs from the old formula stop matching.
VERSION = 1
SCALE = 2
STYLE_CAP = 50
WEIGHTS = {"pixels": 0.5, "frames": 0.2, "styles": 0.2, "animations": 0.1}
TIMING = ("type", "duration", "delay", "easing", "iterations")
GAP = 4
BACKGROUND = (40, 40, 40, 255)
OUTSIDE = (255, 0, 255, 255)

ZERO = re.compile(r"(?<![\w.#-])-?0(?:\.0+)?(?:px|em|rem|%|s|ms|deg|vh|vw)?(?![\w.%])")
OPAQUE = re.compile(r"rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*1(?:\.0+)?\s*\)")
NTH = re.compile(r"nth-child\((\d+)\)")


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
        raise cli.AtomError("invalid_source", f"{path} is not a ui-recording: " + "; ".join(f"{e.json_path}: {e.message}" for e in errors))
    states = {}
    for st in recording["states"]:
        if st["name"] in states:
            raise cli.AtomError("invalid_source", f"{path} has two states named {st['name']!r}")
        state = {**st, "screenshot": file.parent / st["screenshot"], "frames": [file.parent / f for f in st["frames"]], "styles": file.parent / st["styles"]}
        for f in [state["screenshot"], *state["frames"], state["styles"]]:
            if not f.is_file():
                raise cli.AtomError("invalid_source", f"{path}: state {st['name']!r} points at {f}, which is not a file")
        states[st["name"]] = state
    return {"path": str(file), "states": states}


def _fingerprint(recording: dict) -> list:
    return [
        {"name": name, "screenshot": file_sha256(s["screenshot"]), "frames": [file_sha256(f) for f in s["frames"]], "styles": file_sha256(s["styles"]), "animations": s["animations"]}
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


def _diff_image(x: np.ndarray, y: np.ndarray, delta: np.ndarray, tolerance: int, out: Path) -> str:
    h, w = max(x.shape[0], y.shape[0]), max(x.shape[1], y.shape[1])
    canvas = np.empty((h, 3 * w + 2 * GAP, 4), dtype=np.uint8)
    canvas[:] = BACKGROUND
    canvas[: x.shape[0], : x.shape[1]] = x
    canvas[: y.shape[0], w + GAP : w + GAP + y.shape[1]] = y
    heat = canvas[:, 2 * (w + GAP) :]
    heat[: x.shape[0], : x.shape[1]] = OUTSIDE
    heat[: y.shape[0], : y.shape[1]] = OUTSIDE
    oh, ow = delta.shape
    gray = (x[:oh, :ow, :3] @ np.array([0.299, 0.587, 0.114]) * 0.35).astype(np.uint8)
    heat[:oh, :ow, 0] = np.where(delta > tolerance, 96 + delta.astype(np.int32) * 159 // 255, gray)
    heat[:oh, :ow, 1] = np.where(delta > tolerance, 0, gray)
    heat[:oh, :ow, 2] = np.where(delta > tolerance, 0, gray)
    heat[:oh, :ow, 3] = 255
    Image.fromarray(canvas, "RGBA").save(out)
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
    diffs, compared = [], 0
    for path in shared:
        for prop in sorted(set(a[path]) | set(b[path])):
            compared += 1
            va, vb = a[path].get(prop), b[path].get(prop)
            if _normalize(va) != _normalize(vb):
                diffs.append({"path": path, "property": prop, "a": va, "b": vb})
    if not compared:
        return [], 1.0 if not a and not b else 0.0
    return diffs[:STYLE_CAP], 1 - len(diffs) / compared


def _summary(a: dict) -> dict:
    easings = {k.get("easing") for k in a["keyframes"][:-1]}
    easing = easings.pop() if a["easing"] == "linear" and len(easings) == 1 and None not in easings else a["easing"]
    target = a["target"] + (a["pseudoElement"] or "")
    return {"type": a["type"], "name": a["name"], "target": target, "duration": a["duration"], "delay": a["delay"], "easing": easing, "iterations": a["iterations"]}


def _grouped(animations: list) -> dict:
    # ui-record keeps animations whose keyframes differ, so equal summaries repeat. Keeping the repeats lets a changed duration pair with the one it replaced.
    groups: dict[tuple, list] = {}
    for a in map(_summary, animations):
        groups.setdefault((a["target"], a["name"]), []).append(a)
    order = lambda a: (a["type"], a["duration"], a["delay"], a["easing"], str(a["iterations"]))
    return {key: sorted(g, key=order) for key, g in groups.items()}


def _animations(list_a: list, list_b: list) -> tuple[dict, float | None]:
    ga, gb = _grouped(list_a), _grouped(list_b)
    only_a, only_b, changed = [], [], []
    same = total = 0
    for key in sorted(set(ga) | set(gb), key=lambda k: (_path_key(k[0]), k[1])):
        xa, xb = ga.get(key, []), gb.get(key, [])
        for sa, sb in zip(xa, xb):
            fields = [f for f in TIMING if sa[f] != sb[f]]
            changed += [{"summary": sa, "field": f, "a": sa[f], "b": sb[f]} for f in fields]
            same += not fields
        only_a += xa[len(xb) :]
        only_b += xb[len(xa) :]
        total += max(len(xa), len(xb))
    return {"onlyA": only_a, "onlyB": only_b, "changed": changed}, (same / total if total else None)


def _missing(name: str, sa: dict | None, sb: dict | None) -> dict:
    size = lambda s: _size(_rgba(s["screenshot"])) if s else None
    return {
        "name": name, "score": 0.0, "missing": "a" if sa is None else "b",
        "size": {"a": size(sa), "b": size(sb)}, "pixels": None, "frames": [], "styles": [],
        "animations": {"onlyA": [], "onlyB": [], "changed": []}, "image": None,
    }


def _state(index: int, name: str, sa: dict, sb: dict, tolerance: int, out: Path) -> dict:
    x, y = _rgba(sa["screenshot"]), _rgba(sb["screenshot"])
    settled = _compare(x, y, tolerance)
    slug = f"{index:02d}-" + (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "state")
    image = _diff_image(x, y, settled["delta"], tolerance, out / f"{slug}.png")

    frames, frame_scores = [], []
    for i in range(max(len(sa["frames"]), len(sb["frames"]))):
        if i < len(sa["frames"]) and i < len(sb["frames"]):
            c = _compare(_rgba(sa["frames"][i]), _rgba(sb["frames"][i]), tolerance)
            frames.append({"index": i, "mismatch": _r(c["mismatch"])})
            frame_scores.append(c["similarity"])
        else:
            frames.append({"index": i, "mismatch": None})
            frame_scores.append(0.0)

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
        "frames": frames, "styles": styles, "animations": animations, "image": image,
    }


def compare(a: str, b: str, tolerance: int) -> dict:
    if not 0 <= tolerance <= 255:
        raise cli.AtomError("invalid_args", f"--tolerance must be from 0 to 255, not {tolerance}.")
    ra, rb = _load(a), _load(b)
    fingerprint = {"v": VERSION, "tolerance": tolerance, "a": _fingerprint(ra), "b": _fingerprint(rb)}
    key = hashlib.sha256(json.dumps(fingerprint, sort_keys=True).encode()).hexdigest()
    cache = Cache("ui-diff")
    if (cached := cache.get(key)) and all(Path(s["image"]).is_file() for s in cached["states"] if s["image"]):
        return {**cached, "a": ra["path"], "b": rb["path"]}

    names = list(ra["states"]) + [n for n in rb["states"] if n not in ra["states"]]
    staging = Path(tempfile.mkdtemp(dir=paths.atom_dir("ui-diff", "tmp")))
    final = paths.atom_dir("ui-diff", "files") / key
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
        if s["image"]:
            s["image"] = str(final / Path(s["image"]).name)
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
