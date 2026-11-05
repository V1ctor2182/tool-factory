# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=11"]
# ///
"""Writes a small synthetic sweep with known motion, so the expected measures can be checked by hand."""
import json
from pathlib import Path

from PIL import Image, ImageDraw

W, H = 160, 100
OUT = Path(__file__).parent / "fixtures" / "sweep"
BLUE, PINK, GREEN = (10, 36, 180), (178, 0, 91), (75, 240, 142)


def frame(run: str, name: str, colour, box=None, ink=GREEN) -> str:
    im = Image.new("RGB", (W, H), colour)
    if box:
        ImageDraw.Draw(im).rectangle(box, fill=ink)
    (OUT / run).mkdir(parents=True, exist_ok=True)
    im.save(OUT / run / f"{name}.png")
    return f"{run}/{name}.png"


def mix(k: float):
    return tuple(round(a + (b - a) * k) for a, b in zip(BLUE, PINK))


stops = []
for i, y in enumerate(range(0, 1000, 100)):
    k = max(0.0, min(1.0, (y - 300) / 300))
    active = 400 <= y <= 700
    stops.append({"y": y, "a": frame("walk", f"{i:02d}a", mix(k)), "b": frame("walk", f"{i:02d}b", mix(k), (10, 10, 40, 40) if active else None)})
idle = [{"file": frame("idle", f"{i:02d}", BLUE, (20 + 20 * (i // 5 % 4), 20, 30 + 20 * (i // 5 % 4), 60) if i % 5 == 0 else None), "t": i / 10, "y": 0} for i in range(40)]
hover = [{"file": frame("hover", f"{i:02d}", BLUE, (0, 0, 40, 40) if 12 <= i < 30 else None, (255, 204, 51)), "t": i / 10, "y": 0} for i in range(40)]
click = [{"file": frame("click", f"{i:02d}", PINK if i >= 15 else BLUE), "t": i / 10, "y": 0} for i in range(30)]
pointer = [{"file": frame("path", f"{i:02d}", BLUE, (4 * i, 40, 4 * i + 20, 60) if i >= 10 else None), "t": i / 10, "y": 0} for i in range(30)]
load = [{"file": frame("load", f"{i:02d}", (0, 0, 0) if i < 5 else BLUE), "t": i / 2, "y": 0} for i in range(10)]
scroll = [{"file": frame("pass", f"{i:02d}", BLUE), "t": i / 10, "y": min(i, 10) * 40} for i in range(20)]
sweep = {
    "url": "file:///fixture.html", "sweep": "sweep.json", "viewport": [W, H], "loadErrors": [],
    "runs": [
        {"id": "walk", "kind": "walk", "status": "ok", "errors": [], "stops": stops, "overflow": {"scrollWidth": W, "viewport": W, "sidewaysPx": 0}},
        {"id": "idle", "kind": "idle", "status": "ok", "errors": [], "at": 0, "scrollY": 0, "frames": idle, "events": [], "worstGapMs": 17, "forMs": 8000},
        {"id": "hover", "kind": "hover", "status": "ok", "errors": [], "at": 0, "scrollY": 0, "frames": hover, "events": [{"t": 1.0, "type": "enter", "x": 20, "y": 20}, {"t": 3.0, "type": "exit"}], "cursor": "pointer"},
        {"id": "click", "kind": "click", "status": "ok", "errors": [], "at": 0, "scrollY": 0, "frames": click, "events": [{"t": 1.0, "type": "click", "x": 20, "y": 20}], "worstGapMs": 17, "state": {"scrollY": 0, "hash": "#two", "focus": "BODY", "height": 900, "blocked": {"writes": 0, "navigations": []}}},
        {"id": "path", "kind": "path", "status": "ok", "errors": [], "at": 0, "scrollY": 0, "frames": pointer, "events": [{"t": 0.9, "type": "start", "x": 40, "y": 50}] + [{"t": 1 + k / 10, "type": "move", "x": 40 + 4 * k, "y": 50} for k in range(20)] + [{"t": 3.0, "type": "end"}]},
        {"id": "load", "kind": "load", "status": "ok", "errors": [], "frames": load, "events": []},
        {"id": "pass", "kind": "pass", "status": "ok", "errors": [], "at": 0, "scrollY": 0, "frames": scroll, "events": [{"t": 0.5, "type": "wheel-start"}, {"t": 0.8, "type": "wheel-end"}]},
        {"id": "gone", "kind": "hover", "status": "missing", "detail": "no visible target", "errors": []},
    ],
}
(OUT / "sweep.json").write_text(json.dumps(sweep), encoding="utf-8")
