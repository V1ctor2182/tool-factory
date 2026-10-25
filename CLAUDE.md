# victor-tool-factory

Every prompt in this repo runs in poteto-mode. Read `~/.claude/skills/poteto-mode/SKILL.md` before the first task of a session and after any compaction. Match each task to a playbook, open the todolist with its steps, name the principles that shaped each decision. A casual question still gets a poteto-style reply (short sentences, evidence or label on every claim, no long dashes, no mid-sentence colons).

## What this repo is

A personal monorepo of tools Victor uses right away, built from atomic parts he reuses. `ARCHITECTURE.md` is the design. Part 1 covers the factory, Part 2 builds the YouTube tool. Read it before touching `factory/`, `kit/`, `contracts/`, or any `manifest.json`.

## Rules that are not negotiable here

- A tool lives in `tools/<name>/` and does one job Victor recognizes. An atom lives in `atoms/<name>/` and owns one noun. Each returns one contract.
- Tools call atom CLIs listed in `uses`. Tools never call other tools or import atom code. Atoms import `kit/`, never each other.
- An atom's `kind` decides caching, tests, cost, and guards: `transform`, `model`, `observe`, or `act`. Follow the kinds table in `ARCHITECTURE.md`.
- `kit/` holds plumbing and the one shared model adapter. No domain logic.
- Runtime data never enters the repo. It lives under `$TOOL_FACTORY_HOME`, default `~/.local/share/tool-factory/`.
- Every binary, secret, and paid backend is declared in `manifest.json`.
- `manifest.json` is the single source of truth. MCP tools, dashboard rows, and skill docs derive from it. Never hand-write a second copy of a verb's schema.
- Code enters `factory/` or `kit/` only when a second atom needs it.
- `act` atoms need confirmation on every run, enforced by a hook. Model spend goes through the kit's budget.

## Conventions

- `factory/` is Node 24 with zero dependencies, run directly with type stripping.
- A Python atom runs through `uv run` with inline script dependencies until it passes about 300 lines.
- Tests call the CLI the way a consumer does. `transform` atoms assert a literal expected output. `model` atoms assert the schema plus required facts.
- Commit messages and PR descriptions follow `/technical-writing`. Run `/deslop` before a commit.

## Commands

```
node factory/bin/factory.mjs list
node factory/bin/factory.mjs doctor
node factory/bin/factory.mjs test
node factory/bin/factory.mjs status
```
