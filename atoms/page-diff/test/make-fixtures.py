# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow>=11"]
# ///
"""Writes test/fixtures: recordings a and b of the same four-state script, with differences whose expected diff is known by construction."""
import json
from pathlib import Path

from PIL import Image, ImageDraw

FIXTURES = Path(__file__).resolve().parent / "fixtures"
W, H = 100, 60
BASE, CARD = (30, 30, 30, 255), (200, 200, 200, 255)


def card(width: int = W) -> Image.Image:
    im = Image.new("RGBA", (width, H), BASE)
    ImageDraw.Draw(im).rectangle([20, 20, 79, 39], fill=CARD)
    return im


def shifted(im: Image.Image, by: int) -> Image.Image:
    return im.point(lambda v: min(255, v + by))


def write_sweep(root: Path, slug: str, sweep: dict) -> str:
    (root / f"{slug}.sweep").mkdir(exist_ok=True)
    sweep["rest"].save(root / f"{slug}.sweep/rest.png")
    drift = []
    for i, image in enumerate(sweep.get("drift", []), 1):
        image.save(root / f"{slug}.sweep/rest-{i}.png")
        drift.append(f"{slug}.sweep/rest-{i}.png")
    points = []
    for col, (image, cursor) in enumerate(sweep["points"]):
        image.save(root / f"{slug}.sweep/00-{col:02d}.png")
        points.append({"col": col, "row": 0, "x": 12 + col * 24, "y": 12, "image": f"{slug}.sweep/00-{col:02d}.png", "cursor": cursor, "changed": {f":scope > :nth-child({col + 1})": {"scale": "1.5"}}})
    (root / f"{slug}.sweep.json").write_text(json.dumps({"cols": len(points), "rows": 1, "dwellMs": 800, "rest": f"{slug}.sweep/rest.png", **({"drift": drift} if drift else {}), "points": points}, indent=2) + "\n")
    return f"{slug}.sweep.json"


def write(side: str, states: list[dict]) -> None:
    root = FIXTURES / side
    root.mkdir(parents=True, exist_ok=True)
    out = []
    for i, st in enumerate(states):
        slug = f"{i:02d}-{st['name']}"
        st["screenshot"].save(root / f"{slug}.png")
        frames = []
        for k, frame in enumerate(st.get("frames", [])):
            frame.save(root / f"{slug}-f{k:03d}.png")
            frames.append(f"{slug}-f{k:03d}.png")
        (root / f"{slug}.styles.json").write_text(json.dumps(st.get("styles", PLAIN), indent=2) + "\n")
        (root / f"{slug}.dom.html").write_text("<div></div>\n")
        motion = {"everyMs": 100 if frames else None, "tracks": st.get("motion", {})}
        (root / f"{slug}.motion.json").write_text(json.dumps(motion, indent=2) + "\n")
        row = {
            "name": st["name"], "screenshot": f"{slug}.png", "frames": frames, "dom": f"{slug}.dom.html",
            "styles": f"{slug}.styles.json", "motion": f"{slug}.motion.json", "animations": st.get("animations", []), "overlays": [],
        }
        if "effects" in st:
            row["effects"] = st["effects"]
        if "sweep" in st:
            row["sweep"] = write_sweep(root, slug, st["sweep"])
        out.append(row)
    recording = {"source": f"file:///fixtures/{side}.html", "steps": "/fixtures/steps.json", "dir": f"/fixtures/{side}", "states": out, "cacheHit": False}
    (root / "recording.json").write_text(json.dumps(recording, indent=2) + "\n")


def animation(target: str, type_: str, name: str, duration: int, easing: str = "linear", keyframe_easing: str = "linear", prop: str = "opacity", start: str = "0", to: str = "1") -> dict:
    return {
        "target": target, "pseudoElement": None, "type": type_, "name": name,
        "keyframes": [{"offset": 0, "easing": keyframe_easing, "composite": "auto", prop: start}, {"offset": 1, "easing": "linear", "composite": "auto", prop: to}],
        "duration": duration, "delay": 0, "endDelay": 0, "easing": easing, "iterations": 1, "direction": "normal", "fill": "none",
    }


