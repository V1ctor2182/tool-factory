# victor-tool-factory

Every prompt in this repo runs in poteto-mode. Read `~/.claude/skills/poteto-mode/SKILL.md` before the first task of a session and after any compaction. Match each task to a playbook, open the todolist with its steps, name the principles that shaped each decision. A casual question still gets a poteto-style reply (short sentences, evidence or label on every claim, no long dashes, no mid-sentence colons).

## What this repo is

A personal monorepo of atomic tools that plug into Victor's projects and agents. `ARCHITECTURE.md` is the design. Part 1 covers the factory, Part 2 walks the video-to-text example. Read it before touching `factory/`, `kit/`, `contracts/`, or any `service.json`.

## Rules that are not negotiable here

- A service owns one noun and one output contract. Two output types means two services.
- Services import `kit/`, never each other. Recipes compose services through their CLIs and list them in `uses`.
- `kit/` holds plumbing only. No domain logic, no vendor clients.
- Runtime data never enters the repo. It lives under `$TOOL_FACTORY_HOME`, default `~/.local/share/tool-factory/`.
- Every verb is idempotent and cache-keyed by content hash.
- Every binary, env var, and paid key a service needs is declared in its `service.json`.
- `service.json` is the single source of truth. MCP tools, dashboard rows, and skill docs derive from it. Never hand-write a second copy of a verb's schema.
- Code enters `factory/` or `kit/` only when the second service needs it.

## Conventions

- `factory/` is Node 24 with zero dependencies, run directly with type stripping.
- A Python service runs through `uv run` with inline script dependencies until it passes about 300 lines.
- Tests call `bin/<name> <verb> --json` the way a consumer does and assert a literal expected output.
- Commit messages and PR descriptions follow `/technical-writing`. Run `/deslop` before a commit.
- Anything that spends money is a user-only skill plus a `PreToolUse` hook. A skill line is a request. A hook is enforcement.

## Commands

```
node factory/bin/factory.mjs list
node factory/bin/factory.mjs doctor
node factory/bin/factory.mjs test
node factory/bin/factory.mjs status
```
