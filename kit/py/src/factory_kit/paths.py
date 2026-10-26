import os
from pathlib import Path


def home() -> Path:
    root = Path(os.environ.get("TOOL_FACTORY_HOME") or "~/.local/share/tool-factory").expanduser().absolute()
    root.mkdir(parents=True, exist_ok=True)
    return root


def atom_dir(atom: str, *parts: str) -> Path:
    path = home().joinpath(atom, *parts)
    path.mkdir(parents=True, exist_ok=True)
    return path
