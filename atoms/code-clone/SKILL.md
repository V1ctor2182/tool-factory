---
name: code-clone
description: Find Python code repeated across the parts in a folder, for free. Use when deciding what to move into a shared module. It reports copies and changes nothing.
---

# code-clone

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds the verb's inputs, and `bin/code-clone find --help` prints them.

```sh
bin/code-clone find --root atoms --json
bin/code-clone find --root atoms --min-size 15
```

It parses each Python file in a part's `src` folder, then finds runs of statements with the same syntax in two or more parts. Names, attributes, and literal values are ignored, so a renamed copy still matches. Imports, docstrings, and main guards never count. A clone nested inside a larger clone is left out. It also reports each part's source lines. The result is defined by `contracts/code-clones.schema.json`.

The match is by shape, so small clones can be coincidence. Read the code before you act on one.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | `--root` is not a folder | Pass the folder that holds the parts |
| `invalid_args` | A missing `--root`, or a `--min-size` below 1 | Check `bin/code-clone find --help` |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
