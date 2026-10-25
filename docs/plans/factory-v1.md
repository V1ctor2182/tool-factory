# Tool factory v1 plan

Build the YouTube tool and the factory that manages it, as six stacked PRs on `main`.
Victor gets a usable `youtube` command and skill by F2, then the factory, more tools, and a dashboard.
The rule this program enforces is the one in `ARCHITECTURE.md`. Tools chain atoms through CLIs, atoms import only the kit, and an atom's kind decides caching, tests, cost, and guards.
PR ids in order are F1, F2, F3, F4, F5, F6.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a capture, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `~/.claude/skills/poteto-mode/playbooks/autopilot-stack.md`, per the host mapping that puts pstack playbooks under `~/.claude/skills/`. Owners stop at STACK-READY. The root appends each verified PR to the base-branch stack. Victor lands the stack bottom-up. F2 and F6 are review-gated and wait for Victor in chat.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] Confirm `docs/plans/factory-v1.md` and `ARCHITECTURE.md` are on `origin/main`, which means PR 1 merged. If not, stop and tell Victor the program needs that merge first.
- [ ] State the protocol and this plan to Victor, then stop. Start execution only on Victor's explicit go.
- [ ] On Victor's go, arm a `/goal` with this exact text. "Run docs/plans/factory-v1.md under autopilot-stack. PRs F1 to F6 in order, each stacked on the one before. A PR is verified only when its unit, live, and perf boxes are all checked. Owners stop at STACK-READY. Victor lands the stack. Done when F1 to F6 are STACK-READY with every box checked, or when a dead end needs Victor."
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:docs/plans/factory-v1.md`
  - [ ] `git show origin/main:ARCHITECTURE.md`
  - [ ] `git show origin/main:CLAUDE.md`
  - [ ] `~/.claude/skills/poteto-mode/playbooks/autopilot-stack.md` and `autopilot-full.md`
  - [ ] `~/.claude/skills/swarm/SKILL.md`
  - [ ] `~/.claude/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `~/.claude/skills/show-me-your-work/SKILL.md`
- [ ] Arm the audit tick with `/loop 1h` in this terminal session. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook and the armed /goal. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to Victor in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a STACK-READY, a stuck agent and the action taken, a blocker added or cleared, or a decision only Victor can make. Name every such change and nothing else. If the audit found none, end the turn with no reply text. Either way, log this tick's row in the decision trail. The row names the items reported, or none."
- [ ] On Victor's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with `subagent_type` set to `poteto-agent`, each in its own git worktree, with the full lifecycle autopilot-stack names.
- [ ] Follow this dependency graph. Each PR branches from the branch of the PR before it.
  - [ ] F1 branches from `main`.
  - [ ] F2 after F1. F3 after F2. F4 after F3. F5 after F4. F6 after F5.
- [ ] Hold the file boundaries.
  - [ ] F1 touches only `atoms/captions/`, `atoms/download/`, `atoms/transcribe/`, `kit/py/`, `contracts/`, `docs/decisions/`, and the move of `research/` to `docs/research/`.
  - [ ] F2 touches only `atoms/digest/`, `tools/youtube/`, `contracts/digest.schema.json`, and `kit/py/` for run-log fixes.
  - [ ] F3 touches only `atoms/find-url/`, `atoms/frames/`, `atoms/see/`, `atoms/digest/`, `kit/py/`, `contracts/`, and `tools/youtube/`.
  - [ ] F4 touches only `factory/`, `.claude/settings.json`, `contracts/service.schema.json`, and manifest fixes under `atoms/` and `tools/`.
  - [ ] F5 touches only `tools/` and must not change any file under `atoms/`.
  - [ ] F6 touches only `factory/dashboard/`, `factory/lib/`, and `external.json`.
- [ ] Hold the review gate. F2 and F6 change an interaction. They wait for Victor's review in chat with captures, screenshots, and a video before the root appends them.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Use `gh`, since `command -v origin` finds nothing on this Mac. Record that fallback in the decision trail.
- [ ] Open the PR ready, never draft, with `gh pr create --base <parent-branch>`. F1 targets `main`.
- [ ] Run every atom's `test/test.sh` once before the PR-facing push. From F4 on, run `node factory/bin/factory.mjs test` instead. Push with hooks on.
- [ ] Run `/simplify` over the diff before each commit, the host's stand-in for `/deslop`. Keep comments only for a non-obvious why.
- [ ] Write titles, bodies, and commit messages per `/technical-writing`, then `/unslop`. Titles follow `type(scope): subject`.
- [ ] This repo has no Bugbot or security reviewer. If a review comment appears, triage it per `~/.claude/skills/poteto-mode/references/bugbot-triage.md`.
- [ ] Rebase onto the parent branch's current tip before the code-ready report. Rebase again only at landing prep or on a conflict.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head, per `~/.claude/skills/swarm/SKILL.md`. One gates lane, the ten live lanes from the PR's **Verify, live** block, the perf lane from its **Verify, perf** block, and two audit lanes that read the diff and the captures and distrust the PR body. One audit lane checks the dependency rules in `ARCHITECTURE.md`. The other checks the kinds table.
- [ ] A rebase, a conflict fix, or a minor fix gets a single verifier at the new head. New behavior gets a fresh full swarm.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect a lane filed as a note.
- [ ] On a clean verdict the root appends the PR to the stack and marks it STACK-READY. Results stay valid across a rebase only when the patch-id is unchanged, per `~/.claude/skills/poteto-mode/playbooks/shipping.md`.

