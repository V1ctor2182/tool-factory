# victor-tool-factory architecture

A personal monorepo of small, atomic tools that plug into Victor's own projects and agents on his Mac.

This document has two parts. Part 1 is the factory itself. It covers where services live, what code they share, how outside callers use them, and how Victor manages them. Part 2 walks one real job through that system, turning a YouTube video into text, to show every Part 1 rule in use.

Design date 2026-10-14, restructured 2026-10-19. Precedents are two tools Victor already built. `vibehub-personal` is one zero-dependency Node file that is both CLI and MCP server. `art-desk` is a hosted Hono service with a thin stdio MCP wrapper.

---

# Part 1. The factory

## Who it is for

One person on one machine. Victor calls the tools from a terminal or from scripts in his projects. Claude Code and Codex on this Mac call them through a linked skill or MCP. Nobody else installs or runs them.

That fact removes work:

- **Breaking changes are cheap.** Victor owns every caller. When an output changes, the same change fixes the callers. Manifests carry no version.
- **Local first.** Everything runs on this laptop. The dashboard binds to localhost.
- **Secrets come from the macOS keychain**, as `art-desk` does it. No env files with keys in the repo.
- **No publishing.** `factory link` is the only install path. Registries such as skills.sh are out of scope.

The success measure is time from "I need X" to an agent calling X. Reuse of public repos and `factory new` serve that measure most.

## The pieces

| Piece | Lives in | Job |
|---|---|---|
| Service | `services/<name>/` | Does one job and returns one data shape. Wraps a public library where one exists. |
| Recipe | `recipes/<name>/` | Chains services through their CLIs into a bigger job. Holds no logic of its own beyond the order and the fallbacks. |
| Contract | `contracts/<shape>.schema.json` | One shared data shape, as JSON Schema. Several services can return the same shape. |
| Kit | `kit/py/`, `kit/node/` | Shared plumbing code that services import. No domain logic. |
| Factory | `factory/` | The management plane. Reads every manifest and provides MCP, linking, health checks, the run log, scaffolding, tests, and the dashboard. |
| Data home | `~/.local/share/tool-factory/` | Everything services produce at run time. Never in git. |

## Repo layout

```
victor-tool-factory/
  CLAUDE.md                       poteto-mode and repo rules
  README.md
  ARCHITECTURE.md                 this file
  factory/                        management plane. Node 24, zero dependencies
    bin/factory.mjs               list | status | doctor | run | mcp | link | unlink | new | test | dashboard
    lib/manifest.mjs              load and validate every service.json
    lib/registry.mjs              local services and recipes plus external.json
    lib/mcp.mjs                   generic MCP server, one tool per verb
    lib/runs.mjs                  append-only run log and its queries
    lib/links.mjs                 the link ledger
    lib/doctor.mjs                binaries, secrets, health commands
    lib/rules.mjs                 repo rules as checks, run by factory test
    templates/uv/                 scaffold for a Python service
    templates/node/               scaffold for a Node service
    dashboard/                    one HTML page and a tiny local server
  kit/                            shared code services may import
    py/                           factory_kit, a uv path dependency
    node/                         factory-kit, a relative import
  contracts/
    service.schema.json           the manifest
    run.schema.json               one run-log line
    transcript.schema.json
    media.schema.json
  services/
    <name>/
      service.json                manifest, the single source of truth
      SKILL.md                    when and how an agent uses it
      README.md                   setup notes for Victor
      bin/<name>                  the CLI entry point
      src/
      test/
  recipes/
    <name>/
      service.json                same manifest, with "kind": "recipe" and "uses"
      SKILL.md
      run.sh
  external.json                   tools in other repos, shown in the dashboard
  docs/
    research/                     origin briefs, moved from research/
    decisions/                    one file per decision that changes a rule here
```

## Where everything is stored

| What | Where | In git |
|---|---|---|
| Code Victor writes | `services/`, `recipes/`, `kit/`, `factory/` | Yes |
| Shared data shapes | `contracts/` | Yes |
| Public libraries a service reuses | `~/.cache/uv/` for Python, `node_modules` for Node | No. Rebuilt from the dependency list on the next run. |
| Model weights | `~/.cache/huggingface/` and similar | No. Downloaded once. |
| Service output and caches | `~/.local/share/tool-factory/<service>/` | No |
| Run log | `~/.local/share/tool-factory/runs.jsonl` | No |
| Link ledger | `~/.local/share/tool-factory/links.json` | No |
| Secrets | macOS keychain, service `tool-factory`, account = secret name | No |

`$TOOL_FACTORY_HOME` overrides the data home. Deleting it loses caches and history, never code.

## What a service is

