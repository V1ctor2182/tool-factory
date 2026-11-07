---
name: job-spot
description: Propose microservices from the jobs a person repeats across Claude Code sessions, through one paid model call. Use from scripts, after session-read.
---

# job-spot

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds the verb's inputs, and `bin/job-spot find --help` prints them.

```sh
bin/job-spot find --sessions sessions.json --catalog catalog.json --json
bin/job-spot find --sessions sessions.json --catalog catalog.json --min-sessions 5
```

`--sessions` takes a session list, as `session-read list` prints it with `--json`. `--catalog` takes a file holding `{ "parts": [{ "name", "type", "description" }] }`. The result is a list of job candidates, as `contracts/job-candidates.schema.json` defines it. Without `--json` it prints one line per candidate, then the totals.

It calls headless Claude Code on `sonnet` through the kit's model adapter, with `prompts/job-spot.md` as the system prompt. An empty session list makes no call. `costUsd` holds the spend of the call, and the run log records it.

The cache holds the model's raw reply, by sessions, catalog, model, and prompt. The model's claims are not trusted, so these checks run in code after the cache, and a new `--min-sessions` or `--min-objects` costs nothing.

- `citations` lose repeated sessions, sessions absent from the list, and any `object` that is not in that session's prompts or project.
- A candidate with fewer than `--min-sessions` citations left moves to `dropped` with reason `too_few_sessions`.
- A candidate with fewer than `--min-objects` different objects, ignoring case, moves to `dropped` with reason `too_few_objects`.
- `reuses` keep only catalog atoms. A `coveredBy` that is an atom or absent from the catalog becomes null.
- `missing` names that are catalog atoms move to `reuses`.
- Candidates sort by session count, most first, then by slug.

It proposes only. It builds nothing, and a candidate is not a decision.

There is no daily budget by default. `TOOL_FACTORY_BUDGET_USD` and `TOOL_FACTORY_CALL_BUDGET_USD` set the budgets, as the kit's model adapter defines them.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `budget_exceeded` | Today's model spend reached the budget, or one call reached its cap | Wait for the next UTC day, or raise the budget |
| `invalid_source` | A file is missing, or does not hold the sessions or parts with their fields | Pass the files described above |
| `invalid_args` | A missing flag, or a `--min-sessions` or `--min-objects` below 1 | Check `bin/job-spot find --help` |
| `model_error` | `claude` is missing, timed out, or returned no candidates | Check that `claude` runs and is logged in, then retry |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
