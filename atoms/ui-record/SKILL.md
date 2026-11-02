---
name: ui-record
description: Record what one UI component looks like in each state of a scripted session, deterministically, in headless Chromium. Use to capture a component whose code is not exposed, and to record a rebuild with the same steps file so the two can be compared.
---

# ui-record

Write a steps file, then run the CLI. It prints one JSON object with `--json`. `manifest.json` holds the verb's inputs, and `bin/ui-record capture --help` prints them.

```sh
bin/ui-record capture steps.json --json
bin/ui-record capture steps.json --url http://localhost:3000/preview/input-otp --json
```

`--url` replaces the steps file's `url`. Record the original and the rebuild with the same steps file, and their states line up one to one.

## The steps file

`contracts/ui-steps.schema.json` defines it.

```json
{
  "url": "https://kobra.systems/components/input-otp",
  "target": "[data-slot=\"preview-stage\"] .t-input-wrap",
  "viewport": { "width": 1280, "height": 800 },
  "colorScheme": "dark",
  "states": [
    { "name": "idle", "actions": [] },
    { "name": "focus", "actions": [{ "do": "focus", "selector": "input[data-slot=\"input-otp\"]" }] },
    { "name": "wrong code", "actions": [{ "do": "type", "text": "123456" }], "frames": { "everyMs": 50, "forMs": 600 } }
  ]
}
```

`target` is the component root, and defaults to `body`. Screenshots, the DOM, and styles cover it. Pick a selector that names the component's own markup, not a wrapper the site adds.

Actions are `hover`, `click`, `focus`, `scroll` (each needs `selector`), `type` and `paste` (need `text`), `press` (needs `key`, a Playwright key name such as `Backspace` or `ControlOrMeta+a`), and `wait` (needs `ms`). `type`, `press`, and `paste` act on the focused element when `selector` is absent. Each state's actions run after the previous state's, like one user session.

`paste` dispatches a paste event that carries `text`, and inserts the text when the page does not cancel the event. It never touches the system clipboard.

## Time

The page runs on Chromium's virtual clock from the first byte. Timers, animation frames, `performance.now()`, `Date` (which starts at 2026-01-01T00:00:00Z), and CSS and Web Animations move only when the atom advances them. Virtual time also stands still while a request is in flight, so network speed never changes a frame. The page gets 10 s of page time to load.

After a state's actions, `frames` takes a screenshot every `everyMs` for `forMs`. Frame i is at exactly i × `everyMs` after the actions, so frame 0 is the instant the actions finish. Then the atom advances 100 ms at a time until no finite animation runs and no `setTimeout` is pending, for at most 5 s, and records the settled state. A page that keeps a timer pending always settles for the full 5 s.

## The recording

`contracts/ui-recording.schema.json` defines it. Every path points into the run folder `dir`, under the data home's `ui-record/`. `dir/recording.json` holds a copy of the result.

| Field | Holds |
|---|---|
| `screenshot` | The settled state, a PNG clipped to the target plus 8 px, at device scale 2 |
| `frames` | One PNG per frame, clipped the same way |
| `dom` | An HTML file with the target's settled `outerHTML`, script elements removed |
| `styles` | A JSON file mapping each element path to its computed box model, colors, borders, radii, shadow, font, opacity, transform, transition, and flex or grid properties |
| `motion` | A JSON file `{everyMs, tracks}`. `tracks` maps each element path whose computed `transform` or `opacity` changed across the frames to the value at every frame, for the properties that changed. Empty for a state without frames |
| `animations` | Every distinct running animation seen on the target or inside it during the state, with keyframes, duration, delay, easing, iterations, direction, and fill |

An element path is a selector relative to the target, such as `:scope > :nth-child(2) > :nth-child(1)`. The target itself is `:scope`. A CSS animation's timing function sits on each keyframe's `easing`, and the animation's own `easing` reads `linear`.

`motion` catches what `animations` cannot. A library such as motion moves a spring by writing `style.transform` on every animation frame, which `getAnimations()` never lists, so the computed values at each frame are the only record of it. Ask for `frames` on any state that moves.

Known gap: under the virtual clock the CSS and Web Animations timeline does not advance between frames. A CSS animation or transition holds its first keyframe in every frame and its `motion` track, and reaches its end only in the settled state. Its `animations` entry is still complete. Main-thread motion, and anything driven from `requestAnimationFrame` or timers, is sampled correctly.

The atom records rendered results only. It never saves the site's scripts or bundles.

## Determinism

Two runs of the same steps file give byte-identical settled screenshots. Frames are byte-identical as well. Frames during animations a library drives from JavaScript, such as motion, can differ by a few levels per channel at the edges, so compare frames with a small tolerance.

## Setup

The atom runs Playwright 1.63.0 with its headless Chromium. Install the browser once:

```sh
uv run --with playwright==1.63.0 playwright install chromium
```

`factory doctor` cannot see the browser, because it checks binaries on PATH. A missing browser shows up as `unavailable` on the first run, and the message gives this command.

## Kind

The atom is `observe`, because it only operates a demo page inside a throwaway headless browser, with no login and no effect outside it. It never caches, and every call sets `cacheHit` to false.

## Errors

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_args` | The steps file is unreadable or breaks the schema. The message lists each violation | Fix the steps file |
| `invalid_source` | A selector matched nothing. The message names the state and the action, or the target | Inspect the page and fix the selector |
| `blocked` | The page shows a bot check, such as Vercel Security Checkpoint or a Cloudflare challenge | Stop. The atom never tries to get past one |
| `network_error` | The page could not be reached, did not load within 10 s of page time, or kept a request open for 20 s | Retry later, or record a page without a long-lived request |
| `unavailable` | The site answered with an HTTP error, or headless Chromium is missing | Report the status, or install the browser as the message says |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
