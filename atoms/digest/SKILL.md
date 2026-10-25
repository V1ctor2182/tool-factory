---
name: digest
description: Turn a transcript file into a summary, chapters with timestamps, and key points, through one paid model call. Use from scripts. An agent that is itself a model should read the transcript and summarize it instead.
---

# digest

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds the verb's inputs, and `bin/digest make --help` prints them.

```sh
bin/digest make --transcript transcript.json --json
bin/digest make --transcript transcript.json
```

The input is a transcript file, as `captions get` or `transcribe file` print it with `--json`. The result is a digest, as `contracts/digest.schema.json` defines it. Without `--json` it prints the summary, the chapters, the key points, and the transcript path as text.

It calls headless Claude Code, `claude -p --safe-mode --model sonnet`, with `prompts/digest.md` as the system prompt and the digest schema as the output schema. It runs on Victor's Claude Code login, so it needs no API key. A short video costs about one cent. `costUsd` holds the spend of the call, and the run log records it.

A second call on a transcript with the same timed text, with the same model and prompt, reads the cache. It sets `cacheHit` to true and `costUsd` to 0, and it works even over the budget.

The daily budget is $3 by default. Set `TOOL_FACTORY_BUDGET_USD` to change it. Before each model call the atom sums today's `costUsd` from `runs.jsonl` in the data home, in UTC days, and refuses once the sum reaches the budget. It also passes the rest of the budget to `claude --max-budget-usd`. When a call fails and its reply shows no cost, as on a timeout or a reply that is not JSON, the run log charges that call's `--max-budget-usd` cap, so today's total errs high.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `budget_exceeded` | Today's model spend reached the budget. A cache hit returns without reading the budget | Wait for the next UTC day, or raise `TOOL_FACTORY_BUDGET_USD` |
| `invalid_source` | The file is missing, is not a transcript, or has no segments | Pass a transcript file |
| `invalid_args` | No `--transcript`, or a `TOOL_FACTORY_BUDGET_USD` that is not a finite number of 0 or more, such as `nan`, `inf`, or `-1`. A cache hit returns without reading the budget | Check `bin/digest make --help` |
| `model_error` | `claude` is missing, timed out, or returned no digest | Check `claude -p` works, then retry |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
