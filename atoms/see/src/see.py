# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import json
from pathlib import Path

from factory_kit import cli, model
from factory_kit.cache import Cache
from factory_kit.hash import file_sha256

ROOT = Path(__file__).resolve().parent.parent
SPEC = model.load(ROOT)
CONTRACT = json.loads((ROOT.parent.parent / "contracts" / "image-notes.schema.json").read_text(encoding="utf-8"))
FIELDS = ["description", "text"]
NOTE = {
    "type": "object",
    "properties": {name: CONTRACT["properties"]["images"]["items"]["properties"][name] for name in FIELDS},
    "required": FIELDS,
    "additionalProperties": False,
}
FINGERPRINT = model.fingerprint(SPEC, NOTE)
SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def _schema(count: int) -> dict:
    notes = {"type": "array", "items": NOTE, "minItems": count, "maxItems": count}
    return {"type": "object", "properties": {"images": notes}, "required": ["images"], "additionalProperties": False}


def _files(images: list[str]) -> list[Path]:
    files = [Path(image).expanduser().resolve() for image in images]
    for image, file in zip(images, files):
        if not file.is_file():
            raise cli.AtomError("invalid_source", f"Not a file: {image}")
        if file.suffix.lower() not in SUFFIXES:
            raise cli.AtomError("invalid_source", f"Not a PNG, JPEG, GIF, or WebP file: {image}")
    return files


def describe(images: list[str]) -> dict:
    files = _files(images)
    keys = [f"{file_sha256(file)}-{FINGERPRINT}" for file in files]
    cache = Cache("see")
    notes = {key: cached for key in set(keys) if (cached := cache.get(key))}
    misses = {key: file for key, file in zip(keys, files) if key not in notes}
    cost = 0.0
    if misses:
        content = [part for n, file in enumerate(misses.values(), 1) for part in (f"Image {n}:", file)]
        output, cost = model.ask(SPEC, _schema(len(misses)), content)
        if len(output["images"]) != len(misses):
            raise cli.AtomError("model_error", f"Asked about {len(misses)} images and got {len(output['images'])} notes.", cost)
        for key, note in zip(misses, output["images"]):
            cache.put(key, note)
            notes[key] = note
    return {
        "model": SPEC.model,
        "images": [{"path": str(file), **{f: notes[key][f] for f in FIELDS}} for key, file in zip(keys, files)],
        "costUsd": cost,
        "cacheHit": not misses,
    }


def _text(result: dict) -> str:
    lines = []
    for image in result["images"]:
        lines += [image["path"], f"  {image['description']}"]
        if image["text"]:
            lines.append(f"  Text: {image['text']}")
    return "\n".join(lines)


if __name__ == "__main__":
    cli.main(ROOT, {"describe": cli.Verb(describe, _text)})