PLAIN = {":scope": {"width": "50px", "color": "rgb(237, 237, 237)"}}

HOVER_A = {
    ":scope": {"margin-top": "0px", "color": "rgb(1, 2, 3)", "background-color": "rgb(10, 20, 30)", "font-family": "Diatype"},
    ":scope > :nth-child(1)": {"width": "3px", "font-family": "Diatype"},
    ":scope > :nth-child(2)": {"width": "10px", "opacity": "1", "font-family": "Diatype"},
    ":scope > :nth-child(3)": {"width": "8px"},
    ":scope > :nth-child(10)": {"width": "4px"},
    ":scope > :nth-child(1) > :nth-child(1)": {"border-top-color": "rgb(0, 0, 0)"},
}
HOVER_B = {
    ":scope": {"margin-top": "0", "color": "rgba(1, 2, 3, 1)", "background-color": "rgb(10, 20, 31)", "font-family": "Inter"},
    ":scope > :nth-child(1)": {"width": "3px", "font-family": "Inter"},
    ":scope > :nth-child(2)": {"width": "12px", "opacity": "1", "font-family": "Inter"},
    ":scope > :nth-child(4)": {"width": "8px"},
    ":scope > :nth-child(10)": {"width": "5px"},
    ":scope > :nth-child(1) > :nth-child(1)": {"border-top-color": "rgb(255, 0, 0)"},
}

SLIDE = {"prop": "transform", "start": "translateX(0px)", "to": "translateX(10px)"}
MOTION_A = {
    ":scope": {"opacity": ["0", "0.5", "1", "1"]},
    ":scope > :nth-child(1)": {"transform": ["none", "matrix(1, 0, 0, 1, 5, 0)", "matrix(1, 0, 0, 1, 5, 0)", "matrix(1, 0, 0, 1, 5, 0)"]},
    ":scope > :nth-child(2)": {"transform": ["none", "matrix(1, 0, 0, 1, 10, 0)", "matrix(1, 0, 0, 1, 20, 0)", "matrix(1, 0, 0, 1, 20, 0)"]},
    ":scope > :nth-child(4)": {"opacity": ["1", "0.5", None, None]},
    ":scope > :nth-child(5)": {"opacity": ["1", None, None, None]},
}
MOTION_B = {
    ":scope": {"opacity": ["0", "0.505", "1"]},
    ":scope > :nth-child(1)": {"transform": ["matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)", "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5.2, 0, 0, 1)", "matrix(1, 0, 0, 1, 5, 0)"]},
    ":scope > :nth-child(2)": {"transform": ["none", "matrix(1, 0, 0, 1, 10.3, 0)", "matrix(1, 0, 0, 1, 14, 0)"]},
    ":scope > :nth-child(3)": {"transform": ["none", "matrix(1, 0, 0, 1, 0, 4)", "matrix(1, 0, 0, 1, 0, 8)"]},
    ":scope > :nth-child(4)": {"opacity": ["1", "0.5", None]},
    ":scope > :nth-child(5)": {"opacity": ["1", "0.5", "0"]},
}

block = card()
ImageDraw.Draw(block).rectangle([0, 0, 9, 9], fill=(255, 0, 0, 255))
inverted = Image.new("RGBA", (W, H), (230, 230, 230, 255))

