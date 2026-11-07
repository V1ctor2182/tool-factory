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
CONTRACT = json.loads((ROOT.parent.parent / "contracts" / "job-candidates.schema.json").read_text(encoding="utf-8"))
SCHEMA = {
    "type": "object",
    "properties": {"candidates": CONTRACT["properties"]["candidates"]},
    "required": ["candidates"],
    "additionalProperties": False,
}


def _rows(path: str, field: str, keys: tuple[str, ...]) -> list[dict]:
    try:
        rows = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))[field]
        return [{key: row[key] for key in keys} for row in rows]
    except (OSError, ValueError, TypeError, KeyError) as e:
        raise cli.AtomError("invalid_source", f"No readable {field} with {', '.join(keys)} in {path}: {e}")


def _grounded(citation: dict, sessions: dict[str, dict]) -> bool:
    session = sessions.get(citation["sessionId"])
    return bool(session) and citation["object"].casefold() in " ".join([session["project"], *session["prompts"]]).casefold()


def _objects(citations: list[dict]) -> set[str]:
    return {c["object"].casefold() for c in citations}


def _checked(raw: list[dict], sessions: dict[str, dict], types: dict[str, str], min_sessions: int, min_objects: int) -> tuple[list[dict], list[dict]]:
    atoms = {name for name, kind in types.items() if kind == "atom"}
    candidates, dropped = [], []
    for candidate in raw:
        cited: dict[str, dict] = {}
        for citation in candidate["citations"]:
            if _grounded(citation, sessions):
                cited.setdefault(citation["sessionId"], citation)
        citations = list(cited.values())
        reason = "too_few_sessions" if len(citations) < min_sessions else "too_few_objects" if len(_objects(citations)) < min_objects else None
        if reason:
            dropped.append({"slug": candidate["slug"], "reason": reason})
            continue
        named = [*candidate["reuses"], *(m["name"] for m in candidate["missing"])]
        covered = candidate["coveredBy"]
        candidates.append(
            {
                **candidate,
                "citations": citations,
                "coveredBy": covered if covered in types and covered not in atoms else None,
                "reuses": [name for name in dict.fromkeys(named) if name in atoms],
                "missing": [m for m in candidate["missing"] if m["name"] not in atoms],
            }
        )
    candidates.sort(key=lambda c: (-len(c["citations"]), c["slug"]))
    return candidates, dropped


def find(sessions: str, catalog: str, minSessions: int, minObjects: int) -> dict:
    for flag, value in (("--min-sessions", minSessions), ("--min-objects", minObjects)):
        if value < 1:
            raise cli.AtomError("invalid_args", f"{flag} must be 1 or more, not {value}.")
    read = _rows(sessions, "sessions", ("id", "project", "prompts"))
    parts = _rows(catalog, "parts", ("name", "type", "description"))
    summary = {"sessionCount": len(read), "minSessions": minSessions, "minObjects": minObjects, "model": SPEC.model}
    if not read:
        return {**summary, "candidates": [], "dropped": [], "costUsd": 0.0, "cacheHit": False}

    text = json.dumps({"sessions": read, "catalog": parts}, ensure_ascii=False, separators=(",", ":"))
    key = f"{hashlib.sha256(text.encode()).hexdigest()}-{model.fingerprint(SPEC, SCHEMA)}"
    cache = Cache("job-spot")
    cached = cache.get(key)
    if cached:
        reply, cost = cached, 0.0
    else:
        reply, cost = model.ask(SPEC, SCHEMA, [text])
        cache.put(key, reply)
    candidates, dropped = _checked(reply["candidates"], {s["id"]: s for s in read}, {p["name"]: p["type"] for p in parts}, minSessions, minObjects)
    return {**summary, "candidates": candidates, "dropped": dropped, "costUsd": cost, "cacheHit": bool(cached)}


def _text(result: dict) -> str:
    lines = [f"{len(c['citations'])}  {len(_objects(c['citations']))}  {c['slug']}  {c['job']}" for c in result["candidates"]]
    return "\n".join([*lines, f"{len(lines)} candidates, {len(result['dropped'])} dropped, from {result['sessionCount']} sessions."])


if __name__ == "__main__":
    cli.main(ROOT, {"find": cli.Verb(find, _text)})