### Boot recipe, for every live lane

This Mac has no cloud VMs. Each live lane runs in its own git worktree on this Mac, with its own data home so lanes never share caches. CLI lanes drive the surface through Bash, the host's stand-in for `control-cli`. F6 lanes drive the dashboard through the built-in browser.

- [ ] `git worktree add /private/tmp/lanes/<pr-id>-<n> <head SHA>`.
- [ ] `export TOOL_FACTORY_HOME=/private/tmp/lanes/<pr-id>-<n>/home`. Model weights in `~/.cache/huggingface/` stay shared, since they are read-only.
- [ ] Run each atom or tool through its CLI only, with `--json`. Read-only diagnostics are `cat`, `jq`, `ls`, and `git status`.
- [ ] Save every capture to `/private/tmp/swarm-<pr-id>/worker-<n>/<slug>` and return the paths with the report. CLI lanes save stdout, stderr, and the exit code as `.txt`. F6 lanes save `.png`.
- [ ] Remove the worktree when the lane ends.

## Build the transcript atoms and the kit (F1)

**Depends on.** None. Branches from `main` after PR 1 merges.

**Files.**

- [ ] Create `contracts/transcript.schema.json` and `contracts/media.schema.json`.
- [ ] Create `atoms/captions/` with `manifest.json`, `SKILL.md`, `bin/captions`, `src/captions.py`, and `test/`.
- [ ] Create `atoms/download/` with the same layout.
- [ ] Create `atoms/transcribe/` with the same layout, plus `test/fixtures/hello.aiff`, `test/expected/hello.json`, and `test/expected/hello.srt`.
- [ ] Create `kit/py/pyproject.toml` and `kit/py/src/factory_kit/` with `cli.py`, `paths.py`, `cache.py`, `hash.py`, and `runs.py`.
- [ ] Create `docs/decisions/0001-whisper-backend.md`.
- [ ] Move `research/` to `docs/research/` and fix the README links.

**Build.**

- [ ] Define the `Transcript` and `Media` shapes as JSON Schemas first. Every later box returns one of them.
- [ ] Write `factory_kit.cli` so every atom prints one JSON object or `{"error": {"code", "message"}}`, exits 0 or 1, and appends one line to `runs.jsonl`.
- [ ] Write `factory_kit.cache` with a temp file and rename, so a killed run leaves no partial entry.
- [ ] Write `captions get <url>` on yt-dlp's Python API with `json3` subtitles. Return `no_captions` when none exist.
- [ ] Write `download get <url> --audio|--video` on yt-dlp. Cache files by extractor and id.
- [ ] Write `transcribe file <path>` and `transcribe srt <path>` on faster-whisper with `av<19` pinned. Cache by file hash, model, and language.
- [ ] Time faster-whisper against whisper.cpp on the ten-minute fixture and record the choice and numbers in the decision file.

**You see.**

