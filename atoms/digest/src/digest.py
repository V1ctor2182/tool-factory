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

ROOT = Path(__file__).resolve().parent.parent
SPEC = model.load(ROOT)
CONTRACT = json.loads((ROOT.parent.parent / "contracts" / "digest.schema.json").read_text(encoding="utf-8"))


def _output_schema(fields: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {name: CONTRACT["properties"][name] for name in fields},
        "required": fields,
        "additionalProperties": False,
    }


def _timestamp(seconds: float) -> str:
    minutes, secs = divmod(int(seconds), 60)
    return f"{minutes}:{secs:02d}"


def _read_transcript(path: str) -> tuple[Path, dict, str]:
    file = Path(path).expanduser().resolve()
    try:
        transcript = json.loads(file.read_text(encoding="utf-8"))
        lines = [f"[{int(s['start'])}] {s['text']}" for s in transcript["segments"]]
    except (OSError, ValueError, TypeError, KeyError) as e:
        raise cli.AtomError("invalid_source", f"Not a readable transcript file: {path}: {e}")
    if not lines:
        raise cli.AtomError("invalid_source", f"The transcript has no segments: {path}")
    return file, transcript, "\n".join(lines)


def _read_image_notes(path: str) -> str:
    try:
        images = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))["images"]
        lines = [
            f"[{int(image['time'])}] {image['description']} Text on screen: {image['text'] or 'none'}"
            for image in images
            if "time" in image
        ]
    except (OSError, ValueError, TypeError, KeyError) as e:
        raise cli.AtomError("invalid_source", f"Not a readable image notes file with times: {path}: {e}")
    if not lines:
        raise cli.AtomError("invalid_source", f"The image notes hold no image with a time: {path}")
    return "\n".join(lines)


def make(transcript: str, imageNotes: str | None) -> dict:
    file, parsed, text = _read_transcript(transcript)
    fields = ["summary", "chapters", "keyPoints"]
    if imageNotes:
        text = f"Transcript\n{text}\n\nVisual notes\n{_read_image_notes(imageNotes)}"
        fields.append("visual")
    schema = _output_schema(fields)
    key = f"{hashlib.sha256(text.encode()).hexdigest()}-{model.fingerprint(SPEC, schema)}"
    here = {"source": parsed.get("source") or str(file), "transcriptPath": str(file)}
    cache = Cache("digest")
    if cached := cache.get(key):
        return {**cached, **here, "costUsd": 0.0}
    output, cost = model.ask(SPEC, schema, [text])
    digest = {**here, "model": SPEC.model, **output, "costUsd": cost}
    cache.put(key, digest)
    return digest


def _text(digest: dict) -> str:
    chapters = [f"  {_timestamp(c['start'])}  {c['title']}" for c in digest["chapters"]]
    points = [f"  - {p}" for p in digest["keyPoints"]]
    visual = [f"  {_timestamp(v['start'])}  {v['note']}" for v in digest.get("visual", [])]
    return "\n".join(
        [
            digest["summary"],
            "",
            "Chapters",
            *chapters,
            "",
            "Key points",
            *points,
            *(["", "On screen", *visual] if visual else []),
            "",
            f"Transcript: {digest['transcriptPath']}",
        ]
    )


if __name__ == "__main__":
    cli.main(ROOT, {"make": cli.Verb(make, _text)})
