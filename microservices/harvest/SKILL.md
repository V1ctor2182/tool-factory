---
name: harvest
description: Propose microservices from the jobs Victor repeats across Claude Code sessions. Use when he asks what he keeps doing by hand, or what to build next. It proposes only.
allowed-tools: Bash(*harvest/run *)
---

# harvest

Run the `run` script in this skill's folder. Use the script even though you are a model, because the checks on the candidates run there.

```sh
<this skill's folder>/run scan
<this skill's folder>/run scan --days 60 --until 2026-10-01 --min-sessions 4 --json
```

It calls the `session-read` atom on the window, builds a catalog of each name, type, and description from this repo's manifests, `external.json`, and Claude Code's skills, and calls the `job-spot` atom, one paid model call unless the reply is cached. Progress lines go to stderr.

It prints one block per candidate, with its session and object counts, its job, and either the part that covers it or the parts it reuses and the atoms it lacks, then the totals. With `--json` it prints the result as `contracts/job-candidates.schema.json` defines it.

It writes `sessions.json`, `catalog.json`, and `latest.json` to `harvest/` in the data home. Each run replaces them. `sessions.json` holds Victor's own prompts, so it stays out of the repo.

Harvest proposes. It builds nothing and schedules nothing. Show Victor the candidates and let him pick.

On failure the script exits 1. With `--json` it prints `{"error": {"code", "message"}}`, otherwise the code and message go to stderr.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | `--root` or `--skills` is not a folder | Pass the folder that holds the project or skill folders |
| `invalid_args` | A bad `--until`, a number below 1, or an unknown argument | Check `run scan --help` |
| `budget_exceeded` | Today's model spend reached the budget | Wait for the next UTC day, or raise the budget |
| `model_error` | `claude` is missing, timed out, or returned no candidates | Check that `claude` runs and is logged in, then retry |
| `internal` | A bug in an atom. The traceback is on stderr | Report the message and the traceback |
