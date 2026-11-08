import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from factory_kit import model
from factory_kit.cli import AtomError

SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]}

STUB = """#!/bin/sh
printf '%s\\n' "$@" > "{calls}/argv"
cat > "{calls}/stdin"
printf '%s\\n' '{{"type":"system"}}' '{reply}'
"""


@pytest.fixture
def atom(tmp_path, monkeypatch):
    home, calls, bin_dir, root = (tmp_path / name for name in ("home", "calls", "bin", "atom"))
    for folder in (home, calls, bin_dir, root):
        folder.mkdir()
    monkeypatch.setenv("TOOL_FACTORY_HOME", str(home))
    monkeypatch.setenv("PATH", f"{bin_dir}:/usr/bin:/bin")
    monkeypatch.delenv("TOOL_FACTORY_BUDGET_USD", raising=False)
    monkeypatch.delenv("TOOL_FACTORY_CALL_BUDGET_USD", raising=False)
    (root / "manifest.json").write_text(json.dumps({"name": "stub", "model": {"default": "haiku", "prompt": "p.md"}}))
    (root / "p.md").write_text("Answer.")

    def backend(reply: dict) -> None:
        claude = bin_dir / "claude"
        claude.write_text(STUB.format(calls=calls, reply=json.dumps(reply)))
        claude.chmod(0o755)

    backend({"type": "result", "subtype": "success", "total_cost_usd": 0.02, "structured_output": {"answer": "yes"}})
    return model.load(root), home, calls, backend


def spend(home: Path, usd: float) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(home / "runs.jsonl", "a") as f:
        f.write(json.dumps({"name": "other", "startedAt": now, "costUsd": usd}) + "\n")


def passed(calls: Path, flag: str) -> str:
    argv = (calls / "argv").read_text().splitlines()
    return argv[argv.index(flag) + 1]


def test_returns_structured_output_and_cost(atom):
    spec, home, calls, _ = atom
    spend(home, 1.0)
    assert model.ask(spec, SCHEMA, ["question"]) == ({"answer": "yes"}, 0.02)
    assert passed(calls, "--model") == "haiku"
    assert "--max-budget-usd" not in (calls / "argv").read_text().splitlines()


@pytest.mark.parametrize(
    ("budget", "ceiling", "cap"), [("3", None, "2.000000"), ("1.1", None, "0.100000"), ("3", "0.05", "0.050000")]
)
def test_caps_each_call_at_the_ceiling_or_the_rest_of_the_budget(atom, monkeypatch, budget, ceiling, cap):
    spec, home, calls, _ = atom
    spend(home, 1.0)
    monkeypatch.setenv("TOOL_FACTORY_BUDGET_USD", budget)
    if ceiling:
        monkeypatch.setenv("TOOL_FACTORY_CALL_BUDGET_USD", ceiling)
    model.ask(spec, SCHEMA, ["question"])
    assert passed(calls, "--max-budget-usd") == cap


def test_refuses_past_budget_without_calling_the_backend(atom, monkeypatch):
    spec, home, calls, _ = atom
    spend(home, 0.3)
    spend(home, 0.3)
    monkeypatch.setenv("TOOL_FACTORY_BUDGET_USD", "0.5")
    with pytest.raises(AtomError) as refused:
        model.ask(spec, SCHEMA, ["question"])
    assert refused.value.code == "budget_exceeded"
    assert refused.value.cost_usd == 0
    assert not (calls / "argv").exists()


def test_ignores_spend_from_earlier_days(atom, monkeypatch):
    spec, home, _, _ = atom
    with open(home / "runs.jsonl", "a") as f:
        f.write(json.dumps({"name": "other", "startedAt": "2000-01-01T00:00:00Z", "costUsd": 9.0}) + "\n")
    monkeypatch.setenv("TOOL_FACTORY_BUDGET_USD", "0.5")
    assert model.ask(spec, SCHEMA, ["question"])[0] == {"answer": "yes"}


def test_maps_the_backend_budget_stop_to_budget_exceeded_with_its_cost(atom):
    spec, _, _, backend = atom
    backend({"type": "result", "subtype": "error_max_budget_usd", "is_error": True, "total_cost_usd": 0.4})
    with pytest.raises(AtomError) as refused:
        model.ask(spec, SCHEMA, ["question"])
    assert (refused.value.code, refused.value.cost_usd) == ("budget_exceeded", 0.4)


