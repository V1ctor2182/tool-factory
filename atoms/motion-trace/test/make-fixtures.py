# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=11"]
# ///
"""Writes a small synthetic sweep with known motion, so the expected trace can be checked by hand."""
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

W, H = 200, 120
OUT = Path(__file__).parent / "fixtures" / "sweep"
INK, PAPER = (250, 240, 200), (15, 15, 15)
FPS = 30


def bezier(x1, y1, x2, y2, x):
    lo, hi = 0.0, 1.0
    for _ in range(40):
        s = (lo + hi) / 2
        if 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s**2 * x2 + s**3 < x:
            lo = s
        else:
            hi = s
    return 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s**2 * y2 + s**3


def out_ease(u):
    return bezier(0.23, 1, 0.32, 1, min(u, 1.0))


def save(run, i, im):
    (OUT / run).mkdir(parents=True, exist_ok=True)
    im.save(OUT / run / f"{i:03d}.png")
    return {"file": f"{run}/{i:03d}.png", "t": round(i / FPS, 4), "y": 0}


def turning(angle):
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    for k in range(3):
        a = math.radians(angle + k * 137)
        d.line([(100, 60), (100 + (28 + k * 12) * math.cos(a), 60 + (28 + k * 12) * math.sin(a))], fill=INK, width=8 - k * 2)
    return im


def sliding(x):
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    for left, width in ((10, 14), (46, 6), (70, 22)):
        d.rectangle((round(x) + left, 20, round(x) + left + width, 100), fill=INK)
    return im


def fading(level):
    return Image.new("RGB", (W, H), tuple(round(a + (b - a) * level) for a, b in zip(PAPER, INK)))


# Turns 90 degrees every second, each over 0.5 s on the out curve.
turn = [save("turn", i, turning(90 * (i // FPS) + 90 * out_ease((i % FPS) / FPS / 0.5))) for i in range(3 * FPS + 10)]
# Driven at 200 px/s until the wheel stops at 0.5 s, then settles over a 150 ms time constant.
scroll = [save("scroll", i, sliding(10 + (100 * min(i / FPS / 0.5, 1) + (30 * (1 - math.exp(-(i / FPS - 0.5) / 0.15)) if i / FPS > 0.5 else 0)))) for i in range(int(1.5 * FPS))]
# Changes in place and never shifts, so only activity should read.
fade = [save("fade", i, fading(0.5 + 0.4 * math.sin(i / FPS * 2))) for i in range(FPS)]
sweep = {
    "url": "file:///fixture.html", "sweep": "sweep.json", "viewport": [W, H], "loadErrors": [],
    "runs": [
        {"id": "turn", "kind": "idle", "status": "ok", "errors": [], "at": 0, "scrollY": 0, "frames": turn, "events": []},
        {"id": "scroll", "kind": "pass", "status": "ok", "errors": [], "at": 0, "scrollY": 0, "frames": scroll, "events": [{"t": 0.0, "type": "wheel-start"}, {"t": 0.5, "type": "wheel-end"}]},
        {"id": "fade", "kind": "idle", "status": "ok", "errors": [], "at": 0, "scrollY": 0, "frames": fade, "events": []},
        {"id": "pruned", "kind": "idle", "status": "ok", "errors": [], "at": 0, "scrollY": 0, "frames": turn[:1] + [{"file": f"gone/{i}.png", "t": i / FPS, "y": 0} for i in range(1, 5)], "events": []},
    ],
}
(OUT / "sweep.json").write_text(json.dumps(sweep), encoding="utf-8")
(OUT.parent / "bundle.json").write_text(json.dumps({"easings": [{"value": "cubic-bezier(.23,1,.32,1)", "count": 1}, {"value": "cubic-bezier(.645,.045,.355,1)", "count": 1}, {"value": "var(--not-a-curve)", "count": 1}]}), encoding="utf-8")