- [ ] `atoms/transcribe/bin/transcribe file atoms/transcribe/test/fixtures/hello.aiff --json` prints a transcript whose text is `Hello from the tool factory.`
- [ ] `atoms/captions/bin/captions get https://www.youtube.com/watch?v=jNQXAC9IVRw --json` prints a transcript with `method` set to `captions`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `atoms/transcribe/test/test.sh` asserts the fixture text, normalized to lowercase without punctuation, equals `hello from the tool factory`, and the SRT equals `test/expected/hello.srt` byte for byte. Run `sh atoms/transcribe/test/test.sh`.
- [ ] `atoms/captions/test/test.sh` validates a recorded `json3` fixture's normalized output against `transcript.schema.json` and a literal first segment. Run `sh atoms/captions/test/test.sh`.
- [ ] `atoms/download/test/test.sh` asserts a second call returns `cacheHit` true and the same path. Run `sh atoms/download/test/test.sh`.
- [ ] `kit/py/test/test_cache.py` asserts a write interrupted before rename leaves no entry. Run `uv run --with pytest pytest kit/py/test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk has no atoms, so record that and gate the end state. Run `transcribe file` on the fixture at the head. Save `f1-l1-regression.txt`. Pass when the normalized text equals `hello from the tool factory` and exit is 0.
- [ ] Lane 2. Run `captions get` on `jNQXAC9IVRw`. Save `f1-l2-captions.txt`. Pass when `method` is `captions`, at least one segment exists, and the output validates against the schema.
- [ ] Lane 3. Run `captions get` on a public video with no captions, chosen by the owner and recorded in `atoms/captions/test/README.md`. Save `f1-l3-no-captions.txt`. Pass when the error code is `no_captions` and exit is 1.
- [ ] Lane 4. Run `captions get not-a-url`. Save `f1-l4-invalid.txt`. Pass when the error code is `invalid_source`, exit is 1, and stdout holds no traceback.
- [ ] Lane 5. Run `download get` on `jNQXAC9IVRw --audio` twice. Save `f1-l5-download.txt`. Pass when the file exists, its duration is within one second of 19 seconds, and the second call reports `cacheHit` true.
- [ ] Lane 6. Run `transcribe file` on the fixture with `PATH=/usr/bin:/bin` plus the uv path. Save `f1-l6-no-ffmpeg.txt`. Pass when the text matches and `which ffmpeg` prints nothing in that shell.
- [ ] Lane 7. Run `transcribe srt` on the fixture. Save `f1-l7-srt.txt`. Pass when `diff` against `test/expected/hello.srt` is empty.
- [ ] Lane 8. Start `transcribe file` on the ten-minute fixture, kill it after two seconds, then rerun. Save `f1-l8-crash.txt`. Pass when the rerun exits 0 and the cache holds exactly one entry for that file.
- [ ] Lane 9. Run all three atoms, then `git status --porcelain` in the worktree. Save `f1-l9-clean-repo.txt`. Pass when git reports nothing and every output sits under `TOOL_FACTORY_HOME`.
- [ ] Lane 10. Run `captions get` with `HTTPS_PROXY=http://127.0.0.1:9`. Save `f1-l10-offline.txt`. Pass when the error code is `network_error`, exit is 1, and no partial cache entry exists.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Trunk has no atoms. Measure two diff-added costs. One is wall time of `transcribe file` on the ten-minute fixture made with `say -f ARCHITECTURE.md`. The other is wall time of a cached rerun.
- [ ] Probe. `/usr/bin/time -p` around each command, three runs each, interleaving the two backends for the decision file.
- [ ] Baseline. Record that trunk lacks the feature, then record the first cold run of the small model at the head.
- [ ] Rule. Fail when the cold run of the chosen backend exceeds 300 seconds or a cached rerun exceeds 1 second. Both budgets are guesses set before measurement.

**Review gate.** None. F1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review comment triage done, or none arrived.
- [ ] Rebased onto `main` after the verdict, patch-id unchanged.
- [ ] Root appends F1 to the stack as its base. Victor lands it.

## Make the YouTube tool usable (F2)

**Depends on.** F1.

**Files.**

- [ ] Create `contracts/digest.schema.json`.
- [ ] Create `atoms/digest/` with `manifest.json`, `SKILL.md`, `bin/digest`, `src/digest.py`, `prompts/digest.md`, and `test/`.
- [ ] Create `tools/youtube/` with `manifest.json`, `SKILL.md`, `run`, and `test/`.
- [ ] Edit `kit/py/src/factory_kit/runs.py` to add `costUsd` and `caller`.

**Build.**

- [ ] Write `digest make --transcript <path>` with the model call inline, using `claude -p --output-format json --json-schema` and the `sonnet` model. Read `total_cost_usd` into the run log.
- [ ] Enforce the daily budget inside `digest` by summing today's `costUsd` from `runs.jsonl`. Default $3, overridden by `TOOL_FACTORY_BUDGET_USD`. Refuse with `budget_exceeded`.
- [ ] Cache digests by transcript hash, model, and prompt hash.
- [ ] Write `tools/youtube/run` that calls `captions`, falls back to `download --audio` then `transcribe` only on `no_captions`, then calls `digest`. It honors `--no-digest`.
- [ ] Write `tools/youtube/SKILL.md` so an agent calls the atoms up to the transcript and summarizes it itself.

**You see.**

