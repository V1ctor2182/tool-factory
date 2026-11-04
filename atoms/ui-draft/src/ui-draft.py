# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import hashlib
import json
from pathlib import Path

from factory_kit import cli, model
from factory_kit.cache import Cache
from factory_kit.hash import file_sha256

ROOT = Path(__file__).resolve().parent.parent
SPEC = model.load(ROOT)
FRAMES_PER_STATE = 3
LIMITS = {"dom": 12_000, "styles": 12_000, "motion": 6_000, "animations": 8_000, "steps": 6_000, "draft": 60_000, "diff": 4_000, "problem": 6_000}
DIFF_FIELDS = ["name", "score", "missing", "size", "pixels", "frames", "styles", "animations", "motion", "overlays"]


def _schema(packages: list[str] | None) -> dict:
    dependencies: dict = {"type": "array", "items": {"type": "string"}}
    if packages is not None:
        dependencies = {"type": "array", "items": {"enum": packages}} if packages else {"type": "array", "maxItems": 0}
    css_value = {"anyOf": [{"type": "string"}, {"type": "object"}]}
    fields = {
        "title": {"type": "string"},
        "description": {"type": "string", "description": "One sentence on what the component is and does."},
        "dependencies": {**dependencies, "description": "npm packages the component imports."},
        "css": {"type": "object", "additionalProperties": css_value, "description": "shadcn css: selectors and at-rules such as @keyframes, mapping to declarations or nested rules. {} when the component needs none."},
        "component": {"type": "string", "description": "TSX source of components/ui/<name>.tsx."},
        "demo": {"type": "string", "description": "TSX source of the demo page. Default export. Imports from @/components/ui/<name>."},
        "notes": {"type": "string", "description": "What this draft changed and why."},
    }
    return {"type": "object", "properties": fields, "required": list(fields), "additionalProperties": False}


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else f"{text[:limit]}\n[cut: {len(text) - limit} more characters]"


def _read(path: str | Path, what: str) -> str:
    file = Path(path).expanduser()
    if not file.is_file():
        raise cli.AtomError("invalid_source", f"{what} is not a file: {path}")
    return file.read_text(encoding="utf-8")


def _json(path: str, what: str) -> dict:
    try:
        return json.loads(_read(path, what))
    except ValueError as e:
        raise cli.AtomError("invalid_source", f"{what} is not JSON: {path} ({e})") from None


def _image(path: str | None) -> list[Path]:
    return [Path(path)] if path and Path(path).is_file() else []


def _spaced(frames: list[str]) -> list[str]:
    if len(frames) <= FRAMES_PER_STATE:
        return frames
    step = (len(frames) - 1) / (FRAMES_PER_STATE - 1)
    return [frames[round(i * step)] for i in range(FRAMES_PER_STATE)]


def _recording(path: str) -> list[str | Path]:
    recording = _json(path, "recording")
    if not isinstance(recording.get("states"), list) or "steps" not in recording:
        raise cli.AtomError("invalid_source", f"Not a page-record recording.json: {path}")
    parts: list[str | Path] = [
        "# The original\n\nThe steps file the judge drives both pages with. The demo must answer its target and every action's selector the way the original does:\n"
        + _clip(_read(recording["steps"], "the recording's steps file"), LIMITS["steps"])
    ]
    for state in recording["states"]:
        frames = _spaced(state["frames"])
        parts += [f"## State {state['name']}\n\nSettled screenshot:", Path(state["screenshot"])]
        if frames:
            every = json.loads(_read(state["motion"], "motion"))["everyMs"]
            for frame in frames:
                index = state["frames"].index(frame)
                parts += [f"Frame {index}, {index * every} ms after the actions:", Path(frame)]
        parts += [
            "Rendered DOM, settled, scripts removed:\n" + _clip(_read(state["dom"], "dom"), LIMITS["dom"]),
            "Computed styles by element path, settled:\n" + _clip(_read(state["styles"], "styles"), LIMITS["styles"]),
            "Transform and opacity tracks that moved across the frames:\n" + _clip(_read(state["motion"], "motion"), LIMITS["motion"]),
            "Animations seen while the state ran:\n" + _clip(json.dumps(state["animations"]), LIMITS["animations"]),
        ]
        for i, overlay in enumerate(state["overlays"]):
            parts += [
                f"Overlay {i}, outside the target, such as a popup in a portal. Its corner is at {overlay['offset']} from the target's corner and {overlay['at']} in the viewport:",
                Path(overlay["screenshot"]),
                "Its rendered DOM:\n" + _clip(_read(overlay["dom"], "overlay dom"), LIMITS["dom"]),
                "Its computed styles by element path:\n" + _clip(_read(overlay["styles"], "overlay styles"), LIMITS["styles"]),
            ]
    return parts


