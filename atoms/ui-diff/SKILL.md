---
name: ui-diff
description: Score how close two ui-recordings of the same steps file are, and say what differs in each state, in pixels, frames, computed styles, and animations. Use as the judge when rebuilding a component from observation, comparing the rebuild's recording against the original's, and re-run after each fix.
---

# ui-diff

Record the original and the rebuild with `ui-record` and the same steps file, then compare the two `recording.json` files. The CLI prints one JSON object with `--json`. `manifest.json` holds the verb's inputs, and `bin/ui-diff compare --help` prints them.

```sh
bin/ui-diff compare original/recording.json rebuild/recording.json --json
bin/ui-diff compare original/recording.json rebuild/recording.json --tolerance 16
```

`a` is the reference and `b` is judged against it. Without `--json` it prints one line per state, its name, score, and pixel mismatch, then `score` and the overall score.

## The diff

`contracts/ui-diff.schema.json` defines it. States pair by name, in a's order, then states only b has.

| Field | Holds |
|---|---|
| `score` | 0 to 1 for the state, 1 when identical. See the score below |
| `missing` | `a` or `b` when that recording lacks the state, which scores 0. Otherwise null |
| `size` | Each settled screenshot's `[width, height]` in CSS pixels, the image size divided by device scale 2. It includes ui-record's 8 px margin |
| `pixels` | The settled screenshots compared on their overlap after aligning top-left corners. `mismatch` is the fraction of overlap pixels whose largest RGBA channel difference exceeds `tolerance`. `meanDelta` is the mean of that largest difference, in levels from 0 to 255 |
| `frames` | `mismatch` for each frame index, compared the same way. Null when only one recording has that frame |
| `styles` | `{path, property, a, b}` for each computed property that differs, on element paths both recordings have, root first by depth and then child order. At most 50 |
| `animations` | Summaries `{type, name, target, duration, delay, easing, iterations}` matched by `target` and `name`. `onlyA` and `onlyB` list the unmatched, and `changed` lists each timing field that differs on a matched pair |
| `image` | A PNG of a, b, and a heatmap side by side, at image scale. The heatmap shows a dimmed in gray, mismatched pixels in red, brighter for larger differences, and magenta where only one screenshot reaches |

Styles compare after normalizing values that render the same: a zero with any unit reads `0`, `rgba(r, g, b, 1)` reads `rgb(r, g, b)`, `transparent` reads `rgba(0, 0, 0, 0)`, and whitespace and comma spacing collapse. The listed values are the raw ones.

A CSS animation's timing function sits on its keyframes, so a summary's `easing` is the keyframes' shared easing when the animation's own reads `linear`.

## The score

Each state with both sides scores a weighted mean of up to four terms, each from 0 to 1.

| Term | Weight | Value |
|---|---|---|
| pixels | 0.5 | `(1 - mismatch) × overlap area / union area`, so a size difference costs as much as the area it leaves uncovered |
| frames | 0.2 | The mean of the same value over frame indexes. A frame only one side has counts 0 |
| styles | 0.2 | `1 - differing properties / compared properties`, over every property on shared paths, not only the 50 listed |
| animations | 0.1 | Matched pairs with equal timing divided by matched pairs plus unmatched animations |

A term with nothing on either side, such as frames for a state with no frames, drops out and the weights of the rest renormalize. A state missing on one side scores 0. The overall `score` is the mean over all states. Every term falls as differences grow, and identical recordings score exactly 1.

## Tolerance

`--tolerance` defaults to 24 of 255. ui-record's settled screenshots are byte-identical run to run, but frames during animations a library drives from JavaScript differed by up to 33 levels at edges, so a frame mismatch near 0.01 between two runs of the original is noise. Raise the tolerance to judge frames more loosely, or lower it to catch small color errors.

## Kind

The atom is `transform`. The cache key hashes the content of every screenshot, frame, and styles file, each state's animations, and the tolerance, never the paths, so a moved copy of a recording hits the cache. A hit sets `cacheHit` to true and carries the current `a` and `b` paths. Diff images live in the data home under `ui-diff/files/<key>/`, and a missing image counts as a miss.

## Errors

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_args` | `--tolerance` is outside 0 to 255 | Fix the flag |
| `invalid_source` | A file is not a ui-recording, names one state twice, or points at a missing or unreadable image or styles file. The message names the file and the state | Pass a `recording.json` that `ui-record capture` wrote, with its run folder intact |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