- [ ] `tools/youtube/run https://www.youtube.com/watch?v=jNQXAC9IVRw` prints a digest with `summary`, `chapters`, and a `transcriptPath` that exists.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `atoms/digest/test/test.sh` runs `digest` on a fixture transcript of a known paragraph. It asserts schema validity and that the summary mentions both `atoms` and `tools`. Run `sh atoms/digest/test/test.sh`.
- [ ] `tools/youtube/test/test.sh` runs the tool with `--no-digest` on the captions fixture URL. It asserts the transcript schema and zero model cost in the run log. Run `sh tools/youtube/test/test.sh`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `captions get` on `jNQXAC9IVRw` at the F1 tip and at the head. Save `f2-l1-regression.txt`. Pass when both outputs are identical apart from `cacheHit`.
- [ ] Lane 2. Run `tools/youtube/run` on `jNQXAC9IVRw`. Save `f2-l2-captions-path.txt`. Pass when the digest validates and its transcript has `method` set to `captions`.
- [ ] Lane 3. Run the tool on the no-captions video from F1 lane 3. Save `f2-l3-whisper-path.txt`. Pass when the digest validates and its transcript has `method` set to `whisper`.
- [ ] Lane 4. Rerun lane 2. Save `f2-l4-cached.txt`. Pass when every atom line in the run log reports `cacheHit` true and wall time is under 2 seconds.
- [ ] Lane 5. Run the tool with `--no-digest`. Save `f2-l5-no-digest.txt`. Pass when it prints a transcript and the run log holds no `digest` line.
- [ ] Lane 6. Run `digest make` on the F1 fixture transcript. Save `f2-l6-digest.txt`. Pass when the summary names the tool factory.
- [ ] Lane 7. Run `digest make` with `TOOL_FACTORY_BUDGET_USD=0.0001` after one paid call. Save `f2-l7-budget.txt`. Pass when the error code is `budget_exceeded` and no model call ran.
- [ ] Lane 8. In a scratch project with `.claude/skills/youtube` linked to `tools/youtube`, run `claude -p "Summarize https://www.youtube.com/watch?v=jNQXAC9IVRw using the youtube skill"`. Save `f2-l8-skill-form.txt`. Pass when the run log shows `captions` called and no `digest` call, and the reply summarizes the video.
- [ ] Lane 9. Run the tool on `not-a-url`. Save `f2-l9-invalid.txt`. Pass when the error code is `invalid_source` and exit is 1.
- [ ] Lane 10. Read the run log after lane 2. Save `f2-l10-cost.txt`. Pass when the `digest` line has `costUsd` above zero and `caller` set to `youtube`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Trunk lacks the tool. Measure end-to-end wall time and model cost of `tools/youtube/run` on `jNQXAC9IVRw`, cold and cached.
- [ ] Probe. `/usr/bin/time -p` around the tool, three cold runs with a fresh data home each, interleaved with three cached runs.
- [ ] Baseline. Record that trunk lacks the tool, then record the `captions get` time at the F1 tip as the floor.
- [ ] Rule. Fail when a cold run exceeds 60 seconds, a cached run exceeds 2 seconds, or one digest costs more than $0.10. All three budgets are guesses.

**Review gate.** Victor reviews before the root appends F2.

- [ ] Copy the lane 2, 3, and 8 captures into `docs/plans/media/f2-review-<slug>.txt`, plus a terminal screenshot of lane 2 as `f2-review-terminal.png`.
- [ ] Record a 30 to 60 second screen video of `youtube` running on one video. Save it as `docs/plans/media/f2-review.mp4`.
- [ ] Post the captures, the screenshot, and the video in chat. Stop at STACK-READY. Wait for the operator, Victor, to approve.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Victor's review approval in chat.
- [ ] Rebased onto the F1 tip after the verdict, patch-id unchanged.
- [ ] Root appends F2 to the stack. Victor lands it after F1.

## Add search and visual notes (F3)

**Depends on.** F2.

**Files.**

- [ ] Create `contracts/url-list.schema.json`, `contracts/frame-set.schema.json`, and `contracts/image-notes.schema.json`.
- [ ] Create `atoms/find-url/`, `atoms/frames/`, and `atoms/see/` with the standard layout. `see` adds `prompts/see.md`.
- [ ] Create `kit/py/src/factory_kit/model.py`.
- [ ] Edit `atoms/digest/src/digest.py` to use the kit's model adapter.
- [ ] Edit `tools/youtube/run`, `tools/youtube/manifest.json`, and `tools/youtube/SKILL.md` for search input and `--visual`.

**Build.**

- [ ] Move the model call and the budget check from `digest` into `factory_kit.model`, since `see` is the second model atom.
- [ ] Write `find-url search <words> --limit <n>` and `find-url list <playlist or channel>` on yt-dlp. Kind `observe`, so never cached.
- [ ] Write `frames get <video>` with ffmpeg scene detection. Cache by file hash and threshold.
- [ ] Write `see describe <images...>` through the kit adapter on `haiku`. Cache by image hash, model, and prompt hash.
- [ ] Extend the tool so non-URL input goes through `find-url`, and `--visual` adds `download --video`, `frames`, and `see`, then passes image notes to `digest`.

**You see.**

