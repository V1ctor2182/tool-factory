---
name: ui-clone
description: Copy a site's UI components into Victor's private shadcn registry, victor-ui. Use when Victor wants the components of kobra.systems, rareui.com, ui.aceternity.com, or another site with a shadcn registry. Keeps the components whose code the site exposes and whose terms allow keeping, lists the locked ones, and rebuilds a locked one from how it looks and moves, scored against its original.
allowed-tools: Bash(*ui-clone/run *)
---

# ui-clone

Run the `run` script in this skill's folder. It lists the site's shadcn registry with the `ui-catalog` atom, fetches each component with the `ui-source` atom one after another, and writes each component it may keep into victor-ui through that repo's `scripts/add.mjs`. Progress lines go to stderr.

```sh
<this skill's folder>/run collect kobra --into ~/victor/victor-ui --json
<this skill's folder>/run collect aceternity --into ~/victor/victor-ui --dry-run --json
<this skill's folder>/run collect kobra --into ~/victor/victor-ui --only input-otp,button --json
```

`<site>` is a key in `sites.json` next to this file, or a site URL. A URL whose host matches an entry uses that entry. `--into` is the victor-ui repo and must hold `scripts/add.mjs`. `--limit N` takes the first N components in the registry's order. `--only` takes the named ones. `--dry-run` fetches and decides everything but writes nothing. Rerunning is safe, since `add.mjs` replaces a component it already has.

With `--json` it prints one report, as `contracts/ui-clone-report.schema.json` defines it. `items` holds each component with its `outcome` and a `detail` string. `counts` holds the number of each outcome. `dryRun` says whether anything was written.

| Outcome | Meaning | Next step |
|---|---|---|
| `kept` | The code is in victor-ui, with the site's terms as `meta.license`. `detail` is what `add.mjs` printed, `added` or `updated` | Nothing |
| `locked` | The site does not expose the code. Its files are empty, or it answered HTTP 401, as Kobra does for Pro items | Rebuild it, as the next section describes |
| `skipped` | Not a `registry:ui`, `registry:block`, or `registry:component` item, such as a `registry:lib` helper | Nothing. A kept component that needs it lists it in its dependencies |
| `needs-terms` | `sites.json` has no written terms for this site, or its terms forbid keeping code. Nothing was fetched | Read the site's license, then add an entry to `sites.json` with `keepCode` and `terms` |
| `failed` | Any other error. `detail` holds the error code and message | Report it. Retry on `network_error` |

## Rebuild a locked component

A `locked` component is rebuilt from how it looks and behaves, never from its code. Do not read the site's source for it: not its registry item, not a code viewer on its page, not its JS bundles. The rendered page, its DOM, and page-record's recordings are fair to read.

1. Open the component's page and write a page-record steps file for it by hand, as `contracts/page-steps.schema.json` defines it. Each component needs its own. Name each state a user reaches, such as idle, hover, focus, typed, error, and success. Add `frames` to a state that animates. Pick a `target` selector and action selectors that a rebuilt demo can also carry, such as `[data-preview-root]` and `input`.
2. In victor-ui, start the preview with `npm run preview:dev`.
3. Run `rebuild`. It loops until a round scores the target or the rounds run out:

```sh
<this skill's folder>/run rebuild steps.json --into ~/victor/victor-ui --name input-otp-rebuild
<this skill's folder>/run rebuild steps.json --into ~/victor/victor-ui --name input-otp-rebuild --rounds 3 --target 0.95 --json
```

`rebuild` records the original once with page-record. Each round then:

1. `ui-draft write` writes the component and its demo from the recording, with victor-ui's `package.json` dependencies as `--packages`. From round 2 on it also gets the last round's draft, and either that round's page-diff or the error that stopped it.
2. `add.mjs --rebuild` installs the item with `meta.method` `rebuild` and the demo at `preview/demos/<name>.tsx`. Items match on source and method, so a rebuild never replaces the collected original.
3. `npm run typecheck` in victor-ui lays out the preview and runs `tsc`. A failure becomes the round's `error` and the next round's `--problem`, and the round is not judged.
4. `judge` records `<preview>/<name>` with the same steps and compares it to the original with page-diff. A demo that lacks a steps selector also becomes the next round's problem.