def _previous(path: str) -> list[str | Path]:
    draft = _json(path, "previous draft")
    shown = {"item": draft.get("item"), "demo": draft.get("demo"), "notes": draft.get("notes")}
    return ["# Your previous draft\n\n" + _clip(json.dumps(shown, indent=1), LIMITS["draft"])]


def _diff(path: str) -> list[str | Path]:
    diff = _json(path, "diff")
    parts: list[str | Path] = [f"# How the judge scored your previous draft\n\nOverall score {diff.get('score')}. 1 means identical to the original. a is the original, b is your draft."]
    for state in diff.get("states", []):
        shown = {field: state.get(field) for field in DIFF_FIELDS}
        parts.append(f"## State {state.get('name')}\n" + _clip(json.dumps(shown), LIMITS["diff"]))
        if image := _image(state.get("image")):
            parts += ["Settled screenshots, original then draft then heatmap:", *image]
        if sheet := _image(state.get("sheet")):
            parts += ["Contact sheet of shared frames, original, draft, and heatmap stacked:", *sheet]
        for overlay in state.get("overlays") or []:
            if image := _image(overlay.get("image")):
                parts += [f"Overlay {overlay['index']}, original then draft then heatmap:", *image]
    return parts


def _key(parts: list[str | Path], schema: dict) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update((file_sha256(part) if isinstance(part, Path) else hashlib.sha256(part.encode()).hexdigest()).encode())
    return f"{digest.hexdigest()}-{model.fingerprint(SPEC, schema)}"


def write(recording: str, name: str, previous: str | None = None, diff: str | None = None, problem: str | None = None, packages: str | None = None) -> dict:
    listed = None if packages is None else sorted({p.strip() for p in packages.split(",") if p.strip()})
    parts: list[str | Path] = [
        f"Item name: {name}. The component file installs at components/ui/{name}.tsx and the demo imports it from @/components/ui/{name}.",
        f"Packages the project has, the only ones you may import or list: {', '.join(listed) or 'none'}." if listed is not None else "Any npm package may be listed.",
        *_recording(recording),
        *(_previous(previous) if previous else []),
        *(_diff(diff) if diff else []),
        *([f"# The problem the previous draft hit\n\n{_clip(problem, LIMITS['problem'])}"] if problem else []),
    ]
    schema = _schema(listed)
    key = _key(parts, schema)
    cache = Cache("ui-draft")
    output = cache.get(key)
    hit = output is not None
    cost = 0.0
    if not hit:
        output, cost = model.ask(SPEC, schema, parts)
        cache.put(key, output)
    item = {
        "name": name,
        "type": "registry:ui",
        "title": output["title"],
        "description": output["description"],
        "dependencies": output["dependencies"],
        **({"css": output["css"]} if output["css"] else {}),
        "files": [{"path": f"registry/{name}/{name}.tsx", "type": "registry:ui", "target": f"components/ui/{name}.tsx", "content": output["component"]}],
    }
    return {"model": SPEC.model, "item": item, "demo": output["demo"], "notes": output["notes"], "costUsd": cost, "cacheHit": hit}


def _text(result: dict) -> str:
    files = [f"{file['target']}  {len(file['content'])} characters" for file in result["item"]["files"]]
    return "\n".join([*files, f"demo  {len(result['demo'])} characters", result["notes"]])


if __name__ == "__main__":
    cli.main(ROOT, {"write": cli.Verb(write, _text)})
