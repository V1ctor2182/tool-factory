---
name: motion-diff
description: Compare the motion of a rebuild with its original from two motion-measures files. Lists differences, largest first, with side-by-side frames per run. Use after motion-measure on both pages.
---

# motion-diff

```sh
bin/motion-diff compare a.json b.json --baseline a-again.json --departures departures.json --json
```

The result is `contracts/motion-diff.schema.json`. Runs match by id. `a` is the original, and each sheet shows it on the top row.

`--baseline` is a second measure of the original. The gap between `a` and the baseline widens each tolerance, so an effect that differs between two runs of the original does not report against the rebuild. Without it, random motion reports as a difference.

A difference with `severity` `major` changes what a viewer sees or can do, and `minor` is a detail. `departure` matches an entry in `--departures`, a JSON list of `{run, metric, why}`, where run `*` matches every run. The tolerances live in `RULES` in the source, and they are judgement calls set against the seeded defects in `docs/research/clone-any-site-process.md`.

No difference means the measured values agree. It does not mean the pages look alike, so read the sheets.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | A file is missing or not JSON | Pass motion-measures files |
