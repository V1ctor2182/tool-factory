import pytest

from factory_kit import schema
from factory_kit.cli import AtomError

SCHEMA = {"type": "object", "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}}}


def test_passes_a_valid_instance():
    schema.check({"a": 1}, SCHEMA, "invalid_args", "bad")


def test_reports_every_error_with_the_code_and_label():
    with pytest.raises(AtomError) as e:
        schema.check({"a": "x", "b": "y"}, SCHEMA, "invalid_args", "f.json is not a plan")
    assert e.value.code == "invalid_args"
    assert str(e.value).startswith("f.json is not a plan: ")
    assert "$.a: " in str(e.value) and "$.b: " in str(e.value)
