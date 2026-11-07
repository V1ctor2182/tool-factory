# tool-factory architecture

A personal monorepo of microservices Victor can use right away, built from small atomic parts he reuses across microservices.

This document has two parts. Part 1 is the factory. It covers microservices and atoms, where everything lives, what code is shared, how projects and agents plug in, and how Victor manages it all. Part 2 builds one real microservice, a YouTube microservice, from seven atoms.

Design date 2026-10-14, restructured 2026-10-19, rebuilt around microservices and atoms 2026-10-25. Precedents are two microservices Victor already built. `vibehub-personal` is one Node file that is both CLI and MCP server. `art-desk` is a hosted service with a thin MCP wrapper.

---

# Part 1. The factory

## Who it is for

One person on one Mac. Victor calls microservices from a terminal or his scripts. Claude Code and Codex call them through a linked skill or MCP. The code is public under the MIT license, so anyone can fork it, but the design serves only this one caller.

That fact removes work:

- **Breaking changes are cheap.** Victor owns every caller. When an output changes, the same change fixes the callers. Manifests carry no version.
- **Local first.** Everything runs on this laptop. The dashboard binds to localhost. The one exception is the public Flows page on Railway, which runs nothing and shows only what this laptop pushes to it.
- **Secrets come from the macOS keychain.** No env files with keys in the repo.
- **No publishing.** `factory link` is the only install path.

The success measure is time from "I need X" to using X. A usable microservice comes before factory machinery.

## Microservices and atoms

| | Microservice | Atom |
|---|---|---|
| What it is | Something Victor uses | One building block that does one job |
| Examples | `youtube`, `meeting-notes`, `writing-style`, `ui-clone` | `download`, `transcribe`, `frames`, `see`, `digest` |
| Lives in | `microservices/<name>/` | `atoms/<name>/` |
| Made of | Atoms it lists in `uses`, called through their CLIs | Its own code plus public libraries and the kit |
| Returns | One contract | One contract |

An atom owns one noun. If it returns two shapes, it is two atoms. A microservice owns one job Victor recognizes. Microservices never call other microservices, so the graph stays two levels deep.

### Kinds of atom

The kind decides how the factory caches, tests, and guards an atom. It is one field in the manifest, and every rule below reads from it.

| Kind | Example | Cached | Tests assert | Cost | Guard |
|---|---|---|---|---|---|
| `transform` | `download`, `transcribe`, `frames` | By content, forever | A literal expected output | Free | None |
| `model` | `see`, `digest`, `ui-draft` | By input, model, and prompt hash | Schema plus required facts | Logged per call | Optional daily budget in the kit, plus a `PreToolUse` hook in Claude Code |
| `observe` | `find-url`, `page-read` | Never, or for a day | Schema only, on a recorded fixture | Free | None |
| `act` | None yet. `click` and `type` are planned. | Never | A dry run returns the planned action | Varies | Confirmation on every run, enforced by a hook |

`ui-draft` writes a component from a page recording, and `ui-clone rebuild` loops it with `page-record` and `page-diff`. Its cost stays per call in the run log, and the loop also sums it per round into the rebuilt item's `meta`. The kit's budget caps each call as for any `model` atom.

`transcribe` runs a local model but counts as `transform`. It is free, and with temperature zero its output is stable enough to assert after normalizing case and punctuation.

### Kinds of microservice

| Kind | Has | Example |
|---|---|---|
| `pipeline` | `SKILL.md`, a `run` script, `uses` | `youtube` chains seven atoms |
| `skill` | `SKILL.md` only | `writing-style` holds house style, no code |

A pipeline microservice has two forms. The script form, `run`, works for Victor's scripts and cron jobs. The skill form tells an agent which atoms to call and lets the agent do the thinking itself. When Claude Code is the caller, it skips `model` atoms like `digest`, because it is already the model.

## Repo layout

