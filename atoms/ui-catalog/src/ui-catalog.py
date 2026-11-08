# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
from pathlib import Path
from urllib.parse import urljoin, urlparse

from factory_kit import cli, web


def _folder(url: str) -> str:
    return url if url.endswith("/") else url + "/"


def _catalog(source: str, index: str, data, base: str | None) -> dict:
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        raise cli.AtomError("invalid_source", f"Not a shadcn registry index: {index}")
    if base is None:
        if not isinstance(data.get("homepage"), str):
            raise cli.AtomError("invalid_args", f"The index has no homepage, so pass --base: {index}")
        base = data["homepage"].rstrip("/") + "/r/"
    items: dict[str, dict] = {}
    for entry in data["items"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
            raise cli.AtomError("invalid_source", f"An index item has no name: {index}")
        items.setdefault(
            entry["name"],
            {
                "name": entry["name"],
                "type": entry.get("type"),
                "title": entry.get("title"),
                "description": entry.get("description"),
                "itemUrl": urljoin(_folder(base), f"{entry['name']}.json"),
            },
        )
    return {"source": source, "index": index, "items": list(items.values()), "cacheHit": False}


def registry(url: str, base: str | None) -> dict:
    web.check_url(url)
    index = url if urlparse(url).path.endswith(".json") else url.rstrip("/") + "/r/registry.json"
    return _catalog(url, index, web.get_json(index, "ui-catalog"), base or urljoin(index, "."))


def parse(path: str, base: str | None) -> dict:
    data = cli.read_json(path, "invalid_source", f"Not a registry index file: {path}")
    return _catalog(path, path, data, base)


def _text(result: dict) -> str:
    return "\n".join(item["itemUrl"] for item in result["items"])


if __name__ == "__main__":
    cli.main(
        Path(__file__).resolve().parent.parent,
        {"registry": cli.Verb(registry, _text), "parse": cli.Verb(parse, _text)},
    )
