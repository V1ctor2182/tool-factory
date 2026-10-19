# victor-tool-factory architecture

A personal monorepo of small, atomic tools that plug into Victor's own projects and agents on his Mac. One directory per service. One `service.json` manifest per service as the single source of truth. One generic `factory` CLI that reads the manifests and provides everything a service should not have to write itself: the MCP adapter, the run log, health checks, skill linking, scaffolding, and the dashboard.

Design date 2026-10-14. Precedents are two services Victor already built: `vibehub-personal` (one zero-dependency Node file that is both CLI and MCP server) and `art-desk` (a hosted Hono service with a thin stdio MCP wrapper).

## Who it is for

One person on one machine. Victor calls the tools from a terminal or from scripts in his projects. Claude Code and Codex on this Mac call them through a linked skill or MCP. Nobody else installs or runs them.

That fact removes work:

- **Breaking changes are cheap.** Victor owns every caller. When an output changes, the same change fixes the callers. Manifests carry no version.
- **Local first.** Everything runs on this laptop. The dashboard binds to localhost.
- **Secrets come from the macOS keychain**, as `art-desk` does it. No env files with keys in the repo.
- **No publishing.** `factory link` is the only install path. Registries such as skills.sh are out of scope.

The success measure is time from "I need X" to an agent calling X. Reuse of public repos and `factory new` serve that measure most.

## Three rules that define a service

1. **One noun, one output contract.** A service owns one kind of thing (a transcript, a fetched media file) and every verb returns that contract or a list of it. A service with two output types is two services. Several backends behind one contract are fine (captions and whisper both produce a `Transcript`).
2. **No imports across services.** Composition happens only through the CLI contract, or in a recipe. A service must install, run, and test alone.
3. **Runtime data lives outside the repo.** Caches, downloads, run logs, and secrets go under `$TOOL_FACTORY_HOME` (default `~/.local/share/tool-factory/<service>/`). The repo holds code, manifests, schemas, and tests only.

Four more rules keep services pluggable:

4. **Every verb is idempotent.** The same input produces a cache hit keyed by a content hash, so reruns are free and crashes rerun safely.
5. **Declare every dependency.** Binaries, env vars, and paid keys appear in the manifest. `factory doctor` checks them. A service never discovers a missing binary at run time.
6. **The CLI is the contract.** `bin/<name> <verb> [args] --json` writes one JSON object to stdout, logs to stderr, exits 0 or 1, and reports failures as `{"error": {"code", "message"}}`. Everything else (MCP tools, dashboard rows, skill docs) is derived from the manifest plus this contract.
7. **Tests call the CLI the way a consumer does** and assert a literal expected output.

## Repo layout

```
victor-tool-factory/
  CLAUDE.md                     poteto-mode and repo conventions, under 60 lines
  README.md                     what this is, how to add and plug a service
  ARCHITECTURE.md               this file
  factory/                      the lever. Node 24, zero dependencies, type stripping
    bin/factory.mjs             list | status | doctor | run | mcp | link | new | test | dashboard
    lib/manifest.mjs            load and validate every services/*/service.json
    lib/registry.mjs            merge local services with external ones (art-desk, vibehub-personal)
    lib/mcp.mjs                 generic MCP server: one tool per verb, spawns the service CLI
    lib/runs.mjs                append-only JSONL run log and the queries the dashboard needs
    lib/doctor.mjs              check binaries, env vars, and health commands
    templates/node/             scaffold for a Node service
    templates/uv/               scaffold for a Python service run through uv
  contracts/                    shared JSON Schemas, versioned by file name
    service.schema.json         the manifest schema
    run.schema.json             one run-log record
    transcript.schema.json      first output contract
    media-file.schema.json
  services/
    transcript/
      service.json              manifest (see below)
      SKILL.md                  when an agent should use it, which verbs, examples
      README.md                 human setup notes
      bin/transcript            executable, `uv run` with inline dependencies
      src/
      test/
    fetch/                      URL to local media file plus metadata
  recipes/                      compositions of services, each a skill plus an optional script
    read-video/
      SKILL.md                  fetch, then transcript, then summarize
      run.sh
  external.json                 services that live in other repos, by path and MCP command
  dashboard/                    Hono server plus one HTML page. Reads factory/lib only
    server.ts
    index.html
  docs/
    research/                   the three studio briefs from 2026-10-10 (moved from research/)
    decisions/                  one short file per decision that changes a rule above
```

`research/` moves under `docs/research/` in the first implementation PR. The briefs are the origin of the transcript and video services and stay useful, but they are not the identity of the repo any more.

## The manifest

`services/transcript/service.json`:

```json
{
  "name": "transcript",
  "description": "Transcript of a YouTube video or a local media file, with timestamps.",
  "status": "alpha",
  "runtime": "uv",
  "entry": "bin/transcript",
  "contract": "transcript",
  "verbs": [
    {
      "name": "get",
      "description": "Return the transcript. Uses captions when YouTube has them, whisper otherwise.",
      "input": { "type": "object", "properties": { "source": { "type": "string" }, "language": { "type": "string" } }, "required": ["source"] },
      "output": "transcript"
    },
    {
      "name": "srt",
      "description": "Same as get, rendered as SRT text.",
      "input": { "type": "object", "properties": { "source": { "type": "string" } }, "required": ["source"] },
      "output": "text"
    }
  ],
  "needs": {
    "bin": ["ffmpeg", "yt-dlp"],
    "env": [],
    "paid": []
  },
  "health": "bin/transcript doctor",
  "adapters": ["cli", "mcp", "skill"]
}
```

