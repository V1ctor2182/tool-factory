# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import json
import re
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from factory_kit import cli

TAG = re.compile(r"<([A-Za-z][\w:.-]*)(?:\s[^<>]*)?>.*?</\1\s*>", re.DOTALL)


def _instant(text: str) -> datetime:
    moment = datetime.fromisoformat(text)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _window_end(until: str) -> datetime:
    try:
        return datetime.combine(date.fromisoformat(until), time.max, timezone.utc)
    except ValueError:
        pass
    try:
        return _instant(until)
    except ValueError:
        raise cli.AtomError("invalid_args", f"--until is not an ISO date or datetime: {until}")


def _entry(line: str) -> dict | None:
    try:
        entry = json.loads(line)
    except ValueError:
        return None
    return entry if isinstance(entry, dict) else None


def _is_human(entry: dict) -> bool:
    if entry.get("type") != "user" or entry.get("isMeta") or entry.get("isSidechain") or entry.get("isCompactSummary"):
        return False
    origin = entry.get("origin")
    return entry.get("turnOrigin") == "human" or (isinstance(origin, dict) and origin.get("kind") == "human")


def _prompt(entry: dict) -> str:
    message = entry.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, list):
        blocks = [b.get("text") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        content = " ".join(text for text in blocks if isinstance(text, str))
    return " ".join(TAG.sub(" ", content).split()) if isinstance(content, str) else ""


def _started(entry: dict) -> datetime | None:
    try:
        return _instant(entry.get("timestamp"))
    except (TypeError, ValueError):
        return None


def _session(path: Path, max_prompts: int, max_chars: int) -> tuple[datetime, dict] | None:
    first, prompts = None, []
    with path.open(encoding="utf-8", errors="replace") as lines:
        for line in lines:
            # Machine transcripts are most of the bytes, so skip parsing lines that cannot be human.
            if '"human"' not in line:
                continue
            entry = _entry(line)
            if entry is None or not _is_human(entry):
                continue
            prompt = _prompt(entry)[:max_chars]
            if not prompt or _started(entry) is None:
                continue
            first = first or entry
            prompts.append(prompt)
            if len(prompts) == max_prompts:
                break
    if first is None:
        return None
    return _started(first), {
        "id": path.stem,
        "project": path.parent.name,
        "startedAt": first["timestamp"],
        "prompts": prompts,
    }


def list_(days: int, until: str | None, root: str, maxPrompts: int, maxChars: int) -> dict:
    for flag, value in (("--days", days), ("--max-prompts", maxPrompts), ("--max-chars", maxChars)):
        if value < 1:
            raise cli.AtomError("invalid_args", f"{flag} must be 1 or more, not {value}.")
    end = _window_end(until) if until else datetime.now(timezone.utc)
    since = end - timedelta(days=days)
    folder = Path(root).expanduser().absolute()
    if not folder.is_dir():
        raise cli.AtomError("invalid_source", f"Not a folder of transcripts: {folder}")

    machine = 0
    dated = []
    for path in folder.glob("*/*.jsonl"):
        if not path.is_file():
            continue
        found = _session(path, maxPrompts, maxChars)
        if found is None:
            machine += 1
        elif since <= found[0] <= end:
            dated.append(found)
    dated.sort(key=lambda found: (found[0], found[1]["id"]))

    seen = set()
    sessions = []
    for _, session in dated:
        opening = (session["project"], session["prompts"][0])
        if opening not in seen:
            sessions.append(session)
            seen.add(opening)
    return {
        "root": str(folder),
        "since": _iso(since),
        "until": _iso(end) if until else None,
        "sessions": sessions,
        "skipped": {"machine": machine, "duplicate": len(dated) - len(sessions)},
        "cacheHit": False,
    }


def _text(result: dict) -> str:
    lines = [f"{s['startedAt']}  {s['id']}  {s['project']}  {s['prompts'][0]}" for s in result["sessions"]]
    skipped = result["skipped"]
    return "\n".join([*lines, f"{len(lines)} sessions since {result['since']}. Skipped {skipped['machine']} machine, {skipped['duplicate']} duplicate."])


if __name__ == "__main__":
    cli.main(Path(__file__).resolve().parent.parent, {"list": cli.Verb(list_, _text)})
