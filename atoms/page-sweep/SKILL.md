---
name: page-sweep
description: Record lossless real-time frames of a page while scrolling it, resting, hovering, moving the pointer, and clicking, from a sweep-plan file. Use to study motion that a virtual clock cannot hold, such as WebGL, video, smooth scrolling, or click lag. Needs Google Chrome.
---

# page-sweep

```sh
bin/page-sweep capture plan.json
bin/page-sweep capture plan.json --url http://localhost:4400/ --json
```

A plan is `contracts/sweep-plan.schema.json`. The result is `contracts/page-sweep.schema.json`, and `sweep.json` next to the frames holds the same thing. Frame paths are relative to it.

| Run | Records |
|---|---|
| `load` | A screencast from navigation, on a fresh page |
| `walk` | Two stills at each stop, `from` to `to` by `step`, plus the widest `scrollWidth` and one sideways wheel. `to` may be `end`. A `to` below `from` walks upward |
| `pass` | A screencast through a wheel scroll of `distance`, one `wheelPx` tick every 33 ms, then the coast. Each frame has its scroll offset |
| `idle` | A screencast at rest at `at` for `forMs`, at up to 60 fps |
| `hover` | A screencast before, during, and after the pointer enters `target` |
| `path` | A screencast while the pointer follows `points` at `speed` px/s |
| `click` | A screencast of a mouse click on `target`, on a fresh page, with the worst frame gap and the state after |

A `target` is a `selector` or a viewport `point`. The pointer must really hit a target, checked with `elementFromPoint`. A control that scroll reveals is not there yet, so `hover` and `click` keep scrolling down, up to 4 screens past `at`. A target still not hit reports `missing`, and the sweep goes on. A run that throws reports `failed`, and the sweep goes on.

Click runs abort any request other than GET, HEAD, or OPTIONS, abort navigation away from the page, and close popups. Each run reports what it blocked in `state.blocked`. So a click cannot submit or buy, and a page that needs its POST to react looks unresponsive.

It runs on the real clock, so two sweeps of a page with random motion differ. `page-record` is the deterministic atom. Frames are large: budget about 1 GB per long page. They live under `page-sweep/files/` in the data home.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_args` | The plan breaks the schema or repeats a run id | Fix the plan |
| `missing_browser` | Google Chrome did not start | Install Google Chrome |
| `network_error` | The page did not load | Check the URL, retry |
