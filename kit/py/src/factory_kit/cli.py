import argparse
import json
import re
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, NamedTuple

from . import runs


class AtomError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class Verb(NamedTuple):
    run: Callable[..., dict]
    text: Callable[[dict], str]


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise AtomError("invalid_args", message)


def _flag(name: str) -> str:
    return "--" + re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()


def _parser(manifest: dict) -> _Parser:
    root = _Parser(prog=manifest["name"], description=manifest["description"])
    verbs = root.add_subparsers(dest="verb", required=True, parser_class=_Parser)
    for verb in manifest["verbs"]:
        p = verbs.add_parser(verb["name"], help=verb["description"], description=verb["description"])
        schema = verb["input"]
        required = schema.get("required", [])
        for name in required:
            p.add_argument(name, help=schema["properties"][name].get("description"))
        for name, prop in schema["properties"].items():
            if name in required:
                continue
            if prop.get("type") == "boolean":
                p.add_argument(_flag(name), dest=name, action="store_true", help=prop.get("description"))
            else:
                p.add_argument(
                    _flag(name), dest=name, default=prop.get("default"), choices=prop.get("enum"), help=prop.get("description")
                )
        p.add_argument("--json", action="store_true", help="Print the result as one JSON object.")
    return root


def main(atom_root: Path, verbs: dict[str, Verb]) -> None:
    """Run one verb. The manifest's verb input schemas define the arguments."""
    manifest = json.loads((Path(atom_root) / "manifest.json").read_text(encoding="utf-8"))
    as_json = "--json" in sys.argv[1:]
    started = datetime.now(timezone.utc)
    clock = time.monotonic()
    verb_name = None
    result = None
    try:
        args = vars(_parser(manifest).parse_args())
        verb_name = args.pop("verb")
        as_json = args.pop("json")
        result = verbs[verb_name].run(**args)
        error = None
    except AtomError as e:
        error = {"code": e.code, "message": e.message}
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        error = {"code": "internal", "message": f"{type(e).__name__}: {e}"}

    record = {
        "type": "atom",
        "name": manifest["name"],
        "verb": verb_name,
        "kind": manifest["kind"],
        "startedAt": started.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ms": round((time.monotonic() - clock) * 1000),
        "ok": error is None,
        "cacheHit": bool(result and result.get("cacheHit")),
    }
    if error:
        record["error"] = error["code"]
    runs.append(record)

    if error:
        if as_json:
            print(json.dumps({"error": error}, ensure_ascii=False))
        else:
            print(f"{manifest['name']}: {error['code']}: {error['message']}", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(result, ensure_ascii=False) if as_json else verbs[verb_name].text(result))