1. **One noun, one output contract.** A service owns one kind of thing, and every verb returns that contract or a list of it. A service that returns two shapes is two services. Several backends behind one contract are fine.
2. **Services import the kit, never each other.** Composition happens in a recipe, through CLIs. A service installs, runs, and tests alone.
3. **Runtime data lives in the data home.** The repo holds code, manifests, schemas, and tests only.
4. **Every verb is idempotent.** The same input hits a cache keyed by content, so reruns are free and a crashed run reruns safely.
5. **Declare every dependency.** Binaries, secrets, and paid APIs appear in the manifest. `factory doctor` checks them before a run needs them.
6. **The CLI is the contract.** `bin/<name> <verb> [args] --json` writes one JSON object to stdout, logs to stderr, exits 0 or 1, and reports failures as `{"error": {"code", "message"}}`. MCP tools, dashboard rows, and skill docs derive from the manifest plus this contract.
7. **Tests call the CLI the way a consumer does** and assert a literal expected output.

`factory test` enforces rules 2, 5, and 6 with checks in `factory/lib/rules.mjs`, so they cannot drift.

## Shared code: the kit

The kit is plumbing every service would otherwise copy. It holds nothing about any one job.

| Module | Does |
|---|---|
| `cli` | Parse argv, print the JSON result or the error envelope, set the exit code |
| `paths` | Resolve the service's folder in the data home |
| `cache` | Read and write a JSON result by key, atomically through a temp file and rename |
| `hash` | Stream a SHA-256 of a file for cache keys |
| `secrets` | Read a secret from the environment, else from the keychain |

What never goes in the kit:

- Domain logic, such as how to transcribe or how to download.
- A client for one vendor's API. That belongs to the service that uses the vendor.
- Anything only one service uses. Code enters the kit when the second service needs it, and not before.

How services import it:

- **Python.** The service's inline script header declares `factory-kit` with a `[tool.uv.sources]` path to `kit/py`. Verified 2026-10-19 with uv 0.12.7. The import works from any working directory, and edits to the kit apply on the next run.
- **Node.** A relative import from `kit/node/`.

## Shared data shapes: contracts

A contract is a JSON Schema in `contracts/`. A manifest names the contract its verbs return. Two services may return the same contract, and that is how a recipe can swap one for the other. There is no code generation. Each service's tests validate its real output against the schema.

## Dependency rules

| From | May use | Never uses |
|---|---|---|
| Service | Kit, contracts, public libraries | Another service, a recipe, the factory |
| Recipe | Service CLIs it lists in `uses` | Service source code, the kit |
| Kit | The standard library | Services, recipes, contracts |
| Factory | Manifests, service and recipe CLIs, contracts | Service source code |
| Outside caller | CLI, linked skill, MCP, later HTTP | Anything inside a service folder |

## The manifest

Services and recipes share one manifest shape. Part 2 shows full examples.

| Field | Used by |
|---|---|
| `name`, `description` | Every adapter and the dashboard |
| `kind` | `service` or `recipe`. Only a recipe may have `uses`. |
| `status` | `idea`, `alpha`, `stable`, `deprecated`. The dashboard groups by it. |
| `runtime`, `entry` | The factory, to run the CLI |
| `contract` | Consumers, who parse at that boundary and trust the type afterwards |
| `verbs[]` | Each verb's name, description, input JSON Schema, and output contract. The MCP adapter uses the input schema unchanged. |
| `needs` | `bin`, `secrets`, `paid`. Read by `factory doctor`. |
| `health` | A command doctor runs |
| `adapters` | Which sockets this service offers |
| `uses` | Recipes only. The services it calls. |

## How outside callers use it

The CLI is the core. Every other socket wraps it, and the factory generates them all from the manifest.

| Caller | Socket | Command |
|---|---|---|
| Victor's scripts, any language | CLI on PATH | `factory link <name> --bin` symlinks into `~/.local/bin` |
| Claude Code, Codex | Linked skill that calls the CLI | `factory link <name> --into ~/proj` symlinks `SKILL.md` into the project's skills folder |
| Claude chat or any surface without a shell | MCP | `claude mcp add <name> -- factory mcp <name>` |
| Several services over one MCP server | MCP | `factory mcp <a> <b>` |
| Another machine or a cloud job | HTTP, later | Not in v1 |

A linked skill costs less agent context than MCP tools, so it is the default for coding agents. Because links are symlinks and the MCP adapter starts the CLI fresh on each call, an edit to a service applies everywhere on the next call. Only a manifest change needs the MCP server restarted.

A service never knows which socket called it. That is what keeps it atomic.

**The HTTP rule.** The factory gains an HTTP adapter, for every service at once, only on one of these triggers:

- A caller on another machine, such as a phone, a cloud routine, or a Railway service.
- A warm process that a timing run proves worth it, such as a model whose load time dominates each call.
- A UI that writes. v1 has none.

