---
name: motion-measure
description: Turn a page-sweep into numbers: where effects exist, their spans and curves, peak colours, rhythm, and reaction times. Use after page-sweep, and before motion-diff or when studying one page's motion.
---

# motion-measure

```sh
bin/motion-measure measure ~/.local/share/tool-factory/page-sweep/files/<sweep>/sweep.json --json
```

The result is `contracts/motion-measures.schema.json`, one entry per run with `values` and `keyFrames`. It runs no browser and caches by the content of `sweep.json`.

| Run | Values |
|---|---|
| `walk` | `activeRanges`, the scroll ranges that move at rest. `transitions`, each change of page colour with `spanPx` and `largestStepPer40Px`. `pageColour`, `energy`, and a 16 by 10 `grid` per stop. `overflow` |
| `idle` | `litPeak`, `litMean`, `everLit`. `events`, `ratePerS`, `gapMeanS`, `gapCv`. `order`, where 1 sweeps steadily around the screen and near 0 scatters. `periodicity`. `colours`. `hues`, the share of briefly lit pixels in each of 12 hue sectors |
| `hover`, `click` | `responseMs`, `riseMs`, `peak`, `box`, `colours`, `worstGapMs`. A hover adds `cursor` and `residualAfterExit`. A click adds `state` |
| `path` | `reaction`, `reactionPeak`, `reachPx` |
| `load` | `settleMs`, when the page last differs from its final frame for 3 samples in a row, so a loop passing through does not count. `colours` |
| `pass` | `coastMs`, how long content keeps moving in one direction after the wheel stops. `inertiaMs`, `travelPx`. `transitions`, one entry from the first frame's page colour to the last frame's, sampled every 40 px |

`settleMs` samples by frame index, so a loop that stays over 1% of the frame for 3 samples still counts as assembling.

`spanPx` cannot be finer than the walk's `resolution`, so read it from a `pass` through the change. A `transitions` entry reads the most common colour in the frame, so a page whose content covers its background can hide a change.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | The sweep or a frame is not readable | Pass a `sweep.json` that page-sweep wrote |
