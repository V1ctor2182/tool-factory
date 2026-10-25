---
name: see
description: Describe images and copy their visible text, through one paid model call on haiku. Use from scripts. An agent that can read images itself should look at them instead.
---

# see

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds the verb's inputs, and `bin/see describe --help` prints them.

```sh
bin/see describe frame-0001.jpg frame-0002.jpg --json
bin/see describe slide.png
```

The result is image notes, as `contracts/image-notes.schema.json` defines it. Each image gets a `description` and its visible `text`, in the order given. Without `--json` it prints each path, its description, and its text.

It sends every image in one call to headless Claude Code on `haiku` through the kit's model adapter, with `prompts/see.md` as the system prompt. It runs on Victor's Claude Code login, so it needs no API key. One small frame costs well under one cent. `costUsd` holds the spend of the call, and the run log records it.

Each image is cached by its bytes, the model, and the prompt. The call sends only the images the cache does not hold. When the cache holds every image, `cacheHit` is true, `costUsd` is 0, and the call works even over the budget.

The daily budget is $3 by default and is shared with every model atom. Set `TOOL_FACTORY_BUDGET_USD` to change it. The kit sums today's `costUsd` from `runs.jsonl` in the data home, in UTC days, and refuses once the sum reaches the budget. Each call also has a ceiling of $0.25 by default, set by `TOOL_FACTORY_CALL_BUDGET_USD`. The kit passes the ceiling or the rest of the budget, whichever is lower, to `claude --max-budget-usd`, and charges that cap when a failed call shows no cost. The cap is soft. claude checks it only after a turn ends, so one call can spend past its cap by one turn. One run saw a call with a $0.0002 cap spend $0.0055. A call starts only while the day is under its budget, so a day passes its budget by at most one call, which spends about its ceiling plus one turn.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `budget_exceeded` | Today's model spend reached the budget, or one call reached its cap | Wait for the next UTC day, or raise `TOOL_FACTORY_BUDGET_USD` or `TOOL_FACTORY_CALL_BUDGET_USD` |
| `invalid_source` | A file is missing or is not a PNG, JPEG, GIF, or WebP file | Pass image files |
| `invalid_args` | No image, or a `TOOL_FACTORY_BUDGET_USD` or `TOOL_FACTORY_CALL_BUDGET_USD` that is not a finite number of 0 or more | Check `bin/see describe --help` |
| `model_error` | `claude` is missing, timed out, or returned no notes | Check that `claude` runs and is logged in, then retry |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
