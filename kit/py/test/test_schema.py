import pytest

from factory_kit import schema
from factory_kit.cli import AtomError

SCHEMA = {"type": "object", "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}}}


def test_passes_a_valid_instance():
    assert schema.check({"a": 1}, SCHEMA, "invalid_args", "bad") is None


def test_reports_every_error_with_the_code_and_label():
    with pytest.raises(AtomError) as e:
        schema.check({"a": "x", "b": "y"}, SCHEMA, "invalid_args", "f.json is not a plan")
    assert e.value.code == "invalid_args"
    assert str(e.value) == "f.json is not a plan: $.a: 'x' is not of type 'integer'; $.b: 'y' is not of type 'integer'"


def test_limit_caps_the_errors_reported():
    with pytest.raises(AtomError) as e:
        schema.check({"a": "x", "b": "y"}, SCHEMA, "invalid_args", "bad", limit=1)
    assert str(e.value) == "bad: $.a: 'x' is not of type 'integer'"
