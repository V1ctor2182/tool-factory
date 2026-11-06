# Clone any site: the process

This is the process that two runs produced, written so it can become the `site-clone` service. [Quorum](clone-any-site-quorum.md) was a canvas game. [Shopify Editions Fall '26](clone-any-site-shopify-editions.md) was a scroll-driven marketing page with WebGPU, 3D models, Rive, and video. Each step names the atom that does it today, or the atom it still needs.

The process has one rule above the steps. Read the site before you click it. On Quorum the shipped bundle answered in 12 calls what 25 clicks could not. On Shopify the bundle, console, and accessibility tree named every component and described every canvas before the first click.

The Shopify rebuild added a second rule. Check the clone against the original at the same stops, never against your notes. The first two hero rebuilds passed every check against their spec and still looked wrong to Victor. The third compared both pages side by side and found seven differences in one pass. The [run log's Phase 4](clone-any-site-shopify-editions.md#phase-4-rebuild-the-hero-as-a-motion-study) has the rounds.

The Shopify corrections added a third rule. Sweep each input across its whole range before you judge a motion. Frozen frames found most static differences, and they missed the motion problems. [Find motion differences with a sweep](#find-motion-differences-with-a-sweep) has the procedure.

## Steps

1. **Gate the target.** Decide what may be kept, what may be rebuilt, and what may only be studied. A component whose code and terms allow it is kept. A locked component is rebuilt from how it looks and moves. A game, a brand, or a named product is studied only, and the rebuild steps run on a different target or on Victor's own content. `ui-clone judge` does the first two today. The study-only verdict is missing.

2. **Fetch the shipped files.** Get `index.html`, every script and stylesheet it loads, source maps when they exist, the web manifest, and the media it names: models (`.glb`), shaders (`.wgsl`, `.glsl`), Rive files (`.riv`), fonts, and a sample of the videos. Decode content encodings, because a CDN may serve a `.glb` gzip-encoded. Store everything under `$TOOL_FACTORY_HOME`, never in the repo. `page-bundle fetch` does this step. The atom is uncommitted.

3. **Read the bundle.** Scan the files for facts, not code to copy. The output is one contract:
   - the stack: build tool, view library, canvas, WebGL, or WebGPU engine, CSS system, smooth-scroll library, fonts;
   - routes, hash anchors, and screen names;
   - chunk, module, or function names that survived minification, which together form a component list;
   - message, action, or event names with their payload shapes;
   - the key map from keyboard handlers;
   - storage keys, query flags, and debug hooks;
   - capability gates: `getContext` kinds, feature checks, and `matchMedia` queries;
   - design tokens, `@keyframes`, easing curves, and named scroll stops;
   - the inside of each asset: a `.glb`'s mesh, node, and material names, a shader's function names, a `.riv`'s artboards and state machines;
   - static assets by URL, and server routes the page calls.

   `page-bundle parse` does this step. It is a pure function of the fetched files, so its test can assert a literal expected output.

4. **Read the live page's free specs.** Open the page once and collect four sources before clicking anything:
   - the console, which can hold eggs, flags, and debug notes;
   - every `aria-label` on a canvas, video, or `role="img"`, which often describes the behaviour in one sentence;
   - data attributes on `<html>`, `<body>`, and each section, which often expose the page's state machine and per-section tokens;
   - `document.getAnimations()`, where a `currentTime` of `null` marks a scroll-driven animation.

   Needs a new `observe` atom, `page-read`, that runs one headless load. A live page is a different noun from the shipped files, so this step does not belong in `page-bundle`.

5. **Map the site by hand once.** Walk every route in a real browser. For each screen, record how you reach it, its controls, their states, and what each control changes. Leave and come back, because offline or timed screens only show up that way. Use the bundle's names and the labels from step 4 as a checklist for screens you have not found. Map each capability tier as its own pass: desktop, mobile, touch, reduced motion, and the fallback a feature gate falls back to. The output is a site map: screens, edges, and the intent each edge fires. Needs a new `observe` atom, `page-map`.

6. **Find the levers that reach each state.** List the cheapest way into every screen on the map: a URL, a hash, a query flag (`?no-webgpu`, `?expo-mode`), a seeded storage value, a debug key, an exact scroll offset, or a scripted path. Prefer seeding over playing, because a seeded state records the same way every time. `page-record` needs four new step types for this: `storage`, which sets `localStorage` before load, `drag`, which drags between two points, `scroll` with a `y` offset, and a per-state media override for capability tiers.

7. **Test every gesture you are unsure of.** Read the handler first, then do the gesture once and look. On Quorum a link drag completes only when released on the target card's body. On Shopify a hero link click is a crossfade jump that any wheel or key cancels. Act by element ref, not by screenshot coordinate. Coordinates missed three times on Shopify, and refs never missed.

8. **Record each state.** Run `page-record capture` with one steps file per screen. It records pixels, computed styles, and animations. A canvas yields only pixels, so add `see describe` on its frames and keep the bundle's names and the canvas's label next to them. `page-record` drives only clock-time animations, so scroll-driven ones record at their scroll position. It blocks video and event-stream requests, because a stream that never ends would hold page time still, so a video records as its poster. Record a video's frames in the Video lane instead. `page-record` proves states. It does not find motion, and [the sweep](#find-motion-differences-with-a-sweep) finds motion.

9. **Sort each surface into a lane.** Every part of every screen goes into exactly one lane. The lane picks the rebuild tool.

   | Lane | How to spot it | Rebuild with |
   |---|---|---|
   | DOM component | shows in the accessibility tree, styled by CSS | `ui-clone rebuild`, which drives `ui-draft` and `page-diff` |
   | Canvas, WebGL, or WebGPU | a `<canvas>` with no text in the tree, often with an `aria-label` | a written spec from frames, names, the label, and the event log, then a canvas draft. Needs a `canvas-draft` model atom. Shaders are rewritten, using the original's function names only for structure |
   | 3D model | a `.glb` or `.gltf` request | Blender. Rebuild the part hierarchy and anchor empties the original names, export glTF, compress with `gltfpack` |
   | Rive | a `.riv` request, often with a PNG poster | Rive's editor. Copy the state machine's inputs and states, draw new art |
   | Video | `<video>` loops, usually muted | a screen recording of the real UI, props from Blender or gpt-image, composed in an editor. The wrapper's `aria-label` is the storyboard |
   | Vector art | an inline or linked SVG | redraw as layered SVG. Keep the layer split if the art animates |
   | Raster art | `<img>` or a CSS background | gpt-image for flat illustration, Blender for 3D or isometric scenes that need consistent angles |
   | Motion | `@keyframes`, transitions, scroll timelines, scripted frames | copy timing, easing, and scroll stops from step 3, then match against `page-diff` animation tracks |
   | Data | a server route such as search | a local index or fixture behind the same route shape |

10. **Assemble the shell.** Build the routes, the screen state machine, and the key map from steps 3 to 5. The intent list from step 3 becomes the app's message type. The state attributes from step 4 become its state type. Each lane's output plugs into a screen.

11. **Prove the clone.** Replay the same steps files against the original and the clone, then run `page-diff compare` per state. A screen passes at the threshold `ui-clone` already uses. Replay the intent list too: every intent from step 3 must have a working path in the clone. Repeat per capability tier.

    A rebuild with its own content cannot pass a pixel threshold, because the text and images differ on purpose. Compare what the rebuild copies instead:
    - the geometry of each matching element at each scroll stop, from `getBoundingClientRect` and computed styles on both pages;
    - the frames of each canvas at the same stop, side by side;
    - each hover and pulse as a short sequence of frames, since the original's hover on Shopify ran in three beats over about 3 s.

    Capture both pages headless at full resolution. A preview pane may scale the viewport down and hide marks a few pixels wide. For an intro or any timed sequence, install Playwright's fake clock and advance both pages by the same step. Real-time screenshots drift by up to half a second each. Listen for page errors in the same run, since a broken frame loop looks like a missing effect.

    A capability tier can sit behind an experimental API. Check the response headers for `origin-trial`, since the original may have access its rebuild on another origin lacks. Run the real Chrome channel with the flag that passes the page's own support check, and test the rebuild the same way, with plain Chrome as a control. Time interactions by the browser's own steps too: on Shopify a one-second click lag was a `paint` awaited inside a view transition callback, not slow drawing. Test every interactive target at its projected position, because a coarse sweep steps over targets a few pixels tall.

    For scroll motion, sample positions every 200 px and compute each element's rate. Computed styles can read `none` while an element still drifts, so positions are the reliable record. List `document.getAnimations()` before assuming a class name means an animation.

    Never read a thin line's colour from a lossy or downscaled capture. On Shopify a 1 px green line in a JPEG screencast read as a pale tint, and the rebuild copied the wrong colour. Use a lossless capture and sample the peak across the line. When a state might come from either a pointer or a timer, move the pointer on and off and watch which one drives it.

    Record the motion you are judging while it moves, across the whole range. On Shopify every check held the page at one gap, which hid that the graph and its flashes exist only between sections. Step through the full scroll range and ask of each effect where it is absent. Numbers can also agree while the look differs, so put frames side by side at matching progress before trusting them.

    Diff these numbers, not your spec against your clone. A spec you misread passes a check against itself. `page-diff` needs a geometry mode for this (guess at the shape: a role or selector map between the two pages, then a rect and style diff per stop).

    Run [the sweep](#find-motion-differences-with-a-sweep) in this step too. Geometry and paired stills do not cover motion.

## Find motion differences with a sweep

Use this procedure when a clone looks wrong and nobody can say why, or when a reviewer's feedback is vague. It comes from the Shopify run, so the claims about other sites are guesses until a second run tests them.

### Why frozen frames were not enough

Rounds 3, 4, 6, and 7 of the [Shopify run log](clone-any-site-shopify-editions.md) list 44 differences. I found them after general feedback such as "still off" or "the small details", by reading both pages at the same stops. Most are static or geometric. Their tables have 7, 12, 16, and 9 rows.

Victor had to point at the following seven problems, all of them motion. His words are translated where he wrote in Chinese. Each one sat on an input that my checks had not sampled. His eye followed the motion, and my checks read one position or one moment.

| Victor's words | What I had not sampled | Probe | Result (measured) |
|---|---|---|---|
| "pushes so much I can't hover" | The pointer's path into a target | Circle a node, step onto it, count hover hits | 0 of 15 before the fix, 10 of 15 after |
| "click depth mode lags" | The browser's steps after a click | Time each step and the longest frame gap | 1567 ms before the fix, 67 ms after |
| "scroll back has a problem" | Other scroll directions | Send a sideways wheel, read `scrollWidth` and `scrollX` | The page was 1610 px wide at a 1440 px viewport |
| "not as smooth, more fading" | Scroll, as a curve | Sample fixed screen points every 40 px | The change ran about 480 px on the original and about 220 px on the study |
| "the lines blink" | Time at rest | Record at 60 fps, track brightness on a ring around the hub | About 12 spokes per cycle, each 0.215 s apart |
| "this is the original, still wrong" | Peak colour in lossless frames | Sample the peak across the line in PNG frames | `#4bf08e`, which a JPEG capture had read as a pale tint |
| "not always there like a beam" | The whole scroll range | Step every 200 px, ask where the effect is absent | The graph shows only between sections |

The first two passes on the flash failed because both held the page still. The third pass recorded a wheel scroll through a section change, and that recording led to the fix.

### Translate vague feedback into an input

Treat a vague word as a pointer to an input you have not swept. If the feedback is a taste call with no original to match, such as "make the transition slower", apply it and add it to the departures list in step 8 of the sweep.

| The reviewer says | Sweep | Compare |
|---|---|---|
| "unlike", "off" | Unknown, so start with paired stills | Rects, styles, and frames at the same stops |
| "not smooth", "feathered", "too hard" | Scroll | The curve, its length, and its largest step |
| "flashes", "one by one", "messy" | Time at rest | Onset times, gaps, and order |
| "always there" | The whole scroll range | Where the effect is absent |
| "can't reach it", "pushes away" | The pointer's path | The hit rate, with a teleport as the control |
| "laggy", "delayed" | Time after a click | Time to first change and the longest frame gap |
| "wrong on the way back" | Upward and sideways scroll | The scroll positions and `scrollWidth` |

### Run the sweep

1. **Read the code for a list, not for proof.** Use the bundle and the labels to list effects, numbers, and states. Round 2 took numbers from the bundle, checked against its own spec, and still failed.

2. **List the inputs.** Most motion on a marketing page comes from scroll, idle time, hover, and click. Add the load intro and each capability tier, because Shopify's intro needed a fake clock and its Depth mode needed an experimental flag.

3. **Sweep every input at every scroll stop, on both pages, with one script.** The inputs are not independent. The flash exists only between sections, and the hub hover differs between the hero and a section. Use lossless frames and listen for page errors on every run.
   - **Scroll.** Wheel down the whole page, back up, and sideways. Rest at several stops as well, so you can tell whether an effect needs movement.
   - **Idle.** Rest at each stop for at least two cycles of the slowest loop. Shopify's flash needed 8 s at 60 fps.
   - **Hover.** List the targets first. Aim at each canvas target's projected position, because a selector cannot name one. Keep any grid step smaller than the target, because Shopify's far links were about 4 px tall. Record the approach, the hold, and the exit. The original's hover ran in three beats over about 3 s.
   - **Click.** List the targets first. Record the time to first change, the longest frame gap, the state afterward, and the way back. The state means the scroll position, the hash, and the focus.

4. **Map the activity.** For each screen region, mark where in the input range the pixels change and where they stay still. A flat stretch answers "where is this effect absent". Nothing built this map on Shopify. `vis.py` and `gate2.py` answered that question for one effect, after Victor's correction.

5. **Measure each thing that moves.** Compute five values on both pages:
   - the range where it exists;
   - its start and end, as the 10% to 90% span;
   - the shape of its curve;
   - its peak colour, from lossless frames;
   - its rhythm, as a log of onsets, gaps, and order.

6. **Separate the causes with a control.** Move the pointer on and off to tell a hover from a timer. Compare rest with movement to tell an idle effect from a scroll effect. On Shopify this showed that a screenshot with every spoke green was the hub hover and not an ambient pulse.

7. **Put frames side by side at matching progress.** Do not skip this step when the numbers agree. On Shopify the colour field numbers matched while the bloom sat off-centre with low contrast.

8. **Find the cause only after you name the difference.** Fix it, then rerun the same script on both pages. Keep a list of deliberate departures, so the next sweep does not report them as defects. The Shopify study's motion departures are random flashes and a slower colour change.

### What the tools cover today

`page-sweep` drives all four inputs in real Chrome and records a lossless screencast. It is a new atom and not an extension of `page-record`, because `page-record` uses a virtual clock with compositor threads off, which cannot hold WebGL, video, or scroll inertia. `motion-measure` turns the frames into numbers. `motion-diff` compares two pages against a noise floor from a repeat of the original. The `site-clone` service plans the sweep from what `page-read` and `page-bundle` found. Writing the clone stays with the agent running the skill.

### Prove the sweep with seeded defects

Each defect went into a copy of the study, and `site-clone compare` ran with no hint about which defect was present. The numbers are measured, as original against seeded copy.

| Defect | How it was seeded | Result |
|---|---|---|
| None | The study unchanged | 0 major, 1 minor. The minor is noise in `colours` |
| Click lag | A 1500 ms busy loop on entry to Depth mode | Found. `responseMs` 40 against 1536, `worstGapMs` 16.8 against 1499.9 |
| Wrong line colour | The flash colour `[75, 240, 142]` in `graph.js` set to a pale tint | Found. `hues` major at 4 of 10 rest stops. One unrelated major, `pass` `spanPx` 202 against 324 |
| Lines always on | `s.lines` set to 1 in `main.js` | Found. 15 major, including `litPeak` 0.00011 against 0.00442 |
| Ordered flashes | Flashes at a fixed rate in a fixed order | Reported, weakly. `order` 0.659 against 0.28, and 0.623 against 0.285, as minor only |
| Sideways overflow | `overflow-x: clip` removed from `.page-host` | Found in an earlier run. `sidewaysPx` 0 against 170 |
| Hard colour change | `JOURNEY` in `main.js` halved | Found in an earlier run. `spanPx` 296 against 160 |
| Hard pointer push | The old push restored, with no decay and double force | Not found |

The push is a known miss. The path reaction read 0.044 on both pages, because the glyph fluid dominates it. A count of hovers landed after circling near a mark read 0 and 0.062 against 0.125 and 0.062, within the noise of 16 tries. That run was removed, so a reviewer's "can't reach it" still needs a probe written for the page.

The `colours` rule at rest adds 1 to 3 false minors per compare, measured over the none and lag runs. It stays because it is the only rule that sees a slow blink of the wrong colour.

Seeded defects test only what this run already taught, so a second site still has to show whether the sweep finds new kinds of problem.

## Atoms the service uses

| Atom | Kind | Status |
|---|---|---|
| `page-bundle` | `observe` | uncommitted, from another session |
| `page-read` | `observe` | new. Reads the console, labels, data attributes, animations, rects, and targets from a live page |
| `page-sweep` | `observe` | new. Runs load, walk, pass, idle, hover, path, and click |
| `motion-measure` | `transform` | new. Turns a sweep's frames into values per run |
| `motion-trace` | `transform` | new. Follows one box in one run over time, and fits each move's curve |
| `motion-diff` | `transform` | new. Compares two measures with a noise floor and draws paired sheets |

There are no `visual-judge` or `canvas-draft` atoms, because Claude Code running the skill reads the sheets and writes the code. A headless model version would need them. `ui-clone` stays the per-component service.

## First real run: gsap.com

The first URL Victor gave after the tool was built. The target is someone else's site, so the clone uses own text and shapes, stays on localhost, and is not published.

The study took 14.2 min for 33 runs, and all 33 succeeded. Round 1 had 9 major differences. Round 13 had 0 major and 5 minor, with 10 departures, and Victor still saw a simpler clone. After the rebuild for that, round 17 had 2 major, round 18 had 5, round 20 had 1, and round 21 had 1 major, 6 minor, and 12 departures. Each compare took about 7 min. All numbers are measured.

| What the run taught | Evidence | Status |
|---|---|---|
| A page at rest sends no frames, so the idle rate divided by a tiny span | `ratePerS` read 29.41 on a clone that had stopped moving | Fixed. A run's `forMs` now sets the span |
| A static page returned no `everLit`, which read as a major difference from 0 | `idle-8700` 0.0 against null | Fixed in `motion-diff` |
| The hero reacts to the pointer anywhere on the screen | Hero hovers responded in under 101 ms in 16 of 16 tries, and a path at a quiet stop read 0 | Found by the numbers, and rebuilt |
| A hover at a busy stop measures the page's other motion | The nav hover peak read 0.0068 at the hero and 0.0005 at scroll 5900 | Open. The plan should hover sticky targets at a quiet stop |
| A blanket `colours` departure hid a real hover difference | The numbers passed while the clone filled the button and the original split its label around a spark. Eyes found it on the sheet | Open. Keep departures per run |
| Pruning removes the walk's stills, so reading the page needs a second walk | 6 stills kept out of 49 stops | Open |
| `activeRanges` hid a real gap by passing near its threshold | Rounds 9 and 11 read major and round 10 passed. Rest motion covered 0.822 of the page on the original and 0.644 on the clone, and the video placeholder only changed in jumps | Partly fixed. Continuous drift in the placeholder raised the clone to 0.689 and round 13 passed. The rule still sits near its threshold |
| One scrub lag cannot match both the walk and the rest runs | A 500 ms lag gave the walk 0.822, and added 8 major differences at stops where the original is still | Open. Lag stayed at 170 ms. The original's rows move after a 200 px step and not after a long approach, and the cause is unknown |
| A clean diff hid a far simpler clone | Round 13 had 0 major. Victor saw at once that the letters, the `i`, and the curve did less. The sheets held 6 walk stills, 5 load frames, and 3 rest frames, and `settleMs` read 5349 against 1798 as a minor | Fixed. Sheets keep about 60 walk stills, 12 load frames, and 9 rest frames, `settleMs` is major, and the skill requires a list of effects before the build |
| A count of moving parts does not separate this gap | The old clone and the original both move a wheel, an `i`, and a squiggle at rest. A region count read 3 on the clone and 7 on the original, and the extra 4 were squiggle fragments | Dropped the metric |
| Feel lives in the curves, and frames show them | Victor called the rebuild stiff. Traced from the frames, the wheel turns 90 degrees every 1.30 s on the page's own `cubic-bezier(.23,1,.32,1)`. The `i` flips 540 degrees in 3D every 4.50 s on the same curve. The rebuild used random spring kicks and a flat squash | Fixed on the clone. These traces began as one-off scripts and are now `motion-trace`. On the same sweeps it reads the wheel at 89 to 91 degrees every 1.30 s on that curve over about 0.52 s, against 87 degrees over 0.534 s on the clone. It reads the `i` every 4.50 s, against 4.48 s, but a flip reads only as `activity`, so its curve is not fitted |
| A last-step measure did not separate a hard stop | `stopStepPx` read 1 against 2 and 6 against 2. `coastMs` read 622 against 248 on a slow scroll | Kept `coastMs` and dropped the other |
| An entrance that plays once hides from every later run | `idle-6400` on the original sent 1 frame, while a fresh arrival moved for 88 frames and each return sent 1. The clone replayed on every return, which read major. All runs share one page | Fixed on the clone. The stops at 5800, 6400, 6700, and 7000 all played once. The tile row is a stack that spreads in about 0.5 s with no scale, which a scroll-bound rebuild cannot show, and only a fresh arrival revealed it. The skill warns about this, and the plan still cannot see these on its own |
| A loop near a threshold reads as a late settle | `settleMs` read 5261 and 4995 on the original and 7783 on the clone. A 1% rule on 60 samples catches a wheel turn only sometimes, and the turn covers 0.9% to 1.3% of the frame | Fixed. It now needs 3 samples in a row |
| The rest frames found what the numbers named wrongly | That 7783 also came from a real miss. The original replays one 0 to 90 degree turn, so its gradient jumps back each beat and every rest frame is identical. The clone's gradient kept turning, a steady 0.97% from its last frame | Fixed on the clone |
| One loaded compare can read as a slow hover | Round 19 read `responseMs` 600, 552, and 465 with the load average near 20. Three recaptures read 67 to 113 for the first and 6 to 52 for the second. The third, with its video placeholder, read 35 to 449 | Open. A compare keeps one reading per run and does not record load, so recapture a new response major before fixing it |
| A rate depends on where a part sits on the grid | `idle-0` read 2.17 against 0.99. Each wheel turn reached one more cell 0.16 s later and counted twice, while `motion-trace` read the same 1.30 s period | Recorded as a departure |
| A pane that draws no frames looks like a broken intro | `document.timeline.currentTime` stayed 0 at both widths, while real Chrome settled in 1798 ms | Check animation time before blaming the page |

## Time

| Step | Page | Time (measured) |
|---|---|---|
| Study | The motion study, 33 runs | 25 min |
| Study | Shopify Editions, 43 runs | 43 min |
| Compare | The motion study | 11 min |

A compare repeats one sweep, so a Shopify compare should take about 20 min (inferred). On a page that long, one hour holds the study and about one compare round, so the full loop runs over one hour.

The one-hour goal is unproven. The first clone with this tool took 10 compare rounds on gsap.com. The Shopify run by hand took about 4.4 active hours (inferred from transcript gaps under 5 minutes) with about 15 corrections from Victor.
