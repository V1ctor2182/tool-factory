from jsonschema import Draft202012Validator

from .cli import AtomError


def check(instance, schema: dict, code: str, label: str) -> None:
    errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=str)
    if errors:
        raise AtomError(code, f"{label}: " + "; ".join(f"{e.json_path}: {e.message}" for e in errors))