```
tool-factory/
  CLAUDE.md
  README.md
  ARCHITECTURE.md
  CONTRIBUTING.md
  LICENSE
  microservices/                  what Victor uses
    <name>/
      manifest.json               "type": "microservice", "kind", "uses"
      SKILL.md                    the skill form
      run                         the script form, pipeline microservices only
      test/
  atoms/                          the building blocks
    <name>/
      manifest.json               "type": "atom", "kind"
      SKILL.md                    for agents that call the atom directly
      bin/<name>                  the CLI
      src/
      prompts/                    model atoms only
      test/
  kit/                            shared code atoms import
    py/                           factory_kit, a uv path dependency
    node/
  contracts/                      shared data shapes, as JSON Schema
  factory/                        management plane. Node 24, zero dependencies
    bin/factory.mjs               list | status | doctor | test | run | link | unlink | mcp | dashboard | push
    lib/
    dashboard/
  external.json                   microservices in other repos, such as art-desk
  docs/
    research/
    decisions/
```

## Where everything is stored

| What | Where | In git |
|---|---|---|
| Code Victor writes | `microservices/`, `atoms/`, `kit/`, `factory/` | Yes |
| Shared data shapes | `contracts/` | Yes |
| Public libraries | `~/.cache/uv/`, `node_modules` | No. Rebuilt from each atom's dependency list. |
| Model weights | `~/.cache/huggingface/` | No. Downloaded once. |
| Atom output and caches | `~/.local/share/tool-factory/<atom>/` | No |
| Run log, link ledger, budget | `~/.local/share/tool-factory/` | No |
| Secrets | macOS keychain, service `tool-factory` | No |

`$TOOL_FACTORY_HOME` overrides the data home. Deleting it loses caches and history, never code.

## Rules

1. **One noun per atom, one job per microservice, one contract each.**
2. **Atoms import the kit, never each other. Microservices call atom CLIs, never atom code.**
3. **Runtime data lives in the data home.** The repo holds code, manifests, schemas, prompts, and tests.
4. **The kind decides caching, tests, cost, and guards.** See the kinds table.
5. **Declare every dependency.** Binaries, secrets, and paid backends appear in the manifest. `factory doctor` checks them.
6. **The CLI is the contract.** `<name> <verb> [args] --json` writes one JSON object to stdout, logs to stderr, exits 0 or 1, and reports failures as `{"error": {"code", "message"}}`.
7. **Code enters the kit or the factory only when a second atom needs it.**

`factory test` turns rules 2, 4, 5, and 6 into checks, so they cannot drift.

## Shared code: the kit

The kit is plumbing every atom would otherwise copy.

| Module | Does |
|---|---|
| `cli` | Parse argv, print the result or the error object, set the exit code |
| `paths` | Find the atom's folder in the data home |
| `cache` | Read and write results by key, atomically |
| `hash` | Stream a SHA-256 for cache keys |
| `secrets` | Read a secret from the environment, else the keychain |
| `web` | Fetch bytes or JSON over HTTP with a User-Agent that names the atom, and map failures to error codes |
| `ytdlp` | Map yt-dlp failures to error codes, and find a URL's cache key without a network call |
| `chrome` | Start headless Google Chrome, load a page, and map failures to error codes |
| `image` | Load an image as an array, and line up two brightness profiles |
| `color` | Convert RGB to Lab |
| `model` | The one model adapter every `model` atom uses. Sends a prompt, inputs, and a JSON Schema. Returns validated JSON and the cost. Enforces the daily budget when one is set, and logs spend. |

The default `model` backend is headless Claude Code, `claude -p --output-format json --json-schema`. It runs on Victor's Claude Code login, so there is no API key. Checked 2026-10-25. A small call returned schema-valid JSON in `structured_output` with `total_cost_usd` set, in about seven seconds. The Anthropic API is the second backend when a key in the keychain is preferred.

The kit never holds domain logic or anything only one atom uses. A kit module may import a public library, and the kit's own dependency list stays empty, so an atom that uses the module declares the library in its script header. Python atoms import it through a `[tool.uv.sources]` path in their script header. Checked 2026-10-19 with uv 0.12.7.

## Shared data shapes: contracts