@pytest.mark.parametrize("reply", [{"type": "assistant"}, {"type": "result", "is_error": True, "result": "boom"}])
def test_charges_the_call_cap_when_the_cost_is_unknown(atom, monkeypatch, reply):
    spec, _, _, backend = atom
    monkeypatch.setenv("TOOL_FACTORY_CALL_BUDGET_USD", "0.25")
    backend(reply)
    with pytest.raises(AtomError) as failed:
        model.ask(spec, SCHEMA, ["question"])
    assert (failed.value.code, failed.value.cost_usd) == ("model_error", 0.25)


def test_charges_nothing_for_an_unknown_cost_with_no_cap(atom):
    spec, _, _, backend = atom
    backend({"type": "result", "subtype": "success", "structured_output": {"answer": "yes"}})
    assert model.ask(spec, SCHEMA, ["question"]) == ({"answer": "yes"}, 0.0)


@pytest.mark.parametrize("cost", [-5, True])
def test_charges_the_call_cap_for_a_cost_that_is_not_dollars(atom, monkeypatch, cost):
    spec, _, _, backend = atom
    monkeypatch.setenv("TOOL_FACTORY_CALL_BUDGET_USD", "0.25")
    backend({"type": "result", "subtype": "success", "total_cost_usd": cost, "structured_output": {"answer": "yes"}})
    assert model.ask(spec, SCHEMA, ["question"]) == ({"answer": "yes"}, 0.25)


@pytest.mark.parametrize(("budget", "ceiling"), [("3", "0"), ("3", "0.0000004"), ("0.0000004", "0.25")])
def test_refuses_a_cap_that_rounds_to_zero_without_calling_the_backend(atom, monkeypatch, budget, ceiling):
    spec, _, calls, _ = atom
    monkeypatch.setenv("TOOL_FACTORY_BUDGET_USD", budget)
    monkeypatch.setenv("TOOL_FACTORY_CALL_BUDGET_USD", ceiling)
    with pytest.raises(AtomError) as refused:
        model.ask(spec, SCHEMA, ["question"])
    assert refused.value.code == "budget_exceeded"
    assert not (calls / "argv").exists()


@pytest.mark.parametrize("name", ["TOOL_FACTORY_BUDGET_USD", "TOOL_FACTORY_CALL_BUDGET_USD"])
@pytest.mark.parametrize("raw", ["nan", "inf", "-inf", "-1", "three"])
def test_rejects_an_amount_that_is_not_finite_and_at_least_zero(atom, monkeypatch, name, raw):
    spec, _, calls, _ = atom
    monkeypatch.setenv(name, raw)
    with pytest.raises(AtomError) as refused:
        model.ask(spec, SCHEMA, ["question"])
    assert refused.value.code == "invalid_args"
    assert not (calls / "argv").exists()


def test_sends_images_as_base64_blocks(atom, tmp_path):
    spec, _, calls, _ = atom
    image = tmp_path / "frame.png"
    image.write_bytes(b"\x89PNG fake")
    model.ask(spec, SCHEMA, ["Image 1:", image])
    content = json.loads((calls / "stdin").read_text())["message"]["content"]
    assert content[0] == {"type": "text", "text": "Image 1:"}
    assert content[1]["source"] == {"type": "base64", "media_type": "image/png", "data": "iVBORyBmYWtl"}


def test_fingerprint_changes_with_the_schema(atom):
    spec = atom[0]
    assert model.fingerprint(spec, SCHEMA) != model.fingerprint(spec, {**SCHEMA, "required": []})
    assert model.fingerprint(spec, SCHEMA).startswith("haiku-")


def test_cache_key_keeps_the_formula_model_atoms_cached_under(atom, tmp_path):
    spec = atom[0]
    shot = tmp_path / "shot.png"
    shot.write_bytes(b"png")
    key = model.cache_key(spec, SCHEMA, ["prompt text", shot])
    assert key == f"8c0ff337d51606c2409a0fb382e283d7ed4c03ea0325f957b2d9a161d76a6e01-{model.fingerprint(spec, SCHEMA)}"


def test_cache_key_changes_with_a_file_the_content_names(atom, tmp_path):
    spec = atom[0]
    shot = tmp_path / "shot.png"
    shot.write_bytes(b"a")
    before = model.cache_key(spec, SCHEMA, [shot])
    shot.write_bytes(b"b")
    assert model.cache_key(spec, SCHEMA, [shot]) != before


def test_clip_keeps_short_text_and_says_how_much_it_cut():
    assert model.clip("abc", 3) == "abc"
    assert model.clip("abcdef", 2) == "ab\n[cut: 4 more characters]"
