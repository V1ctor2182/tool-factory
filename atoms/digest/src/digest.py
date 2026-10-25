# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from factory_kit import cli, paths
from factory_kit.cache import Cache

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
MODEL = MANIFEST["model"]["default"]
PROMPT = (ROOT / MANIFEST["model"]["prompt"]).read_text(encoding="utf-8")
CONTRACT = json.loads((ROOT.parent.parent / "contracts" / "digest.schema.json").read_text(encoding="utf-8"))
MODEL_FIELDS = ["summary", "chapters", "keyPoints"]
OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {name: CONTRACT["properties"][name] for name in MODEL_FIELDS},
    "required": MODEL_FIELDS,
    "additionalProperties": False,
}
PROMPT_HASH = hashlib.sha256((PROMPT + json.dumps(OUTPUT_SCHEMA, sort_keys=True)).encode()).hexdigest()[:16]


def _timestamp(seconds: float) -> str:
    minutes, secs = divmod(int(seconds), 60)
    return f"{minutes}:{secs:02d}"


def _read_transcript(path: str | None) -> tuple[Path, dict, str]:
    if not path:
        raise cli.AtomError("invalid_args", "Pass --transcript <path>.")
    file = Path(path).expanduser().resolve()
    try:
        transcript = json.loads(file.read_text(encoding="utf-8"))
        lines = [f"[{int(s['start'])}] {s['text']}" for s in transcript["segments"]]
    except (OSError, ValueError, TypeError, KeyError) as e:
        raise cli.AtomError("invalid_source", f"Not a readable transcript file: {path}: {e}")
    if not lines:
        raise cli.AtomError("invalid_source", f"The transcript has no segments: {path}")
    return file, transcript, "\n".join(lines)


def _spent_today() -> float:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        lines = (paths.home() / "runs.jsonl").read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return 0.0
    records = (json.loads(line) for line in lines if line.strip())
    return sum(r.get("costUsd") or 0.0 for r in records if r.get("startedAt", "").startswith(today))


def _budget() -> float:
    raw = os.environ.get("TOOL_FACTORY_BUDGET_USD", "3")
    try:
        return float(raw)
    except ValueError:
        raise cli.AtomError("invalid_args", f"TOOL_FACTORY_BUDGET_USD is not a number: {raw}")


def _claude(text: str, remaining: float) -> tuple[dict, float]:
    command = [
        "claude", "-p", "--safe-mode", "--model", MODEL,
        "--output-format", "json", "--json-schema", json.dumps(OUTPUT_SCHEMA),
        "--system-prompt", PROMPT, "--tools", "", "--no-session-persistence",
        "--max-budget-usd", f"{remaining:.6f}",
    ]
    try:
        done = subprocess.run(
            command, input=text, capture_output=True, text=True, timeout=600, cwd=paths.atom_dir("digest", "tmp")
        )
    except FileNotFoundError:
        raise cli.AtomError("model_error", "The claude CLI is not on PATH.")
    except subprocess.TimeoutExpired:
        raise cli.AtomError("model_error", "claude did not answer within 600 seconds.")
    try:
        reply = json.loads(done.stdout)
    except ValueError:
        raise cli.AtomError("model_error", f"claude exited {done.returncode}: {done.stderr.strip() or done.stdout.strip()}")
    cost = reply.get("total_cost_usd") or 0.0
    if reply.get("subtype") == "error_max_budget_usd":
        raise cli.AtomError("budget_exceeded", "The call reached the rest of today's model budget.", cost)
    if reply.get("is_error") or not isinstance(reply.get("structured_output"), dict):
        raise cli.AtomError("model_error", f"claude returned no digest: {reply.get('errors') or reply.get('result')}", cost)
    return reply["structured_output"], cost


def make(transcript: str | None) -> dict:
    file, parsed, text = _read_transcript(transcript)
    key = f"{hashlib.sha256(text.encode()).hexdigest()}-{MODEL}-{PROMPT_HASH}"
    here = {"source": parsed.get("source") or str(file), "transcriptPath": str(file)}
    cache = Cache("digest")
    if cached := cache.get(key):
        return {**cached, **here, "costUsd": 0.0}
    budget, spent = _budget(), _spent_today()
    if spent >= budget:
        raise cli.AtomError(
            "budget_exceeded", f"Model spend today is ${spent:.4f} of the ${budget:.4f} budget. Set TOOL_FACTORY_BUDGET_USD to raise it."
        )
    fields, cost = _claude(text, budget - spent)
    digest = {**here, "model": MODEL, **fields, "costUsd": cost}
    cache.put(key, digest)
    return digest


def _text(digest: dict) -> str:
    chapters = [f"  {_timestamp(c['start'])}  {c['title']}" for c in digest["chapters"]]
    points = [f"  - {p}" for p in digest["keyPoints"]]
    return "\n".join(
        [digest["summary"], "", "Chapters", *chapters, "", "Key points", *points, "", f"Transcript: {digest['transcriptPath']}"]
    )


if __name__ == "__main__":
    cli.main(ROOT, {"make": cli.Verb(make, _text)})
