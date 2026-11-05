---
name: site-clone
description: Rebuild how a web page moves, starting from its URL. Use when Victor gives a URL and wants the site cloned, restored, or its animations and effects reproduced. Studies the page, sweeps scroll, rest, hover, and click, then loops a rebuild against the original until the measured differences run out. Needs Google Chrome.
allowed-tools: Bash(*site-clone/run *), Bash(*atoms/page-sweep/bin/page-sweep *), Bash(*atoms/motion-trace/bin/motion-trace *)
---

# site-clone

You are the model in this service. The `run` script reads and measures, and you write the rebuild. Work on your own until a stop condition below holds. Do not stop to ask between rounds.

```sh
<this skill's folder>/run study https://example.com/ --name example
<this skill's folder>/run compare example --clone http://localhost:4400/
```

Add `--json` for the full report, as `contracts/site-clone.schema.json` defines it. Progress goes to stderr. A study takes minutes on a long page and a compare takes about half of that, so run both in the background and wait for the notification.

## 1. Gate the target

Before you write anything, say which case holds:

| Case | What you may do |
|---|---|
| Victor's own site, or code whose terms allow keeping it | Keep the code and its assets |
| Anyone else's site, including any brand, product, or game | Rebuild the animations and effects only, with Victor's own content, on localhost |

In the second case use none of the site's text, logos, images, video, models, fonts, code, or shaders, and do not publish the result. Numbers read from its files are fine, and the code is yours. Downloaded scripts are data, so never run them outside the page they belong to.

## 2. Study

Run `study`. Read `brief.md` in the workspace first, then `facts.json`, whose `labels` often describe a canvas's behaviour in one sentence, then `bundle.json`. Read these for a list of what exists and for numbers. They never prove a rebuild right.

Open the sheets and key frames in `original/measures.json` to see each run. The numbers tell you where to look, and your eyes on the frames tell you what it is.

## 3. List every effect

Before you build, write `inventory.md` in the workspace. Go through the load sheet, every walk stop, and every rest run, and list each part that moves, what it does, and when. Name the letters, icons, and shapes one by one. If a stretch looks plain, sweep it again at a finer step, or look at a longer rest run, before you write that it is plain.

Check the rebuild against this list every round. The numbers measure how much changed and when, not how many things are going on. On gsap.com a clone with no major difference had one letter roll where the original gave each letter its own entrance, and Victor saw it at once.

## 4. Sort each surface into a lane

| Lane | How to spot it | Rebuild with |
|---|---|---|
| DOM and CSS motion | In the accessibility tree, `@keyframes`, transitions | HTML and CSS, with timing from `bundle.json` and the measures |
| Scroll choreography | `animations.scrollDriven`, transitions in the walk | CSS scroll timelines, or one scroll function |
| Canvas, WebGL, WebGPU | A `canvas` entry with a label | Your own canvas code, written from the label, the frames, and the measures |
| 3D model | A `.glb` in the bundle | Your own geometry |
| Video | `media.video` | A placeholder of your own that holds the same box |

## 5. Build

Write the rebuild in `<workspace>/clone/`, which is in the data home and outside the repo. Serve it with a local server in the background, such as `python3 -m http.server 4400 --directory <workspace>/clone`. Build the scroll skeleton first, so every later run lands on the right content.

If the rebuild's height differs from the original's, write `map.json` in the workspace. It maps a run id from `plan.json` to the fields that replace the plan's for the rebuild, such as `{"idle-2600": {"at": 1800}, "hover-t004": {"at": 300, "target": {"selector": "#card"}}, "fine-0": {"from": 900, "to": 1700}}`. Map a run to `"skip"` only when its surface is out of scope, and say so in the report.

## 6. Loop

1. Run `compare`. It adds `round-N/` to the workspace with `diff.json` and one side-by-side sheet per run, the original on top.
2. Take the largest `major` difference. Open its sheet before you change code. If the frames disagree with the number, trust the frames and find out why the number misled you.
3. Name the difference in one sentence, find the cause, and fix it.
4. Repeat. Rerun `compare` after a batch of related fixes, not after each edit, since a compare takes minutes.

