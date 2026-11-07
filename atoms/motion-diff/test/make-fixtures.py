# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=11"]
# ///
"""Writes three small motion-measures files with known differences, so the expected diff can be checked by hand."""
import copy
import json
from pathlib import Path

from PIL import Image

OUT = Path(__file__).parent / "fixtures"
for name, colour in (("a", (10, 36, 180)), ("b", (178, 0, 91))):
    Image.new("RGB", (32, 20), colour).save(OUT / f"{name}.png")


def idle(**over):
    return {"events": 20, "litPeak": 0.004, "everLit": 0.05, "ratePerS": 3.0, "gapCv": 0.6, "order": 0.3, "periodicity": 0.2, "hues": [0, 0, 0, 0, 0.05, 0, 0, 0, 0.4, 0, 0, 0], **over}


def walk(**over):
    return {"ys": [0, 100, 200, 300, 400], "activeRanges": [[0, 100]], "transitions": [], "overflow": {"scrollWidth": 1440, "viewport": 1440, "sidewaysPx": 0}, **over}


def run(id_, kind, values, frame):
    return {"id": id_, "kind": kind, "status": "ok", "detail": "", "errors": [], "values": values, "keyFrames": [frame]}


def fine(span, step):
    return {"inertiaMs": 400, "travelPx": 1000, "transitions": [{"fromY": 0, "toY": 1000, "from": "#0a24b4", "to": "#680cae", "spanPx": span, "largestStepPer40Px": step, "resolution": 40}]}


def click(**over):
    return {"responseMs": 10, "riseMs": 20, "peak": 0.5, "worstGapMs": 17, "state": {"scrollY": 0, "hash": "#two", "blocked": {"navigations": []}}, **over}


def hover(**over):
    return {"responseMs": 10, "riseMs": 100, "peak": 0.01, "colours": [{"hex": "#ffcc33", "share": 1.0}], "cursor": "pointer", "residualAfterExit": 0.0, **over}


def doc(runs, frame):
    return {"source": "x", "url": "file:///x", "runs": [run(i, k, v, frame) for i, k, v in runs]}


base = [
    ("walk", "walk", walk()),
    ("fine", "pass", fine(400, 0.1)),
    ("rest", "idle", idle()),
    ("random", "idle", idle(gapCv=0.3)),
    ("sparse", "idle", idle(events=8, gapCv=0.3)),
    ("press", "click", click()),
    ("card", "hover", hover()),
    ("drag", "path", {"reaction": 0.01, "reachPx": 200}),
    ("same", "load", {"settleMs": 2000}),
]
repeat = copy.deepcopy(base)
repeat[3] = ("random", "idle", idle(gapCv=1.0))
changed = [
    ("walk", "walk", walk(activeRanges=[[0, 400]], overflow={"scrollWidth": 1610, "viewport": 1440, "sidewaysPx": 170})),
    ("fine", "pass", fine(150, 0.4)),
    ("rest", "idle", idle(hues=[0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0, 0, 0], litPeak=0.02)),
    ("random", "idle", idle(gapCv=1.2)),
    ("sparse", "idle", idle(events=8, gapCv=1.4)),
    ("press", "click", click(worstGapMs=1567, responseMs=1500)),
    ("card", "hover", hover(responseMs=None, cursor="auto")),
    ("drag", "path", {"reaction": 0.05, "reachPx": 700}),
    ("same", "load", {"settleMs": 2100}),
]
frame_a, frame_b = str(OUT / "a.png"), str(OUT / "b.png")
for name, runs, frame in (("a", base, "A"), ("baseline", repeat, "A"), ("b", changed, "B")):
    (OUT / f"{name}.json").write_text(json.dumps(doc(runs, f"@FIXTURES@/{frame.lower()}.png"), indent=1), encoding="utf-8")
