# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "jsonschema>=4.18"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import hashlib
import json
from pathlib import Path

from factory_kit import cli, model
from factory_kit.cache import Cache
from factory_kit.hash import file_sha256
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent.parent
SPEC = model.load(ROOT)
STEPS_SCHEMA = json.loads((ROOT.parents[1] / "contracts" / "page-steps.schema.json").read_text(encoding="utf-8"))
DEFAULTS = {"target": "body", "viewport": {"width": 1280, "height": 800}, "colorScheme": "dark"}
LIMITS = {"dom": 16_000, "styles": 10_000, "animations": 4_000, "problem": 4_000}
IDLE = {"name": "idle", "actions": []}


def _action(verbs: list[str], required: str | None, optional: str | None = None) -> dict:
    fields = {"do": {"enum": verbs}}
    fields |= {name: {"type": "string", "minLength": 1} for name in (required, optional) if name in ("selector", "text", "key")}
    if required == "ms":
        fields["ms"] = {"type": "integer", "minimum": 0}
    return {"type": "object", "properties": fields, "required": ["do", required], "additionalProperties": False}


SCHEMA = {
    "type": "object",
    "properties": {
        "states": {
            "type": "array",
            "minItems": 2,
            "maxItems": 4,
            "description": "The states after idle, in the order a user reaches them. Each state's actions run after the previous state's.",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "minLength": 1},
                    "actions": {
                        "type": "array",
                        "minItems": 1,
                        "items": {"anyOf": [
                            _action(["hover", "click", "focus", "scroll"], "selector"),
                            _action(["type", "paste"], "text", "selector"),
                            _action(["press"], "key", "selector"),
                            _action(["wait"], "ms"),
                        ]},
                    },
                    "frames": {
                        "type": "object",
                        "properties": {"everyMs": {"type": "integer", "minimum": 1}, "forMs": {"type": "integer", "minimum": 1}},
                        "required": ["everyMs", "forMs"],
                        "additionalProperties": False,
                    },
                },
                "required": ["name", "actions"],
                "additionalProperties": False,
            },
        },
        "notes": {"type": "string", "description": "What each state shows and why its timing is what it is."},
    },
    "required": ["states", "notes"],
    "additionalProperties": False,
}


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else f"{text[:limit]}\n[cut: {len(text) - limit} more characters]"


def _json(path: str | Path, what: str) -> dict:
    try:
        return json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except OSError:
        raise cli.AtomError("invalid_source", f"{what} is not a file: {path}") from None
    except ValueError as e:
        raise cli.AtomError("invalid_source", f"{what} is not JSON: {path} ({e})") from None


def _text(path: str, what: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError:
        raise cli.AtomError("invalid_source", f"{what} is not a file: {path}") from None


def _survey(path: str) -> tuple[dict, list[str | Path]]:
    recording = _json(path, "recording")
    if not isinstance(recording.get("states"), list) or not recording["states"] or "steps" not in recording:
        raise cli.AtomError("invalid_source", f"Not a page-record recording.json: {path}")
    plan = {**DEFAULTS, **_json(recording["steps"], "the recording's steps file")}
    fixed = {"url": plan["url"], "target": plan["target"], "viewport": plan["viewport"], "colorScheme": plan["colorScheme"]}
    idle = recording["states"][0]
    parts: list[str | Path] = [
        f"# The page\n\nURL {fixed['url']}. Target selector {fixed['target']}. Viewport {fixed['viewport']['width']}x{fixed['viewport']['height']}, {fixed['colorScheme']} color scheme.",
        "## Idle\n\nScreenshot of the target, settled:",
        Path(idle["screenshot"]),
        "Rendered DOM of the target, scripts removed:\n" + _clip(_text(idle["dom"], "dom"), LIMITS["dom"]),
        "Computed styles by element path:\n" + _clip(_text(idle["styles"], "styles"), LIMITS["styles"]),
        "Animations running while idle:\n" + _clip(json.dumps(idle["animations"]), LIMITS["animations"]),
    ]
    return fixed, parts


def _key(parts: list[str | Path]) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update((file_sha256(part) if isinstance(part, Path) else hashlib.sha256(part.encode()).hexdigest()).encode())
    return f"{digest.hexdigest()}-{model.fingerprint(SPEC, SCHEMA)}"


def write(recording: str, problem: str | None = None) -> dict:
    fixed, parts = _survey(recording)
    if problem:
        parts.append(f"# The problem the last steps hit\n\n{_clip(problem, LIMITS['problem'])}")
    key = _key(parts)
    cache = Cache("ui-steps")
    output = cache.get(key)
    hit = output is not None
    cost = 0.0
    if not hit:
        output, cost = model.ask(SPEC, SCHEMA, parts)
    steps = {**fixed, "states": [IDLE, *output["states"]]}
    errors = sorted(Draft202012Validator(STEPS_SCHEMA).iter_errors(steps), key=str)
    if errors:
        raise cli.AtomError("model_error", "The model's states do not make a page-steps file: " + "; ".join(f"{e.json_path}: {e.message}" for e in errors), cost)
    if not hit:
        cache.put(key, output)
    return {"model": SPEC.model, "steps": steps, "notes": output["notes"], "costUsd": cost, "cacheHit": hit}


def _summary(result: dict) -> str:
    lines = []
    for state in result["steps"]["states"]:
        actions = ", ".join(" ".join(str(v) for v in action.values()) for action in state["actions"]) or "no actions"
        frames = f"  frames every {state['frames']['everyMs']} ms for {state['frames']['forMs']} ms" if "frames" in state else ""
        lines.append(f"{state['name']}: {actions}{frames}")
    return "\n".join([*lines, result["notes"]])


if __name__ == "__main__":
    cli.main(ROOT, {"write": cli.Verb(write, _summary)})