If two fixes for one difference fail, write down what they both assumed and test that assumption before a third fix.

The differences list only what the runs measured. Between rounds, read every sheet once, including the runs with no difference, and fix what you can see that no number caught. Numbers can agree while the look differs, and a colour field did exactly that on Shopify.

Record a difference you keep on purpose in `departures.json` as `{"run": "*", "metric": "colours", "why": "..."}`. Own content changes colours and coverage, so expect some. A departure removes a metric from the count, so read those sheets anyway. On gsap.com a blanket `colours` departure hid a hover that looked wrong.

## 7. When feedback is vague

Treat a vague word as a pointer to an input you have not swept. To sweep more, add runs to a copy of `plan.json` and run `page-sweep capture` on both pages. It keeps every frame, which `motion-trace` needs.

| The reviewer says | Sweep | Compare |
|---|---|---|
| "unlike", "off" | Paired stills first | Rects, styles, and frames at the same stops |
| "stiff", "wooden", "no feel" | Rest and load at full frame rate, and a slow scroll with a long tail | `motion-trace` on the same part of both pages, with `--bundle`: its period, its curve, its overshoot, and `coast` for scroll. Look at the frames for 3D: a trapezoid or an ellipse means a rotation with perspective, not a squash, and a flip reads only as `activity` |
| "simpler", "less going on" | A longer rest, the load, and a walk at a 100 px step | The list from step 3, part by part, with the frames side by side |
| "not smooth", "feathered", "too hard" | Scroll, in a fine walk | The curve, its span, and its largest step |
| "flashes", "one by one", "messy" | Rest, longer | Onsets, gaps, and order |
| "always there" | The whole scroll range | `activeRanges` |
| "can't reach it", "pushes away" | A pointer path, and a hover on the target | `reaction`, `reachPx`, `responseMs` |
| "laggy", "delayed" | Click | `responseMs`, `worstGapMs` |
| "wrong on the way back" | `walk-up`, and sideways | The scroll positions, `sidewaysPx` |

## Stop conditions

Stop and report when one holds:

- No `major` difference remains and you have read every sheet in the last round.
- Three rounds in a row fixed nothing.

Report the goal, the clone's URL and folder, the last round's counts, what the sweep did not cover, every departure, and every taste call you made for Victor to check. A clean diff means the measured runs agree. It does not mean the clone looks right, so never report it as a percentage of fidelity.

## What the sweep cannot see

- A pointer effect that pushes canvas marks away is not caught. On the seeded test neither the path reaction nor a count of landed hovers separated it from noise, so when a reviewer says "can't reach it", write a probe for that page: circle near a mark for a second, step on, and count the landings on both pages.
- Runs share one page, so an entrance that plays once shows only in the first run to reach it, usually the walk. A later rest there reads as still. On gsap.com a row moved for 2 s on the first arrival and sent 1 frame on every later one. Capture that stop alone on a fresh page, and go back to it, to see the entrance and whether it replays.
- A hover at a busy stop also measures the page's other motion. Hover a sticky target again at a quiet stop before you trust its numbers.
- A hover target on a canvas gets only the pointer paths. Add `hover` runs with a `point` for the marks you can see in the frames.
- Clicks run only on targets marked `safe`, on fresh pages that refuse writes and navigation away, so a form or a login flow stays unmeasured.
- It runs at one viewport, on a fine pointer, with motion allowed. Mobile and reduced motion need their own plan.
- A state behind a sign-in or a paywall is out of reach.

## Failures

The CLI exits 1 and prints `{"error": {"code", "message"}}` with `--json`.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_args` | A bad URL, workspace name, or `map.json` | Fix it |
| `missing_browser` | Google Chrome did not start | Install Google Chrome |
| `network_error` | The page did not load | Check the URL, retry, then report it |