write("a", [
    {"name": "idle", "screenshot": card()},
    {
        "name": "hover", "screenshot": card(), "frames": [card(), card(), card(), card()], "styles": HOVER_A,
        "animations": [
            animation(":scope > :nth-child(2)", "CSSAnimation", "pulse", 300, keyframe_easing="ease-out"),
            animation(":scope > :nth-child(2)", "CSSAnimation", "pulse", 300, keyframe_easing="ease-out", to="0.5"),
            animation(":scope", "CSSTransition", "opacity", 150, easing="ease"),
            animation(":scope > :nth-child(3)", "CSSAnimation", "slide", 200, **SLIDE),
            animation(":scope > :nth-child(4)", "CSSAnimation", "fade", 200),
        ],
        "motion": MOTION_A,
    },
    {"name": "open", "screenshot": card()},
    {"name": "closed", "screenshot": card()},
])
write("b", [
    {"name": "idle", "screenshot": block},
    {
        "name": "hover", "screenshot": card(), "frames": [card(), inverted, shifted(card(), 20)], "styles": HOVER_B,
        "animations": [
            animation(":scope > :nth-child(2)", "CSSAnimation", "pulse", 300, keyframe_easing="ease-out"),
            animation(":scope > :nth-child(2)", "CSSAnimation", "pulse", 450, keyframe_easing="ease-out", to="0.5"),
            animation(":scope", "CSSTransition", "transform", 150, easing="ease", **SLIDE),
            animation(":scope > :nth-child(3)", "CSSAnimation", "otpr-slide", 200, **SLIDE),
            animation(":scope > :nth-child(4)", "CSSAnimation", "fade-in", 200, start="0.2"),
        ],
        "motion": MOTION_B,
    },
    {"name": "open", "screenshot": card(W + 20)},
])


def lit(*columns: int, base: int = 30) -> Image.Image:
    """Six 12 px cells by two. A column is 24 px, two cells wide, and an answer lifts it 100 levels over the page's own background."""
    im = Image.new("RGBA", (72, 24), (base, base, base, 255))
    for c in columns:
        ImageDraw.Draw(im).rectangle([c * 24, 0, c * 24 + 23, 23], fill=(base + 100, base + 100, base + 100, 255))
    return im


def sweep_state(rest: Image.Image, *points: tuple) -> dict:
    return {"name": "idle", "screenshot": rest, "sweep": {"rest": rest, "points": points}}


write("sweep-a", [sweep_state(lit(), (lit(0), "pointer"), (lit(1), "pointer"), (lit(), "auto"))])
write("sweep-alike", [sweep_state(lit(base=70), (lit(0, base=70), "pointer"), (lit(1, base=70), "pointer"), (lit(base=70), "auto"))])
write("sweep-wrong", [sweep_state(lit(), (lit(0), "auto"), (lit(1, 2), "pointer"), (lit(), "auto"))])
write("sweep-dead", [sweep_state(lit(), (lit(), "auto"), (lit(), "auto"), (lit(), "auto"))])

moving = lambda *points: [{"name": "idle", "screenshot": lit(), "sweep": {"rest": lit(), "drift": [lit(2)], "points": points}}]
write("sweep-moving-a", moving((lit(0), "pointer"), (lit(1), "pointer"), (lit(2), "auto")))
write("sweep-moving-b", moving((lit(0, 2), "pointer"), (lit(1, 2), "pointer"), (lit(), "auto")))
write("sweep-flowing-a", moving((lit(0, 1), "pointer"), (lit(1), "pointer"), (lit(2), "auto")))
write("sweep-flowing-b", moving((lit(0), "pointer"), (lit(), "pointer"), (lit(), "auto")))
write("effects-a", [{"name": "idle", "screenshot": lit(), "effects": {"playback": 1, "clipboard": 2}}])
write("effects-half", [{"name": "idle", "screenshot": lit(), "effects": {"clipboard": 1}}])
write("effects-none", [{"name": "idle", "screenshot": lit()}])

LOOP = {"target": ":scope", "pseudoElement": None, "type": "CSSAnimation", "name": "fall", "keyframes": [], "duration": 1000, "delay": 0, "endDelay": 0, "easing": "linear", "iterations": "infinite", "direction": "normal", "fill": "none"}
FADE = {**LOOP, "type": "CSSTransition", "name": "opacity", "iterations": 1}
write("motion-frames", [{"name": "idle", "screenshot": lit(), "frames": [lit(), lit(1)]}])
write("motion-loop", [{"name": "idle", "screenshot": lit(), "animations": [LOOP]}])
write("motion-fade", [{"name": "idle", "screenshot": lit(), "animations": [FADE], "frames": [lit(), lit(1)]}])
write("motion-none", [{"name": "idle", "screenshot": lit(), "frames": [lit(), lit()]}])
