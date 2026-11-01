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
        out.append({
            "name": st["name"], "screenshot": f"{slug}.png", "frames": frames,
            "dom": f"{slug}.dom.html", "styles": f"{slug}.styles.json", "animations": st.get("animations", []),
        })
    recording = {"source": f"file:///fixtures/{side}.html", "steps": "/fixtures/steps.json", "dir": f"/fixtures/{side}", "states": out, "cacheHit": False}
    (root / "recording.json").write_text(json.dumps(recording, indent=2) + "\n")


def animation(target: str, type_: str, name: str, duration: int, easing: str = "linear", keyframe_easing: str = "linear", to: str = "1") -> dict:
    return {
        "target": target, "pseudoElement": None, "type": type_, "name": name,
        "keyframes": [{"offset": 0, "easing": keyframe_easing, "opacity": "0"}, {"offset": 1, "easing": "linear", "opacity": to}],
        "duration": duration, "delay": 0, "endDelay": 0, "easing": easing, "iterations": 1, "direction": "normal", "fill": "none",
    }


PLAIN = {":scope": {"width": "50px", "color": "rgb(237, 237, 237)"}}

HOVER_A = {
    ":scope": {"margin-top": "0px", "color": "rgb(1, 2, 3)", "background-color": "rgb(10, 20, 30)"},
    ":scope > :nth-child(1)": {"width": "3px"},
    ":scope > :nth-child(2)": {"width": "10px", "opacity": "1"},
    ":scope > :nth-child(3)": {"width": "8px"},
    ":scope > :nth-child(10)": {"width": "4px"},
    ":scope > :nth-child(1) > :nth-child(1)": {"border-top-color": "rgb(0, 0, 0)"},
}
HOVER_B = {
    ":scope": {"margin-top": "0", "color": "rgba(1, 2, 3, 1)", "background-color": "rgb(10, 20, 31)"},
    ":scope > :nth-child(1)": {"width": "3px"},
    ":scope > :nth-child(2)": {"width": "12px", "opacity": "1"},
    ":scope > :nth-child(4)": {"width": "8px"},
    ":scope > :nth-child(10)": {"width": "5px"},
    ":scope > :nth-child(1) > :nth-child(1)": {"border-top-color": "rgb(255, 0, 0)"},
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
        ],
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
            animation(":scope", "CSSTransition", "transform", 150, easing="ease"),
        ],
    },
    {"name": "open", "screenshot": card(W + 20)},
])