A contract is a JSON Schema in `contracts/`. Several atoms may return the same contract, which is how a microservice can fall back from one atom to another. Each atom's tests validate its real output against its schema.

## Who may use what

| From | May use | Never uses |
|---|---|---|
| Microservice | CLIs of atoms in its `uses` | Atom source, the kit, other microservices |
| Atom | Kit, contracts, public libraries | Other atoms, microservices, the factory |
| Kit | Standard library, the model backend, public libraries its calling atom declares | Atoms, microservices |
| Factory | Manifests, CLIs, contracts | Atom or microservice source |
| Outside caller | CLI, linked skill, MCP, later HTTP | Anything inside a folder |

## The manifest

Microservices and atoms share one manifest shape, `manifest.json`. It is the single source of truth. MCP tools, dashboard rows, and skill docs derive from it.

| Field | Meaning |
|---|---|
| `name`, `description` | Shown everywhere |
| `type` | `microservice` or `atom` |
| `kind` | `pipeline` or `skill` for microservices. `transform`, `model`, `observe`, or `act` for atoms. |
| `status` | `idea`, `alpha`, `stable`, `deprecated` |
| `runtime`, `entry` | How to run the CLI |
| `contract` | The shape every verb returns |
| `verbs[]` | Name, description, input JSON Schema, output contract |
| `uses` | Microservices only. The atoms it calls. |
| `model` | Model atoms only. Backend, default model, prompt file. |
| `needs` | `bin`, `secrets`, `paid` |
| `adapters` | `cli`, `skill`, `mcp`, later `http` |

## How projects and agents plug in

Usually you plug in a microservice. Atoms plug in the same way when a project needs just one part.

| Caller | Socket | Command |
|---|---|---|
| Every Claude Code session | Global skill | `factory link youtube --global` links into `~/.claude/skills/` |
| One project's agent | Project skill | `factory link youtube --into ~/proj` |
| Victor's scripts | CLI on PATH | `factory link youtube --bin` links into `~/.local/bin` |
| Claude chat, no shell | MCP | `claude mcp add youtube -- factory mcp youtube` |
| Another machine | HTTP | Not in v1 |

Links are symlinks and the MCP adapter starts the CLI fresh per call, so an edit applies everywhere on the next call. HTTP arrives for everything at once, and only for a remote caller, a measured warm-process need, or a dashboard that writes.

## Managing it all

| Task | Command |
|---|---|
| Start a microservice or atom | Copy the closest existing folder, as [CONTRIBUTING.md](CONTRIBUTING.md) describes |
| See everything | `factory list`, `factory status`, `factory dashboard` |
| Check binaries, secrets, budget, health | `factory doctor` |
| Run every test and rule | `factory test` |
| Plug in or unplug | `factory link`, `factory unlink` |

The run log gets one line per call through `factory run`, a microservice's `run`, or MCP:

```json
{ "type": "atom", "name": "digest", "verb": "make", "kind": "model", "startedAt": "2026-10-25T14:02:11Z", "ms": 7264, "ok": true, "cacheHit": false, "costUsd": 0.0085, "caller": "youtube" }
```

The dashboard lists microservices first, each with its atoms underneath. Each atom row shows which microservices use it, read from every microservice's `uses`, so reuse is visible. It also shows status, health, runs and failures, spend against budget, linked projects, and the microservices in `external.json`.

The dashboard can also try any verb of a microservice or an atom. Its form for each verb comes from the verb's `input` schema in `manifest.json`. `POST /run/<name>/<verb>` validates the input against that schema, runs the CLI through `invoke` with `--json`, and logs the run with `dashboard` as the caller, the same path `factory mcp` takes. It streams the CLI's stderr as progress, then the `--json` output. The server answers a run only when the request's `Origin` is the dashboard's own page, so another site open in the browser cannot start one. It refuses `act` atoms, since no one confirms them there. Model spend goes through the same daily budget as every other caller.