- [ ] `tools/youtube/run --visual https://www.youtube.com/watch?v=jNQXAC9IVRw` prints a digest whose `visual` field holds notes from at least one frame.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `atoms/frames/test/test.sh` runs on a generated test video from `ffmpeg -f lavfi` with two color scenes and asserts exactly two frames at literal timestamps. Run `sh atoms/frames/test/test.sh`.
- [ ] `atoms/see/test/test.sh` runs on a generated image that shows the text `FACTORY` and asserts the notes include `FACTORY`. Run `sh atoms/see/test/test.sh`.
- [ ] `atoms/find-url/test/test.sh` normalizes a recorded yt-dlp search result and asserts the url-list schema. Run `sh atoms/find-url/test/test.sh`.
- [ ] `kit/py/test/test_model.py` asserts the adapter refuses past budget with a stubbed backend. Run `uv run --with pytest pytest kit/py/test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `digest make` on the F1 fixture transcript at the F2 tip and at the head. Save `f3-l1-regression.txt`. Pass when both validate against the digest schema and both mention the tool factory.
- [ ] Lane 2. Run `find-url search "me at the zoo" --limit 3`. Save `f3-l2-search.txt`. Pass when it returns three distinct video URLs.
- [ ] Lane 3. Run `find-url list` on a public playlist the owner records. Save `f3-l3-playlist.txt`. Pass when the count equals the playlist length shown by `yt-dlp --flat-playlist`.
- [ ] Lane 4. Run `tools/youtube/run "me at the zoo" --limit 2`. Save `f3-l4-search-tool.txt`. Pass when it prints two digests.
- [ ] Lane 5. Run `frames get` twice on the downloaded `jNQXAC9IVRw` video. Save `f3-l5-frames.txt`. Pass when at least one frame exists with a timestamp and the second call reports `cacheHit` true.
- [ ] Lane 6. Run `see describe` on one frame from lane 5. Save `f3-l6-see.txt`. Pass when the notes are non-empty, validate, and the run log line has `costUsd` above zero.
- [ ] Lane 7. Run `tools/youtube/run --visual` on `jNQXAC9IVRw`. Save `f3-l7-visual.txt`. Pass when the digest's `visual` field is non-empty.
- [ ] Lane 8. Run `grep -rn "claude -p" atoms/`. Save `f3-l8-one-adapter.txt`. Pass when nothing matches outside `kit/py`.
- [ ] Lane 9. Run `find-url search` twice in a row. Save `f3-l9-observe.txt`. Pass when both calls report `cacheHit` false.
- [ ] Lane 10. Set the budget just above today's spend, then run `see describe` and `digest make`. Save `f3-l10-shared-budget.txt`. Pass when the second call fails with `budget_exceeded`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time and model cost of `tools/youtube/run` on `jNQXAC9IVRw` without `--visual` at trunk and head, plus the diff-added cost of `--visual` at the head.
- [ ] Probe. `/usr/bin/time -p`, three runs each side with a fresh data home, interleaved trunk and head.
- [ ] Baseline. Record the F2 tip's non-visual time and cost first.
- [ ] Rule. Fail when the head's non-visual time exceeds the F2 tip by more than 20 percent, or a `--visual` run exceeds 180 seconds or $0.50. The visual budgets are guesses.

**Review gate.** None. F3 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review comment triage done, or none arrived.
- [ ] Rebased onto the F2 tip after the verdict, patch-id unchanged.
- [ ] Root appends F3 to the stack. Victor lands it after F2.

## Build the factory core (F4)

**Depends on.** F3.

**Files.**

- [ ] Create `factory/bin/factory.mjs`.
- [ ] Create `factory/lib/manifest.mjs`, `registry.mjs`, `doctor.mjs`, `rules.mjs`, `runs.mjs`, `links.mjs`, and `mcp.mjs`.
- [ ] Create `contracts/service.schema.json` for `manifest.json`.
- [ ] Create `.claude/settings.json` with a `PreToolUse` budget hook and `factory/hooks/budget.mjs`.
- [ ] Edit manifests under `atoms/` and `tools/` only where validation finds a gap.

**Build.**

- [ ] Load and validate every `manifest.json` into one registry keyed by name, with `type` and `kind` from the kinds table in one lookup.
- [ ] Write `list`, `doctor`, `run`, and `test`. `test` runs every `test/test.sh` and the rules in `rules.mjs`.
- [ ] Encode the dependency table and the kinds table as checks in `rules.mjs`. These cover cross-atom imports, tool calls outside `uses`, undeclared binaries, and caching that contradicts the kind.
- [ ] Write `link` and `unlink` with `--into`, `--global`, and `--bin`, recording each link in `links.json`. `FACTORY_BIN_DIR` and `FACTORY_SKILLS_DIR` override targets for tests.
- [ ] Write `mcp <names...>` as a stdio MCP server with one tool per verb. Input schemas come straight from the manifests. Each call spawns the CLI.
- [ ] Write the budget hook so a Bash call to a model atom is blocked when today's spend is at the cap.

**You see.**

- [ ] `node factory/bin/factory.mjs list` prints one row per atom and tool with its type and kind.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `factory/test/rules.test.mjs` plants a cross-atom import and an undeclared binary in temp copies and asserts both fail with literal messages. Run `node --test factory/test`.
- [ ] `factory/test/mcp.test.mjs` sends `initialize` and `tools/list` over stdio and asserts the tool names and input schemas equal the manifests. Run `node --test factory/test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run every `test/test.sh` at the F3 tip and at the head. Save `f4-l1-regression.txt`. Pass when both pass and `factory test` passes at the head.
- [ ] Lane 2. Run `factory list` and `factory run transcribe file` on the fixture. Save `f4-l2-list-run.txt`. Pass when the list shows seven atoms and one tool and `run` matches the direct CLI output.
- [ ] Lane 3. Run `factory doctor`, then rerun with `PATH` lacking ffmpeg. Save `f4-l3-doctor.txt`. Pass when the first is green and the second marks `frames` red naming `ffmpeg`.
- [ ] Lane 4. Plant `import captions` in a temp copy of `atoms/digest/src/digest.py` and run `factory test`. Save `f4-l4-planted-import.txt`. Pass when it fails naming that file and rule.
- [ ] Lane 5. Remove `ffmpeg` from the `frames` manifest in a temp copy and run `factory test`. Save `f4-l5-undeclared.txt`. Pass when it fails naming the binary.
- [ ] Lane 6. Run `factory link youtube --into` a scratch project, then `unlink`. Save `f4-l6-link.txt`. Pass when the symlink and the `links.json` entry appear, then both disappear.
- [ ] Lane 7. Run `factory link youtube --bin` with `FACTORY_BIN_DIR` set to a temp dir, then call `youtube --no-digest` from there. Save `f4-l7-bin.txt`. Pass when the call returns a transcript.
- [ ] Lane 8. Start `factory mcp youtube transcribe` and send `tools/list`. Save `f4-l8-mcp-list.txt`. Pass when the tools and their input schemas match the manifests.
- [ ] Lane 9. Send `tools/call` for `youtube` on `jNQXAC9IVRw`. Save `f4-l9-mcp-call.txt`. Pass when a digest returns and the run log line has `caller` set to `mcp`.
- [ ] Lane 10. Feed the budget hook a `PreToolUse` payload for `digest make` with spend at the cap. Save `f4-l10-hook.txt`. Pass when the hook exits 2 with a message naming the cap.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Trunk lacks the factory. Measure `factory list` wall time and the overhead of an MCP `tools/call` against the direct CLI on the cached `transcribe` fixture.
- [ ] Probe. `hyperfine`, or ten `/usr/bin/time -p` runs when it is missing, interleaving direct CLI and MCP calls.
- [ ] Baseline. Record the direct CLI time at the head as the floor, since trunk has no factory.
- [ ] Rule. Fail when `factory list` exceeds 500 milliseconds or MCP adds more than 300 milliseconds over the direct CLI. Both budgets are guesses.

