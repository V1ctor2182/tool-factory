import json


def load(path):
    try:
        with open(path) as handle:
            return json.load(handle)
    except OSError as e:
        raise ValueError(f"bad {path}: {e}") from None