The dashboard has six pages: `/` for health and spend, `/try`, `/wiring`, `/docs`, `/elsewhere`, and `/flows`. The server answers each with the same HTML, and the page picks its view from the path. A click on one of these links switches the view in place with `history.pushState`, without a reload, and Try and Wiring keep their state across switches. `/docs/<name>/<verb>` documents one verb as an API reference: its CLI usage, each argument from `input` with its command-line form, its output contract's top-level fields read from `contracts/<output>.schema.json`, and request examples for the CLI, MCP, and the dashboard. Try it opens `/try?name=<name>&verb=<verb>`.

`/flows` shows every pipeline run in one shape, so a Game Studio feature, a job application, and a `site-clone` loop read the same way. `factory/lib/flows/` turns each pipeline's own records into it, read-only. A flow is stages left to right, each stage holds agents, and a loop is a back edge between stages. Game Studio is also one long-running system, so its source adds a Studio loop flow, drawn on the home page above its features. The home page shows only what is running or waiting on Victor, and folds every other run and agent behind a toggle. That flow's phases are Plan, the five work stages, Verify, and You review, and its back edges count replans, verifier rejections, and rework after review. `ui-clone` and `site-clone` get the same loop. Their sources read each service's round files and the run log, and a site's Build step reads the session transcript, so no skill reports in. An agent opens a trace, a tree of timed spans drawn as a waterfall, and gaps between spans read as model time. `external.json` names where an outside pipeline lives through its `flows` field, as a folder on this Mac or as a URL. The Job Applier runs on Bumblebee, so its `where` is the URL of Jobfeed's API, reached over an SSH tunnel because Jobfeed binds to loopback. A span shows a tool's name and at most one allowlisted detail, never a tool's result or a form value, because job transcripts hold personal data. The page polls `/api/flows` and re-renders only when the response changes. These are the dashboard's only reads outside the data home, and the only ones over a network. Each failing source shows its own error and leaves the others up.

The public Flows page is a separate server, `factory/dashboard/hosted.mjs`, deployed to Railway as the `flows` service of the `factory-flows` project. It has no login. Its routes are `/healthz`, the status pages, the flows page and API, and an ingest guarded by `FACTORY_PUSH_TOKEN`, and its image holds only the seven files named in `Dockerfile`. A launchd job on the Mac, `com.victor.factory-flows-push`, runs `factory push` every minute for `game-studio` and `tools`, and it alone sends the status pages. The Mac reads its token from the keychain item `factory-push`. Jobfeed runs on Bumblebee, so Bumblebee pushes `job-applier` itself with `--flows-only`, from a checkout at `~/services/factory-flows-push`, on the user systemd timer `factory-flows-push.timer`. Its token is in `~/.config/factory/push.env`. Each source has one pusher, because a second one that can't read the source would replace its runs with an error. `factory/lib/public-flows.mjs` decides what may be seen, and both the pusher and the ingest route go through it. It copies named fields into new objects, allows only the `game-studio`, `job-applier`, and `tools` sources, and rejects a blob that holds a path, an email, a URL, an IP address, or a token. A job is status only. Its title, company, and step names are replaced by its number, role, and category, because those words come from Jobfeed and can name an employer. If Jobfeed can't be read, the public card shows a generic error and no runs. Cost, `where`, and notes never leave the Mac. The `meta` field does not either, but a Game Studio trace's subtitle includes its value, which is a runtime or a feature name. `factory push --scan --sources game-studio,job-applier,tools` shows what would go out and sends nothing. A source with no push for five minutes reads as stalled, and the page says when it went offline. Raise `SHAPE_VERSION` when shaping changes, so finished traces go out again. To deploy it, run `node factory/bin/deploy-flows.mjs`. The script uploads only the files that `Dockerfile` copies and waits for the deployment to succeed. The Dockerfile build and the `/healthz` healthcheck are settings on the Railway service, so the repo needs no Railway config file. The same server draws the status pages from the same `index.html` as the local dashboard, from a snapshot that `factory push` sends. `shapeStatus` drops spend, the data home, links, doctor notes, parameter example URLs, and every `external.json` entry outside its list, so Job Applier stays off the status pages. On the public site, Try has a GitHub link where the local page has its run button, and the server has no `/run` route.