What each field buys:

- `verbs[].input` is a JSON Schema. The generic MCP adapter uses it as the tool's input schema unchanged. The dashboard renders it as docs. Nothing is written twice.
- `contract` names the file in `contracts/`. Consumers parse at that boundary and trust the type afterwards.
- `needs` and `health` feed `factory doctor` and the dashboard's green or red cell.
- `status` is one of `idea`, `alpha`, `stable`, `deprecated`. The dashboard groups by it.
- `adapters` lists what the service offers. `http` is allowed but no service starts with it. See the HTTP rule below.

`external.json` lists services in other repos so the dashboard shows all of them:

```json
[
  { "name": "art-desk", "path": "../art-desk", "mcp": ["node", "../art-desk/mcp/server.ts"], "status": "stable" },
  { "name": "vh-personal", "path": "../vibehub-personal", "mcp": ["node", "../vibehub-personal/bin/vh-personal.mjs", "mcp"], "status": "stable" }
]
```

## How a service plugs in

The CLI is the core. MCP is an adapter the factory generates. HTTP waits for a trigger.

| Socket | Command | What happens |
|---|---|---|
| Claude Code or Codex, default | `factory link transcript --into ~/proj` | Symlinks `services/transcript/SKILL.md` into the project's skills folder. The agent runs the CLI through its shell. This costs less context than MCP tools. |
| Script in a project | `transcript get <url> --json \| jq .segments` | `factory link --bin` puts `bin/transcript` on `PATH` through `~/.local/bin` |
| Surface with no shell, or typed per-tool approval | `claude mcp add transcript -- factory mcp transcript` | `factory` reads the manifest, exposes one MCP tool per verb, spawns `bin/transcript <verb> --json` per call, logs the run |
| Several services over MCP | `factory mcp transcript fetch` | One MCP process, tools from both manifests |

A service never knows which socket called it. That is what keeps it atomic.

### The HTTP rule

A service gets an `http` adapter only on one of these triggers. The adapter lives in `factory/`, so every service gets it at once.

| Trigger | Example |
|---|---|
| A caller on another machine | Phone, a cloud routine, a Railway service |
| A warm process that a timing run proves worth it | A whisper model whose load time dominates each call |
| A UI that writes | Dashboard buttons, which v1 does not have |

## The run log

Every invocation through `factory run` or the MCP adapter appends one line to `$TOOL_FACTORY_HOME/runs.jsonl`:

```json
{ "service": "transcript", "verb": "get", "startedAt": "...", "ms": 4210, "ok": true, "cacheHit": false, "cost": 0, "caller": "mcp" }
```

Direct CLI calls that bypass `factory run` are not logged. Agents that use a linked skill call the CLI directly, so the generated `SKILL.md` tells them to call `factory run <service> <verb>` instead. The log exists for the dashboard and for cost tracking on paid services.

## The dashboard

`factory status` prints the table in the terminal. `factory dashboard` serves the same data on `localhost:4100` with one HTML page. Both read the registry, the doctor results, and the run log. There is no database and no write path.

Columns: service, status, runtime, adapters, dependencies ok, runs last 7 days, failures last 7 days, median duration, last run, cost last 30 days. Clicking a row shows the verbs with their schemas, the README, and the last 50 runs.

The dashboard is read-only on purpose. The moment it gains buttons it becomes a product with auth and state, which is what art-desk already is.

## Design alternatives considered

| Candidate | Shape | Why not |
|---|---|---|
| A. Repo per service plus a registry repo | Each service its own repo, a separate repo holds the dashboard and a list of git URLs | Dashboard needs every manifest and run log on one machine anyway. Cross-repo versioning for three to ten solo services is overhead with no consumer. Earlier recommendation in this session, revised once a dashboard became a requirement. |
| B. Monorepo, manifests, generic factory CLI | This document | Chosen. One registry, one adapter, services in any runtime. |
| C. One MCP server process with services as in-process plugins | Single Node process imports each service as a module | Forces one language. The transcript ecosystem is Python. Services stop being installable alone. A crash in one plugin takes the server down. |

Interface depth favors B. A service's public surface is one CLI with a manifest. The factory hides MCP, logging, doctor, and the dashboard behind it.

## Sequencing

1. **PR 1, the lever and the first service.** `contracts/service.schema.json`, `factory list | doctor | run | mcp | new`, and `services/transcript` with captions through `yt-dlp` and whisper through `faster-whisper`. One real service proves the manifest. Move `research/` to `docs/research/`.
2. **PR 2, the second service and linking.** `services/fetch`, `factory link`, `recipes/read-video`. The second service is where the manifest earns or loses fields.
3. **PR 3, the dashboard.** `factory status`, the run log, `factory dashboard`, and `external.json`. Built after two services exist so it renders real rows.

Rule for the factory itself. A feature enters `factory/` only when the second service needs it. Until then it stays in the service.

## Decisions still open

- **Python packaging for `uv` services.** Single file with inline script dependencies, or a `pyproject.toml` per service. Start with the single file and promote when a service passes about 300 lines.
- **Whisper backend on this Mac.** `faster-whisper` is pure Python and fast on CPU. `whisper.cpp` uses Metal and needs a binary. Decide by timing both on one ten-minute file in PR 1. The same run measures model load time, which decides the warm-process HTTP trigger.
- **Move `research/` to `docs/research/`** in PR 1, or leave it at the root.
