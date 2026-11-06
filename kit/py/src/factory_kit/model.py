import base64
import hashlib
import json
import math
import mimetypes
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import NamedTuple

from . import paths
from .cli import AtomError

TIMEOUT_SEC = 600


class Spec(NamedTuple):
    atom: str
    model: str
    prompt: str


def load(atom_root: Path) -> Spec:
    manifest = json.loads((atom_root / "manifest.json").read_text(encoding="utf-8"))
    model = manifest["model"]
    return Spec(manifest["name"], model["default"], (atom_root / model["prompt"]).read_text(encoding="utf-8"))


def fingerprint(spec: Spec, schema: dict) -> str:
    prompt_hash = hashlib.sha256((spec.prompt + json.dumps(schema, sort_keys=True)).encode()).hexdigest()[:16]
    return f"{spec.model}-{prompt_hash}"


def spent_today() -> float:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        lines = (paths.home() / "runs.jsonl").read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return 0.0
    records = (json.loads(line) for line in lines if line.strip())
    return sum(r.get("costUsd") or 0.0 for r in records if r.get("startedAt", "").startswith(today))


def _dollars(name: str, default: str) -> float:
    raw = os.environ.get(name, default)
    try:
        dollars = float(raw)
    except ValueError:
        dollars = math.nan
    if not 0 <= dollars < math.inf:
        raise AtomError("invalid_args", f"{name} is not a finite number of dollars, 0 or more: {raw}")
    return dollars


def _call_cap() -> float | None:
    caps = []
    if "TOOL_FACTORY_CALL_BUDGET_USD" in os.environ:
        caps.append(_dollars("TOOL_FACTORY_CALL_BUDGET_USD", ""))
    if "TOOL_FACTORY_BUDGET_USD" in os.environ:
        budget = _dollars("TOOL_FACTORY_BUDGET_USD", "")
        spent = spent_today()
        if spent >= budget:
            raise AtomError(
                "budget_exceeded",
                f"Model spend today is ${spent:.4f} of the ${budget:.4f} budget. Set TOOL_FACTORY_BUDGET_USD to raise it.",
            )
        caps.append(budget - spent)
    if not caps:
        return None
    cap = round(min(caps), 6)
    if cap <= 0:
        raise AtomError(
            "budget_exceeded",
            f"The call cap rounds to ${cap:.6f}, and claude needs more than $0. Raise TOOL_FACTORY_CALL_BUDGET_USD or TOOL_FACTORY_BUDGET_USD.",
        )
    return cap


def _block(part: str | Path) -> dict:
    if isinstance(part, str):
        return {"type": "text", "text": part}
    media_type = mimetypes.guess_type(part.name)[0] or "image/jpeg"
    data = base64.b64encode(part.read_bytes()).decode()
    return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}}


def ask(spec: Spec, schema: dict, content: list[str | Path]) -> tuple[dict, float]:
    cap = _call_cap()
    message = {"type": "user", "message": {"role": "user", "content": [_block(part) for part in content]}}
    command = [
        "claude", "-p", "--safe-mode", "--model", spec.model,
        "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        "--json-schema", json.dumps(schema),
        "--system-prompt", spec.prompt, "--tools", "", "--no-session-persistence",
    ]
    if cap is not None:
        command += ["--max-budget-usd", f"{cap:.6f}"]
    unknown_cost = cap or 0.0
    try:
        done = subprocess.run(
            command,
            input=json.dumps(message) + "\n",
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SEC,
            cwd=paths.atom_dir(spec.atom, "tmp"),
        )
    except FileNotFoundError:
        raise AtomError("model_error", "The claude CLI is not on PATH.")
    except subprocess.TimeoutExpired:
        raise AtomError("model_error", f"claude did not answer within {TIMEOUT_SEC} seconds.", unknown_cost)
    reply = None
    for line in done.stdout.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict) and event.get("type") == "result":
            reply = event
    if reply is None:
        detail = done.stderr.strip() or done.stdout.strip()
        raise AtomError("model_error", f"claude exited {done.returncode} with no result: {detail}", unknown_cost)
    cost = reply.get("total_cost_usd")
    if type(cost) not in (int, float) or not 0 <= cost < math.inf:
        cost = unknown_cost
    if reply.get("subtype") == "error_max_budget_usd":
        raise AtomError("budget_exceeded", "The call reached its --max-budget-usd cap.", cost)
    if reply.get("is_error") or not isinstance(reply.get("structured_output"), dict):
        raise AtomError("model_error", f"claude returned no structured output: {reply.get('errors') or reply.get('result')}", cost)
    return reply["structured_output"], cost