## Managing services

| Task | Command |
|---|---|
| Start a service from a template | `factory new <name> --runtime uv` |
| See everything | `factory list`, `factory status`, `factory dashboard` |
| Check binaries, secrets, health | `factory doctor` |
| Run every test and every repo rule | `factory test` |
| Plug in or unplug | `factory link`, `factory unlink` |
| Run with logging | `factory run <name> <verb> ...` |

`factory link` records every link in the link ledger, so `factory status` shows which projects use each service before you change it.

The run log gets one line per call made through `factory run` or MCP. Linked skills tell agents to call through `factory run`, so most calls are logged.

```json
{ "service": "transcribe", "verb": "file", "startedAt": "2026-10-19T14:02:11Z", "ms": 4210, "ok": true, "cacheHit": false, "cost": 0, "caller": "skill" }
```

The dashboard reads manifests, doctor results, the run log, the link ledger, and `external.json`. It shows one row per service with status, health, runs and failures over seven days, median duration, cost over thirty days, and linked projects. It is read-only. Buttons would turn it into a product with auth and state.

`external.json` lists tools that live in other repos so the dashboard shows all of them:

```json
[
  { "name": "art-desk", "path": "../art-desk", "mcp": ["node", "../art-desk/mcp/server.ts"], "status": "stable" },
  { "name": "vh-personal", "path": "../vibehub-personal", "mcp": ["node", "../vibehub-personal/bin/vh-personal.mjs", "mcp"], "status": "stable" }
]
```

## Design alternatives considered

| Candidate | Why not |
|---|---|
| One repo per service plus a registry repo | The dashboard needs every manifest and run log on one machine anyway. Cross-repo versioning has no consumer when one person owns every caller. |
| One MCP server process with services as in-process plugins | Forces one language, and much of the useful public code is Python. Services stop running alone. One crash takes every tool down. |
| **Monorepo, manifests, generic factory** | Chosen. One registry, one set of adapters, services in any runtime. |

---

# Part 2. Example: YouTube video to text

## The job

Victor wants the text of a YouTube video, with timestamps. The obvious build is one "YouTube transcriber" service. That would break rule 1, because it does three jobs: download media, read the platform's captions, and turn speech into text. A meeting-notes project with a Zoom recording would then carry YouTube code it never uses.

So the job becomes three services and one recipe:

| Piece | Kind | Takes | Returns | Reuses |
|---|---|---|---|---|
| `media` | service | A URL from any site yt-dlp supports | `media` contract, a local file plus metadata | yt-dlp |
| `captions` | service | A URL from any site yt-dlp supports | `transcript` contract, or the error `no_captions` | yt-dlp |
| `transcribe` | service | Any local audio or video file | `transcript` contract | faster-whisper |
| `video-to-text` | recipe | A URL | `transcript` contract | The three services above |

YouTube appears nowhere in the code. yt-dlp's supported-sites list had 1,731 entries on 2026-10-19, and YouTube is one of them.

## Where its code lives

```
contracts/
  transcript.schema.json          shared by captions, transcribe, and the recipe
  media.schema.json
kit/py/factory_kit/               cli, paths, cache, hash, used by all three services
services/
  media/
    service.json
    SKILL.md
    bin/media
    src/media.py                  yt-dlp as a library
    test/
  captions/
    service.json
    SKILL.md
    bin/captions
    src/captions.py               yt-dlp subtitles, normalized to a transcript
    test/
  transcribe/
    service.json
    SKILL.md
    bin/transcribe                runs uv run --script on src/transcribe.py
    src/transcribe.py
    test/
      fixtures/hello.aiff         made with macOS say
      expected/hello.json
      expected/hello.srt
recipes/
  video-to-text/
    service.json                  "kind": "recipe", "uses": ["captions", "media", "transcribe"]
    SKILL.md
    run.sh
```

At run time:

```
~/.local/share/tool-factory/
  media/files/<site>-<id>.<ext>
  media/cache/<site>-<id>.json
  captions/cache/<site>-<id>-<lang>.json
  transcribe/cache/<sha256>-<model>-<lang>.json
  runs.jsonl
  links.json
~/.cache/uv/                      yt-dlp, faster-whisper, PyAV
~/.cache/huggingface/             whisper weights
```

## The shared shape

`contracts/transcript.schema.json` describes this object. `captions` and `transcribe` both return it, and `method` says which one did.

```json
{
  "source":   { "kind": "url", "ref": "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
  "language": "en",
  "method":   "captions",
  "model":    null,
  "segments": [{ "start": 0.0, "end": 3.2, "text": "All right, so here we are in front of the elephants" }],
  "words":    null,
  "cacheHit": false
}
```

