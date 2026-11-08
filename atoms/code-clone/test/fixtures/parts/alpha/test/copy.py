def load(path):
    try:
        with open(path) as handle:
            return handle.read()
    except OSError as e:
        raise ValueError(f"bad {path}: {e}") from None