**Review gate.** None. F4 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review comment triage done, or none arrived.
- [ ] Rebased onto the F3 tip after the verdict, patch-id unchanged.
- [ ] Root appends F4 to the stack. Victor lands it after F3.

## Add tools from the same atoms (F5)

**Depends on.** F4.

**Files.**

- [ ] Create `tools/meeting-notes/` with `manifest.json`, `SKILL.md`, `run`, and `test/`.
- [ ] Create `tools/podcast/` with the same layout.
- [ ] Create `tools/writing-style/` with `manifest.json` and `SKILL.md`, drawn from `docs/research/skills.md`.

**Build.**

- [ ] Write `meeting-notes <file>` as `transcribe` then `digest`.
- [ ] Write `podcast <episode URL or search words>` as `find-url`, `download --audio`, `transcribe`, then `digest`.
- [ ] Write `writing-style` as a skill-only tool with `kind` set to `skill`.

**You see.**

- [ ] `node factory/bin/factory.mjs list` shows four tools, and `git diff <F4 tip> -- atoms/` prints nothing.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tools/meeting-notes/test/test.sh` runs the tool on the transcribe fixture and asserts the digest schema. Run `node factory/bin/factory.mjs test`.
- [ ] `factory test` asserts each new tool's `uses` matches the CLIs its `run` calls. Run `node factory/bin/factory.mjs test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `youtube` on `jNQXAC9IVRw` at the F4 tip and at the head. Save `f5-l1-regression.txt`. Pass when both digests validate and the transcripts are identical.
- [ ] Lane 2. Run `meeting-notes` on a two-minute recording made with `say -f`. Save `f5-l2-meeting.txt`. Pass when the digest validates and its chapters cover the recording.
- [ ] Lane 3. Run `podcast` on one public episode URL the owner records. Save `f5-l3-podcast.txt`. Pass when the digest validates.
- [ ] Lane 4. Run `git diff <F4 tip> -- atoms/`. Save `f5-l4-no-atom-code.txt`. Pass when the diff is empty.
- [ ] Lane 5. Link `writing-style` into a scratch project and run `claude -p "Which skills can you use here?"`. Save `f5-l5-skill-only.txt`. Pass when the reply names writing-style.
- [ ] Lane 6. Run `factory test`. Save `f5-l6-rules.txt`. Pass when every rule and test passes.
- [ ] Lane 7. In a scratch project with `meeting-notes` linked, ask `claude -p` to summarize the lane 2 recording. Save `f5-l7-skill-form.txt`. Pass when the run log shows `transcribe` and no `digest` call.
- [ ] Lane 8. Run `factory doctor`. Save `f5-l8-doctor.txt`. Pass when all four tools are green.
- [ ] Lane 9. Run `youtube --visual` on `jNQXAC9IVRw`. Save `f5-l9-visual.txt`. Pass when the `visual` field is non-empty.
- [ ] Lane 10. Read the run log after lanes 2 and 3. Save `f5-l10-callers.txt`. Pass when each atom line names the right tool in `caller`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `youtube` end-to-end time on `jNQXAC9IVRw` at trunk and head, plus the diff-added `meeting-notes` time on the two-minute recording.
- [ ] Probe. `/usr/bin/time -p`, three runs each side with a fresh data home, interleaved.
- [ ] Baseline. Record the F4 tip's `youtube` time first.
- [ ] Rule. Fail when the head's `youtube` time exceeds the F4 tip by more than 10 percent, or `meeting-notes` on two minutes exceeds 90 seconds. The second budget is a guess.