`words` is filled only when `transcribe` runs with word timestamps. The segment text above is illustrative, not checked against the real video.

## The flow

```
video-to-text <url>
  captions get <url>           cache hit, or yt-dlp subtitles -> transcript, exit 0
  on no_captions:
    media get <url>            cache hit, or yt-dlp audio -> local file
    transcribe file <path>     cache hit by file hash, or faster-whisper -> transcript
  print the transcript
```

`run.sh` is the whole recipe:

```sh
#!/bin/sh
set -e
captions get "$1" --json && exit 0
path=$(media get "$1" --audio-only --json | jq -r .path)
transcribe file "$path" --json
```

`captions get` exits 1 for any failure. The real script checks that the error code is `no_captions` before falling back, so a network failure surfaces instead of triggering a download.

## Manifests

`services/transcribe/service.json`:

```json
{
  "name": "transcribe",
  "kind": "service",
  "description": "Speech to text for any local audio or video file, with segment and word timestamps.",
  "status": "alpha",
  "runtime": "uv",
  "entry": "bin/transcribe",
  "contract": "transcript",
  "verbs": [
    {
      "name": "file",
      "description": "Transcribe one local file. Cached by file hash, model, and language.",
      "input": {
        "type": "object",
        "properties": {
          "path": { "type": "string" },
          "language": { "type": "string" },
          "words": { "type": "boolean" }
        },
        "required": ["path"]
      },
      "output": "transcript"
    },
    {
      "name": "srt",
      "description": "Same as file, rendered as SRT subtitles.",
      "input": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] },
      "output": "text"
    }
  ],
  "needs": { "bin": [], "secrets": [], "paid": [] },
  "health": "bin/transcribe doctor",
  "adapters": ["cli", "mcp", "skill"]
}
```

`needs.bin` is empty because faster-whisper decodes audio through PyAV, which ships its own ffmpeg libraries. That is inferred from the faster-whisper README and gets checked in PR 1.

`recipes/video-to-text/service.json` differs only where a recipe differs:

```json
{
  "name": "video-to-text",
  "kind": "recipe",
  "description": "Text of an online video. Uses the site's captions when they exist, otherwise downloads the audio and transcribes it.",
  "status": "alpha",
  "runtime": "sh",
  "entry": "run.sh",
  "contract": "transcript",
  "uses": ["captions", "media", "transcribe"],
  "verbs": [
    {
      "name": "get",
      "description": "Transcript for one video URL.",
      "input": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"] },
      "output": "transcript"
    }
  ],
  "needs": { "bin": ["jq"], "secrets": [], "paid": [] },
  "adapters": ["cli", "mcp", "skill"]
}
```

## How projects plug it in

| Project | Plugs in | Command |
|---|---|---|
| A YouTube research project | The recipe | `factory link video-to-text --into ~/youtube-proj` |
| A meeting-notes project | `transcribe` only | `factory link transcribe --into ~/meetings` |
| A podcast clipper | `media` and `transcribe` | `factory link media transcribe --into ~/podcast` |
| Claude chat | The recipe over MCP | `claude mcp add video-to-text -- factory mcp video-to-text` |

## Build order

Each step ends in a check that runs before the next one starts. The first service comes before any factory code, which proves it stands alone.

1. **PR 1, `transcribe` alone.** Contract, manifest, CLI, cache with helpers inline, `srt` verb, tests on the `say` fixture. Time faster-whisper against whisper.cpp on one ten-minute file and record the choice in `docs/decisions/`. Move `research/` to `docs/research/`.
2. **PR 2, `media` and `captions`, then the kit.** The second service is when shared helpers move from `transcribe` into `kit/py`. Add the `video-to-text` recipe. Check it on one video with captions and one without.
3. **PR 3, factory core.** Manifest loading, `list`, `doctor`, `run`, the run log, and `mcp`. Check that a Claude Code session calls the recipe over MCP.
4. **PR 4, linking and rules.** `link`, `unlink`, the ledger, and `factory test` with the repo rules as checks. Check that a planted cross-service import fails the test.
5. **PR 5, dashboard.** `status`, `dashboard`, and `external.json`. Check that it shows the three services, the recipe, art-desk, and vh-personal.

## Decisions still open

- **Whisper backend.** PR 1 decides with measured numbers. The same run measures model load time, which decides the warm-process HTTP trigger.
- **Default model size.** Start with `small` and revisit after the timing run. The starting point is a guess.
- **yt-dlp goes stale.** YouTube changes often, so the dependency stays unpinned. `factory doctor` reports its age.
- **YouTube may refuse requests from this network.** PR 2 shows whether it does. A cookie workaround is out of scope until then.
- **The data home grows without limit.** Add a prune command when it first matters.