## Design alternatives considered

| Candidate | Why not |
|---|---|
| One repo per microservice | The dashboard needs every manifest and log in one place. Versioning between repos has no consumer when one person owns every caller. |
| One process with microservices as plugins | Forces one language. One crash takes every microservice down. |
| Flat services with recipes on the side | The previous version of this document. It led with machinery and treated the microservices Victor uses as an afterthought. |
| **Microservices made of atoms, in one repo, run by a generic factory** | Chosen. |

---

# Part 2. Example: the YouTube microservice

## What it does

`youtube <url | search words | playlist>` returns a summary with chapters, plus the full transcript. `--visual` adds notes on what appears on screen. Victor runs it in a terminal. Claude Code uses it through its skill.

## The atoms it uses

| Atom | Kind | Takes | Returns | Reuses |
|---|---|---|---|---|
| `find-url` | observe | Search words, channel, or playlist | `url-list` | yt-dlp search and playlist listing |
| `captions` | transform | Video URL | `transcript`, or the error `no_captions` or `rate_limited` | yt-dlp subtitles |
| `download` | transform | Video URL | `media`, a local audio or video file | yt-dlp |
| `transcribe` | transform | Audio or video file | `transcript` | faster-whisper |
| `frames` | transform | Video file | `frame-set`, key frames with timestamps | ffmpeg scene detection |
| `see` | model | Images | `image-notes`, a description and visible text per image | The kit's model adapter |
| `digest` | model | Transcript, optional image notes | `digest`, a summary, chapters, key points | The kit's model adapter |

None of these atoms knows about YouTube. yt-dlp supported 1,731 sites on 2026-10-19, and YouTube is one of them.

## The flow

```
youtube <input> [--visual] [--no-digest]
  input is not a video URL     find-url -> video URLs
  for each video:
    captions get               -> transcript
      on no_captions or rate_limited  download --audio -> transcribe file -> transcript
    with --visual              download --video -> frames -> see -> image notes
    unless --no-digest         digest make -> digest
  print the digest, with the transcript path inside
```

The skill form runs the same steps up to the transcript and image notes. Then the agent reads them and summarizes, so no `digest` call is made.

## The same atoms in other microservices

| Atom | `youtube` | `meeting-notes` | `podcast` | `desktop` |
|---|---|---|---|---|
| `find-url` | yes | | yes | |
| `captions` | yes | | | |
| `download` | yes | | yes | |
| `transcribe` | yes | yes | yes | |
| `frames` | with `--visual` | | | |
| `see` | with `--visual` | | | yes |
| `digest` | yes | yes | yes | |
| `screenshot` | | | | yes, observe |
| `click`, `type` | | | | yes, act |

`meeting-notes` runs `transcribe` and `digest` on a local recording. `podcast` finds episodes, downloads them, transcribes, and digests. `desktop` is the computer-use microservice. It is a skill-form microservice only, because deciding what to click is the agent's job. It comes last, since this app already gives agents computer use. It earns its place only when a script needs to see the screen.

## Where its code lives

```
microservices/youtube/
  manifest.json
  SKILL.md
  run
  test/
atoms/find-url/  atoms/captions/  atoms/download/  atoms/transcribe/  atoms/frames/
atoms/see/
  prompts/see.md
atoms/digest/
  prompts/digest.md
contracts/
  url-list  media  transcript  frame-set  image-notes  digest    (.schema.json)

~/.local/share/tool-factory/
  download/files/<site>-<id>.<ext>
  captions/cache/  transcribe/cache/  frames/<file-hash>/  see/cache/  digest/cache/
  runs.jsonl  links.json  budget.json
```

## Manifests

`microservices/youtube/manifest.json`:

```json
{
  "name": "youtube",
  "type": "microservice",
  "kind": "pipeline",
  "description": "Summary, chapters, and transcript of a YouTube video, search, or playlist. Optional notes on what appears on screen.",
  "status": "alpha",
  "runtime": "uv",
  "entry": "run",
  "contract": "digest",
  "uses": ["find-url", "captions", "download", "transcribe", "frames", "see", "digest"],
  "verbs": [
    {
      "name": "get",
      "description": "Digest for each video the input resolves to.",
      "input": {
        "type": "object",
        "properties": {
          "input": { "type": "string" },
          "visual": { "type": "boolean" },
          "digest": { "type": "boolean" }
        },
        "required": ["input"]
      },
      "output": "digest"
    }
  ],
  "needs": { "bin": [], "secrets": [], "paid": [] },
  "adapters": ["cli", "skill", "mcp"]
}
```

`atoms/digest/manifest.json`:

```json
{
  "name": "digest",
  "type": "atom",
  "kind": "model",
  "description": "Summary, chapters with timestamps, and key points from a transcript, optionally with image notes.",
  "status": "alpha",
  "runtime": "uv",
  "entry": "bin/digest",
  "contract": "digest",
  "model": { "backend": "claude-cli", "default": "sonnet", "prompt": "prompts/digest.md" },
  "verbs": [
    {
      "name": "make",
      "description": "Digest one transcript. Cached by transcript hash, model, and prompt hash.",
      "input": {
        "type": "object",
        "properties": {
          "transcript": { "type": "string" },
          "imageNotes": { "type": "string" },
          "length": { "enum": ["short", "long"] }
        },
        "required": ["transcript"]
      },
      "output": "digest"
    }
  ],
  "needs": { "bin": ["claude"], "secrets": [], "paid": ["claude"] },
  "adapters": ["cli", "skill", "mcp"]
}
```

## Build order

Usable first, machinery second. Each step ends in a check that runs before the next starts.

1. **PR 1, the transcript half.** Atoms `captions`, `download`, and `transcribe`. The kit's `cli`, `paths`, `cache`, and `hash` are born here, since three atoms need them. Time faster-whisper against whisper.cpp and record the choice. Check that each atom passes its literal fixture test.
2. **PR 2, the YouTube microservice, usable.** Atom `digest` with the model adapter inline, plus `microservices/youtube` in both forms. Link the skill globally by hand. Check one video with captions and one without, end to end, and check that a second run is served from cache.
3. **PR 3, search and visual.** Atoms `find-url`, `frames`, and `see`. The model adapter moves into the kit, since `see` is the second model atom. Check `youtube --visual` on one video and `youtube "<search words>"` on one query.
4. **PR 4, the factory.** Manifest loading, `list`, `doctor`, `test` with the kind and dependency rules, `run`, the run log, the budget, `link`, and `mcp`. Check that a planted cross-atom import fails the test, and that Claude chat calls the microservice over MCP.
5. **PR 5, more microservices from the same atoms.** `meeting-notes`, `podcast`, and one skill-only microservice from the research briefs. Check that each new pipeline microservice needs no new atom code.
6. **PR 6, dashboard.** Check that it shows microservices, atoms with "used by", spend, and the external microservices.
7. **Later, only on demand.** `desktop` with `screenshot`, `click`, and `type`, and the confirmation hook for `act` atoms.

## Decisions still open

- **Whisper backend.** PR 1 decides with measured numbers. faster-whisper 1.2.1 needs PyAV pinned below 19. With that pin it transcribed a test clip with no system ffmpeg, checked 2026-10-25.
- **Default model per model atom.** `digest` starts on `sonnet` and `see` on `haiku`. Both are guesses to revisit once the run log shows cost and quality.
- **Daily budget.** None by default, by Victor's choice. `TOOL_FACTORY_BUDGET_USD` adds one. Each call has no ceiling either, unless `TOOL_FACTORY_CALL_BUDGET_USD` sets one.
- **yt-dlp goes stale.** It stays unpinned, and `doctor` reports its age.
- **YouTube may refuse this network.** Captions downloaded fine on 2026-10-25. PR 1 shows whether audio downloads work too.
- **The data home grows.** Add a prune command when it first matters.