**Review gate.** None. F5 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Review comment triage done, or none arrived.
- [ ] Rebased onto the F4 tip after the verdict, patch-id unchanged.
- [ ] Root appends F5 to the stack. Victor lands it after F4.

## Build the dashboard (F6)

**Depends on.** F5.

**Files.**

- [ ] Create `factory/dashboard/server.mjs` and `factory/dashboard/index.html`.
- [ ] Create `external.json` with art-desk and vh-personal.
- [ ] Edit `factory/bin/factory.mjs` to add `status` and `dashboard`.
- [ ] Edit `factory/lib/runs.mjs` for the dashboard's queries.

**Build.**

- [ ] Write one status model that `status` prints and the dashboard renders, so both read the same data.
- [ ] Group by tool, with atoms underneath and a used-by list computed from every tool's `uses`.
- [ ] Show health, runs and failures over seven days, median time, spend against budget, and linked projects.
- [ ] Serve on `localhost:4100`, read-only, with light and dark themes and phone width support.

**You see.**

- [ ] `node factory/bin/factory.mjs dashboard` serves a page that lists `youtube` first, with its seven atoms underneath.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `factory/test/status.test.mjs` builds the status model from fixture manifests and a fixture run log and asserts literal used-by lists and spend totals. Run `node --test factory/test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `sonnet` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `factory list` at the F5 tip and at the head. Save `f6-l1-regression.txt`. Pass when both list the same names and kinds.
- [ ] Lane 2. Open the dashboard. Save `f6-l2-home.png`. Pass when tools appear above atoms and `youtube` shows seven atoms.
- [ ] Lane 3. Open the `transcribe` row. Save `f6-l3-used-by.png`. Pass when used-by lists youtube, meeting-notes, and podcast.
- [ ] Lane 4. Compare the spend shown with the sum of today's `costUsd`. Save `f6-l4-spend.png`. Pass when they match to the cent.
- [ ] Lane 5. Find the external section. Save `f6-l5-external.png`. Pass when art-desk and vh-personal appear.
- [ ] Lane 6. Restart the dashboard with `PATH` lacking ffmpeg. Save `f6-l6-red.png`. Pass when `frames` shows a red health state naming ffmpeg.
- [ ] Lane 7. Switch to dark mode. Save `f6-l7-dark.png`. Pass when every label is readable.
- [ ] Lane 8. Resize to 375 pixels wide. Save `f6-l8-phone.png`. Pass when the page has no horizontal scroll.
- [ ] Lane 9. Load a fixture run log of 10,000 lines. Save `f6-l9-big-log.png`. Pass when the page renders.
- [ ] Lane 10. Link `youtube` into a scratch project, then reload. Save `f6-l10-links.png`. Pass when that project appears under youtube.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. `factory status` wall time at trunk and head, plus the diff-added dashboard first render with a 10,000-line run log.
- [ ] Probe. `/usr/bin/time -p` for `status`, interleaved trunk and head. Navigation timing in the browser for the first render.
- [ ] Baseline. Record that trunk lacks `status`, then record the head's `factory list` time as the floor.
- [ ] Rule. Fail when `status` exceeds 1 second or the first render exceeds 1 second with the 10,000-line log. Both budgets are guesses.

**Review gate.** Victor reviews before the root appends F6.

- [ ] Copy the lane 2, 3, 7, and 8 screenshots into `docs/plans/media/f6-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the dashboard. Save it as `docs/plans/media/f6-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at STACK-READY. Wait for the operator, Victor, to approve.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Victor's review approval in chat.
- [ ] Rebased onto the F5 tip after the verdict, patch-id unchanged.
- [ ] Root appends F6 to the stack. Victor lands it after F5.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to Victor with the autopilot-stack report. It lists the stack in landing order with PR links, what each PR proved, what was discarded, the decision trail path, and total model spend from the run log.

## Appendix A. Prototype evidence

Each open question the prototypes answered, run on this Mac with no branch, since none needed code in the repo.

- **yt-dlp reaches YouTube from this network.** 2026-10-25, yt-dlp 2026.10.21 through `uvx`. English captions for `jNQXAC9IVRw` downloaded as `json3` in about 3 seconds. It warned that no impersonation target is installed. F1 should add the `curl-cffi` extra if a later lane fails on that.
- **faster-whisper needs PyAV below 19.** faster-whisper 1.2.1 with PyAV 19.0.2 fails with `TypeError: open() got an unexpected keyword argument 'metadata_errors'`. With `av<19`, which resolved to 18.1.0, the `say` fixture transcribed to `Hello from the tool factory.` with no ffmpeg on PATH.
- **Model load time is small.** Warm loads were 0.31 to 0.38 seconds for `tiny` and 0.55 to 0.64 seconds for `small`. Transcribing the two-second fixture took 0.25 to 0.43 seconds and 1.68 to 1.69 seconds. No warm-process HTTP adapter is needed. The `small` weights are 461 MB.
- **Headless Claude Code returns validated JSON with cost.** 2026-10-25. `claude -p --model haiku --output-format json --json-schema` returned `structured_output` and `total_cost_usd` of 0.0085 in about 7 seconds.
- **uv imports a local kit by relative path.** 2026-10-19 with uv 0.12.7, from any working directory, and kit edits applied on the next run.

Still unproven.

- whisper.cpp against faster-whisper on a ten-minute file. F1 measures it.
- Whether YouTube blocks audio downloads, as opposed to captions, from this network. F1 lane 5 shows it.
- Cost and quality of `digest` on `sonnet` and `see` on `haiku`. F2 and F3 measure them.

## Appendix B. Alternatives rejected

- **One YouTube transcriber service.** It would do three jobs and carry YouTube code into tools that do not need it. See `ARCHITECTURE.md`, Part 2.
- **Factory before tools.** It delays the first usable tool by three PRs with nothing to manage yet.
- **Anthropic API keys for model atoms.** Headless Claude Code runs on Victor's login with cost reported per call. The API stays the second backend.
- **Autopilot-full.** The PRs are sequenced and coupled, and Victor wants to review before landing.

## Appendix C. Risks

- **YouTube changes.** yt-dlp breaks when YouTube changes. F1 keeps it unpinned, and F4's doctor reports its age.
- **PyAV and faster-whisper drift.** The `av<19` pin lands in F1. Owners watch for a faster-whisper release that lifts it.
- **Model spend overnight.** Live lanes in F2, F3, and F5 call Claude. The $3 daily cap from F2 bounds it. It is a default Victor can change with the word "budget" and a number.
- **Persistent changes on this Mac.** Lanes must not write to `~/.claude/skills/` or `~/.local/bin/`. F4 adds overrides, and F2 lanes link into scratch projects only.
- **No control skill for CLIs.** The host maps `control-cli` to Bash. Each CLI lane names its exact command and capture.
- **No cloud VMs.** Lanes share this Mac's CPU, so perf lanes run alone after the functional lanes finish.

## Appendix D. Links and reading list

- Read `ARCHITECTURE.md` in full before any PR. Read `CLAUDE.md` for the repo rules.
- F1 and F4 owners run `~/.claude/skills/how/SKILL.md` over the code they touch first. F4 runs `~/.claude/skills/interrogate/SKILL.md` on the rules design before the code-ready report.
- yt-dlp embedding guide in its README. faster-whisper README. ffmpeg `select` filter docs for scene detection.
- The decision trail lives at `docs/plans/factory-v1-trail.md`, per `~/.claude/skills/show-me-your-work/SKILL.md`, and is committed with each PR.
