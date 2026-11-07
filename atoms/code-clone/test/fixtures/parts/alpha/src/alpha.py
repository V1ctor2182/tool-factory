"""Alpha part."""
import json


def load(path):
    try:
        with open(path) as handle:
            return json.load(handle)
    except OSError as e:
        raise ValueError(f"bad {path}: {e}") from None


if __name__ == "__main__":
    print(load("alpha.json"))
