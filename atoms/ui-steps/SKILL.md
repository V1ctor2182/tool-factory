---
name: ui-steps
description: Write a page-record steps file that drives a UI component through its interactions, through one paid model call on sonnet, from a page-record recording of the component's idle state. Use from ui-clone site before a rebuild, or to start a steps file by hand. Never give it the component's code.
---

# ui-steps

Record the component's idle state with page-record, then run the CLI. It prints one JSON object with `--json`. `manifest.json` holds the verb's inputs, and `bin/ui-steps write --help` prints them.

```sh
bin/ui-steps write survey/recording.json --json
bin/ui-steps write survey/recording.json --problem "page-record: state 'open' action 0 (click): no element matches '[data-slot=\"preview-stage\"] button'" --json
```

The recording's steps file holds the page and the element to watch, with one idle state:

```json
{ "url": "https://kobra.systems/components/button", "target": "[data-slot=\"preview-stage\"]", "states": [{ "name": "idle", "actions": [] }] }
```

The result is a steps file and notes, as `contracts/ui-steps.schema.json` defines it. `steps` is a page-steps file. Its `url`, `target`, `viewport`, and `colorScheme` are the recording's, its first state is `idle` with no actions and a pointer sweep, and the model writes the 2 to 4 states after it. Each state that moves has `frames`. The atom checks `steps` against `contracts/page-steps.schema.json` before it returns or caches them. Without `--json` it prints one line per state and the notes.

The steps are a guess until page-record runs them. Record the original with them, and when page-record fails, pass its message as `--problem`. `ui-clone site` does this at most twice per component.

## The sweep

The atom adds the sweep itself, with no model involved, because one still of the idle state cannot show what the pointer does. The grid has a point about every 14 CSS pixels of the idle screenshot, at most 16 by 16. A cached call gets the same grid from the same screenshot. A target that never answers the pointer costs only the recording time, and page-diff then leaves its score alone.

## What the model sees

The model never sees the component's code. It sees only the first state of the recording: the screenshot of the target, the rendered DOM without scripts, the computed styles, and the animations, each cut to a fixed size. With `--problem`, it also sees that text. Never pass it anything from `ui-source`, a site's registry, a code viewer, or a JS bundle.

## Cost and cache

It sends everything in one call to headless Claude Code on `sonnet` through the kit's model adapter, with `prompts/write.md` as the system prompt. The test's call, one small idle state, cost $0.018 on 2026-11-03. `costUsd` holds the spend, and the run log records it.

The steps are cached by the content of every image and text the model sees, plus the model and the prompt hash. On a cache hit `cacheHit` is true and `costUsd` is 0. The daily budget and the per-call ceiling are the kit's, as for every model atom.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `budget_exceeded` | Today's model spend reached the budget, or the call reached its cap | Wait for the next UTC day, or raise `TOOL_FACTORY_BUDGET_USD` or `TOOL_FACTORY_CALL_BUDGET_USD` |
| `invalid_source` | The recording, its steps file, or one of its files is missing or not JSON | Pass a page-record `recording.json` |
| `invalid_args` | No recording, or a budget variable that is not a finite number of 0 or more | Check `bin/ui-steps write --help` |
| `model_error` | `claude` is missing, timed out, returned nothing, or returned states that do not make a page-steps file | Check that `claude` runs and is logged in, then retry |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
