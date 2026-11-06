---
name: motion-trace
description: Follow one part of a page over time: how far it moves or turns, each move's length and overshoot, its period, and the curve that fits. Use when a rebuild feels stiff or wooden, or to read a part's timing from a sweep.
---

# motion-trace

```sh
bin/motion-trace trace ~/.local/share/tool-factory/page-sweep/files/<sweep>/sweep.json --run idle-0 --box 250,135,390,270 --bundle <workspace>/bundle.json
```

The result is `contracts/motion-trace.schema.json`. It runs no browser and caches by the sweep, the run, the box, and the bundle.

Use a sweep from `page-sweep capture`, since `page-sweep run` and `site-clone` prune frames. Trace the same part on the original and the rebuild, and read the two side by side. A rebuild's part may sit elsewhere, so find its box on the rebuild's own frames.

| Channel | Reads | Needs |
|---|---|---|
| `x`, `y` | A shift, in px, right and down | Something with edges along that axis. Listed only when a shift explains the change, see `rigid` |
| `angle` | A turn, in degrees, clockwise | A box centred on the part. `activeBox` shows where the change is |
| `activity` | When the box changes at all, as bursts | Nothing. A flip, a morph, or a fade reads only here |

On a run with a wheel, the wheel drives every move before it stops, so only the fit in `coast` describes the page.

`durationS` on a move ends at the last visible step. A curve with a long tail stops showing before it ends, so read the length from the fit.

`.23,1,.32,1` and an exponential look alike, so read a close pair as a tie. The text form prints both when they are within 0.01. Without `--bundle` only `linear` and `exponential` are tried.

A shift is whole pixels and a turn whole degrees, so a very small move gets a poor fit. A part with few edges can pass the `rigid` check by chance, so look at the frames when a channel surprises you.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | The sweep, a frame, or the bundle is not readable, or the run lost its frames | Sweep with `page-sweep capture` |
| `invalid_args` | No such run, or a bad box | Fix it |
