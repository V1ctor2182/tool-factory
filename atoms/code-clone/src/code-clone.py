# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import ast
from collections import defaultdict
from itertools import combinations
from pathlib import Path
from typing import NamedTuple

from factory_kit import cli

IGNORED_FIELDS = {"ctx", "type_params", "name", "asname", "id", "attr"}


class Location(NamedTuple):
    part: str
    file: str
    startLine: int
    endLine: int


class Block(NamedTuple):
    part: str
    file: str
    statements: list[ast.stmt]
    shapes: list[str]


def _shape(node) -> str:
    if isinstance(node, ast.arg):
        return "arg"
    if isinstance(node, ast.Constant):
        return type(node.value).__name__
    if isinstance(node, ast.AST):
        fields = [_shape(value) for field, value in ast.iter_fields(node) if field not in IGNORED_FIELDS]
        return f"{type(node).__name__}({' '.join(fields)})"
    if isinstance(node, list):
        return f"[{','.join(_shape(item) for item in node)}]"
    return repr(node)


def _boilerplate(statement: ast.stmt) -> bool:
    if isinstance(statement, (ast.Import, ast.ImportFrom)):
        return True
    if isinstance(statement, ast.Expr) and isinstance(statement.value, ast.Constant) and isinstance(statement.value.value, str):
        return True
    return isinstance(statement, ast.If) and "__name__" in ast.dump(statement.test)


def _blocks(tree: ast.Module, part: str, file: str) -> list[Block]:
    blocks = []
    for node in ast.walk(tree):
        for field in ("body", "orelse", "finalbody"):
            body = getattr(node, field, None)
            if not isinstance(body, list):
                continue
            statements = [s for s in body if not _boilerplate(s)]
            if statements:
                blocks.append(Block(part, file, statements, [_shape(s) for s in statements]))
    return blocks


def _size(statements: list[ast.stmt]) -> int:
    return sum(1 for statement in statements for _ in ast.walk(statement))


def _location(block: Block, start: int, length: int) -> Location:
    return Location(block.part, block.file, block.statements[start].lineno, block.statements[start + length - 1].end_lineno)


def _runs(blocks: list[Block], min_size: int) -> dict[tuple[str, ...], tuple[int, set[Location]]]:
    places = defaultdict(list)
    for block in blocks:
        for i, shape in enumerate(block.shapes):
            places[shape].append((block, i))
    runs = {}
    for found in places.values():
        for (one, i1), (two, i2) in combinations(found, 2):
            if one.part == two.part or (i1 and i2 and one.shapes[i1 - 1] == two.shapes[i2 - 1]):
                continue
            n = 1
            while i1 + n < len(one.shapes) and i2 + n < len(two.shapes) and one.shapes[i1 + n] == two.shapes[i2 + n]:
                n += 1
            size = _size(one.statements[i1 : i1 + n])
            if size >= min_size:
                _, locations = runs.setdefault(tuple(one.shapes[i1 : i1 + n]), (size, set()))
                locations.update({_location(one, i1, n), _location(two, i2, n)})
    return runs


def _apart(locations: set[Location]) -> list[Location]:
    kept = []
    for location in sorted(locations):
        if not any(location.file == other.file and location.startLine <= other.endLine for other in kept):
            kept.append(location)
    return kept


def _inside(location: Location, other: Location) -> bool:
    return location.file == other.file and other.startLine <= location.startLine and location.endLine <= other.endLine


def _clones(runs: dict) -> list[dict]:
    ranked = sorted(((size, _apart(locations)) for size, locations in runs.values()), key=lambda run: (-run[0], run[1]))
    kept, covered = [], []
    for size, locations in ranked:
        if not all(any(_inside(location, other) for other in covered) for location in locations):
            kept.append({"size": size, "locations": [location._asdict() for location in locations]})
            covered += locations
    return kept


def find(root: str, minSize: int) -> dict:
    if minSize < 1:
        raise cli.AtomError("invalid_args", f"--min-size must be 1 or more, not {minSize}.")
    folder = Path(root).expanduser().absolute()
    if not folder.is_dir():
        raise cli.AtomError("invalid_source", f"Not a folder of parts: {folder}")
    blocks, unparsed = [], []
    lines = defaultdict(int)
    paths = sorted(folder.glob("*/src/**/*.py"))
    for path in paths:
        relative = path.relative_to(folder)
        part = relative.parts[0]
        try:
            text = path.read_text(encoding="utf-8")
            lines[part] += len(text.splitlines())
            tree = ast.parse(text)
        except (SyntaxError, UnicodeDecodeError):
            unparsed.append(str(relative))
            continue
        blocks += _blocks(tree, part, str(relative))
    return {
        "root": str(folder),
        "minSize": minSize,
        "fileCount": len(paths),
        "unparsed": unparsed,
        "parts": [{"part": part, "lines": count} for part, count in sorted(lines.items())],
        "clones": _clones(_runs(blocks, minSize)),
    }


def _text(result: dict) -> str:
    lines = [f"{c['size']}  " + "  ".join(f"{l['file']}:{l['startLine']}-{l['endLine']}" for l in c["locations"]) for c in result["clones"]]
    return "\n".join([*lines, f"{len(lines)} clones in {result['fileCount']} files."])


if __name__ == "__main__":
    cli.main(Path(__file__).resolve().parent.parent, {"find": cli.Verb(find, _text)})
