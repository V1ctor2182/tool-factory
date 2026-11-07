---
name: digest
description: Turn a transcript file into a summary, chapters with timestamps, and key points, through one paid model call. Use from scripts. An agent that is itself a model should read the transcript and summarize it instead.
---

# digest

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds the verb's inputs, and `bin/digest make --help` prints them.

```sh
bin/digest make --transcript transcript.json --json
bin/digest make --transcript transcript.json
bin/digest make --transcript transcript.json --image-notes notes.json --json
```

The input is a transcript file, as `captions get` or `transcribe file` print it with `--json`. The result is a digest, as `contracts/digest.schema.json` defines it. Without `--json` it prints the summary, the chapters, the key points, and the transcript path as text.

`--image-notes` takes an image-notes file, as `see describe` prints it with `--json`, where each image also has its `time` in seconds. The digest then also has `visual`, notes on what appears on screen with their start times, and the summary uses what the frames show.

It calls headless Claude Code on `sonnet` through the kit's model adapter, with `prompts/digest.md` as the system prompt and the digest schema as the output schema. It runs on Victor's Claude Code login, so it needs no API key. A short video costs about one cent. `costUsd` holds the spend of the call, and the run log records it.

A second call on a transcript with the same timed text and the same image notes, with the same model and prompt, reads the cache. It sets `cacheHit` to true and `costUsd` to 0, and it returns without reading the budget, so it works even over the budget or with an invalid one.

There is no daily budget by default. Set `TOOL_FACTORY_BUDGET_USD` to add one, shared with every model atom. Before each model call the kit sums today's `costUsd` from `runs.jsonl` in the data home, in UTC days, and refuses once the sum reaches the budget. Each call has no ceiling by default. Set `TOOL_FACTORY_CALL_BUDGET_USD` to add one. When either is set, the kit passes the ceiling or the rest of the budget, whichever is lower, to `claude --max-budget-usd`. The cap is soft. claude checks it only after a turn ends, so one call can spend past its cap by one turn. One run saw a call with a $0.0002 cap spend $0.0055. A call starts only while the day is under its budget, so a day passes its budget by at most one call, which spends about its ceiling plus one turn. When a call fails and its reply shows no cost, as on a timeout or a reply that is not JSON, the run log charges that call's `--max-budget-usd` cap, so today's total errs high by at most one ceiling.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `budget_exceeded` | Today's model spend reached the budget, or one call reached its cap | Wait for the next UTC day, or raise `TOOL_FACTORY_BUDGET_USD` or `TOOL_FACTORY_CALL_BUDGET_USD` |
| `invalid_source` | A file is missing, is not a transcript or image notes, or has no segments or no image with a time | Pass a transcript file, and image notes with times |
| `invalid_args` | No `--transcript`, or a `TOOL_FACTORY_BUDGET_USD` or `TOOL_FACTORY_CALL_BUDGET_USD` that is not a finite number of 0 or more | Check `bin/digest make --help` |
| `model_error` | `claude` is missing, timed out, or returned no digest | Check that `claude` runs and is logged in, then retry |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