Each round's `draft.json` and `diff.json` stay in the data home under `microservices/ui-clone/rebuild/<name>/round-<n>/`. At the end the best round is installed again, and its item's `meta.rebuild` holds the best round, its score, the total cost, and each round's score and cost. A ui-draft failure, such as `budget_exceeded`, or an install or recording failure that no draft can fix, ends the loop early as that round's error, and the best round so far stays installed. When no round was judged, the last draft stays installed and `best` is null.

The rebuild stays blind. ui-draft sees only page-record's output, the steps file, its own earlier draft, page-diff's output, and the error text. `rebuild` never calls ui-source.

With `--json` it prints the report, as `contracts/ui-rebuild.schema.json` defines it. Without it, it prints one line per round, its score or `error`, and its model cost, then the total. The first two rounds of Kobra's input-otp on 2026-11-02, where the 0.9 bar stops:

```
round 1  error   $0.26  The judge could not record the demo at http://localhost:5173/input-otp-auto: target: no element matches '[data-slot="preview-stage"] .t-input-wrap'
round 2  0.9094  $0.14
total    $0.40  best round 2 at 0.9094, passed 0.9
```

Cost per round is ui-draft's `costUsd`, 0 on a cache hit. The total is their sum. The run log also records each call. There is no ceiling per call or per day unless `TOOL_FACTORY_CALL_BUDGET_USD` or `TOOL_FACTORY_BUDGET_USD` is set.

To judge a rebuild by hand, score it, then fix the largest difference and score again:

```sh
<this skill's folder>/run judge steps.json --rebuild http://localhost:5173/<name> --json
<this skill's folder>/run judge steps.json --rebuild http://localhost:5173/<name> --original <earlier recording.json> --json
```

`judge` records the original with the steps file and the rebuild at `--rebuild` with the same steps, then prints page-diff's result, as `contracts/page-diff.schema.json` defines it. `--original` reuses an earlier recording of the original. Read each state's `styles`, `animations`, `motion`, `image`, and `sheet` to find what differs. The sheet shows every frame of both side by side.

`rebuild` stops at a score of 0.9 or after five rounds. Victor then looks at the rebuild and decides whether it needs more work. Pass `--target` to push one further. The score is mechanical and strict, so a rebuild can score well below 1 and still look the same. Measured on Kobra's input-otp on 2026-11-02, with `sites.json`'s Kobra theme in place: two recordings of the original score 0.9999 against each other, Kobra's own code in the preview scores 0.972, a hand-made rebuild from observation scores 0.976, and `rebuild`'s round 5 scores 0.942. Victor could not tell the four apart. What keeps Kobra's own code from 1 is the licensed font the preview lacks, and the rest of the gap is motion a frame early or late. When a site's fonts or images are missing from the preview, judge one of its kept components against its page first, to see how high the real code scores there.

A site's `theme` in `sites.json` holds the CSS variables its stylesheet sets for every component, read from the rendered page. `collect` adds them to each kept item's `cssVars.theme`, under the item's own. Without them Kobra's `ease-out` resolves to Tailwind's default curve, and its own code scored 0.964 before the theme was added.

Main-thread motion, such as motion's `x` springs, never shows up in `animations`, but page-diff's `motion` lists each element whose transform or opacity moves differently, frame by frame. Ask for `frames` on every state that moves. A state that lasts only between two frames still escapes the recording. Watch the page yourself for those. Make `forMs` cover the slowest reaction. Kobra's error shake starts 1550 ms after the code is typed. A reaction that starts within a few milliseconds of a frame can land one frame later from run to run, so the same element can show up in `motion` even when the original is compared with itself.

On failure before any component is fetched, the script exits 1. With `--json` it prints `{"error": {"code", "message"}}`, otherwise the code and message go to stderr.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_args` | `--into` has no `scripts/add.mjs`, the site is neither a key nor a URL, `--only` names a component the site lacks, or an argument is missing | Check `run --help` and the path |
| `unavailable` | The site refused its registry index. rareui.com answered HTTP 403 on 2026-11-01 | Report the message |
| `rate_limited` | The site answered HTTP 429 for its registry index. rareui.com did on 2026-11-01 | Retry later |
| `network_error` | The site could not be reached | Retry later |
| `invalid_source` | The site has no shadcn registry index at the address tried | Add an `index` and `base` to its `sites.json` entry |
| `internal` | A bug. The traceback is on stderr | Report the message and the traceback |
