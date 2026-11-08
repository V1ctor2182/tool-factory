---
name: atom-audit
description: Show which atoms repeat each other's code and which may own a second noun. Use when Victor asks what to merge, split, or move to the kit. It reports evidence and changes nothing.
allowed-tools: Bash(*atom-audit/run *)
---

# atom-audit

Run the `run` script in this skill's folder.

```sh
<this skill's folder>/run scan
<this skill's folder>/run scan --min-size 15 --json
<this skill's folder>/run scan --base <main's atoms folder>
```

A clone counts as added when the base has no clone of the same syntax shape across the same atoms. A clone that only moved lines does not count. An atom that joins a known clone does.

It calls the `code-clone` atom on this repo's `atoms` folder and reads the manifest of each large atom. It is free and writes no files.

Without `--base`, it prints three sections, and `--json` prints the result as `contracts/atom-audit.schema.json` defines it.

- **Repeated code.** Move a real clone to the kit, as the kit's rules allow. A match is by syntax, so read the code first.
- **Atoms that share the most code.** A high share is a reason to ask whether the two are one atom.
- **Large atoms.** Size is a reason to read the atom and ask whether it owns one noun. Size alone is not a reason to split.

It covers Python only. It holds no verdict, so show Victor the evidence and let him decide.

On failure the script exits 1. With `--json` it prints `{"error": {"code", "message"}}`, otherwise the code and message go to stderr.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | `--atoms` or `--base` is not a folder | Pass the folder that holds the atoms |
| `invalid_args` | A `--min-size` below 1, or an unknown argument | Check `run scan --help` |
| `internal` | A bug in an atom. The traceback is on stderr | Report the message and the traceback |
