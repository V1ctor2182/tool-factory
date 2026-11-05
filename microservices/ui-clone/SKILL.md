---
name: ui-clone
description: Copy a site's UI components into Victor's private shadcn registry, victor-ui. Use when Victor wants the components of kobra.systems, rareui.com, ui.aceternity.com, or another component site. Goes through every component of a site one after another, keeps the ones whose code the site exposes and whose terms allow keeping, and rebuilds the rest from how they look and move, scored against the original.
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
| `skipped` | Not a `registry:ui`, `registry:block`, or `registry:component` item, such as a `registry:lib` helper. Or not tried, because the site answered HTTP 429 or a bot check earlier in the run | Nothing. A kept component that needs it lists it in its dependencies. After a 429, run again much later |
| `needs-terms` | `sites.json` has no written terms for this site, or its terms forbid keeping code. Nothing was fetched | Read the site's license, then add an entry to `sites.json` with `keepCode` and `terms` |
| `failed` | Any other error. `detail` holds the error code and message. A `rate_limited` or `blocked` failure stops the run, and every later component is `skipped` | Report it. Retry on `network_error` |

## Go through a whole site

`site` takes one site and goes through every component on it, one after another. It keeps the code where `collect` would, and rebuilds the rest from the page with the `rebuild` loop. Rerun it to resume: it skips every component victor-ui already has.

```sh
<this skill's folder>/run site kobra --into ~/victor/victor-ui --dry-run
TOOL_FACTORY_CALL_BUDGET_USD=1 <this skill's folder>/run site kobra --into ~/victor/victor-ui --only button,card --json
<this skill's folder>/run site aceternity --into ~/victor/victor-ui --limit 10 --rounds 3
```

`--redo` rebuilds components that are already rebuilt, under the same name, and is meant for use with `--only`. A component whose rounds all fail gets its last rebuild back. A site's `viewport` in `sites.json` sets the size pages are recorded at. Kobra's is tall so its code panel sits below the demo. A demo that is only a link to a page under its own opens that page and records it.

Start the victor-ui preview with `npm run preview:dev` before a run that rebuilds. `--dry-run` lists the components and decides code or rebuild for each. It still fetches each registry item to see whether it is locked, but it writes nothing and calls no model. `--only`, `--limit`, `--target`, `--rounds`, and `--preview` work as in `collect` and `rebuild`.

For each site, `site` does these steps:

1. It lists the components. They are the site's shadcn registry items, in the registry's order, then the component pages of its catalog that no item covers. `ui-catalog` lists the registry, and a site without one, answering HTTP 404, has only pages. `page-links` lists the links on `catalog` whose path matches `match`. A page and an item are one component when the page's last path segment, or its entry in `aliases`, is the item's name.
2. It skips a component when a victor-ui item's `meta.source` is the component's item URL or its page.
3. It keeps the code of a component with a registry item, the way `collect` does.
4. It rebuilds a component that is `locked`, or that has a page but no registry item, when the site has a `stage`:
   1. page-record surveys the page's idle state, with `stage` as the target.
   2. `ui-steps` writes the states to drive from that survey, and adds a pointer sweep to idle. The rebuild is judged with the same grid, and the overall score cannot pass the sweep's worst point.
   3. page-record records the original with those steps. If a selector matches nothing, `ui-steps` gets page-record's message as `--problem` and tries once more.
   4. The `rebuild` loop runs with those steps and that recording, as `<name>-rebuild`, or `<name>-2-rebuild` when victor-ui already has that name.

The survey, `survey.json`, and the steps, `steps.json`, stay in the data home under `microservices/ui-clone/site/<site>/<name>/`. The rebuild's rounds stay under `microservices/ui-clone/rebuild/<name>/`, as for `rebuild`.

The rebuild stays blind. `ui-steps` and `ui-draft` see only page-record's output. `site` never passes them anything from `ui-source`, a registry, or a page's scripts.

A `rate_limited` or `blocked` answer from any atom stops the site. That component is `failed`, and every later component is `skipped` with the reason. Nothing retries.

`sites.json` gives `site` these fields for each site, all optional:

| Field | Meaning | Kobra | Aceternity |
|---|---|---|---|
| `catalog` | The page that links to every component page | `https://kobra.systems/components` | `https://ui.aceternity.com/components` |
| `match` | A regular expression on a link's path that marks a component page. Default `^/components/[^/]+/?$` | default | default |
| `page` | A component page URL with `{name}`, for a registry item the catalog does not link to | `https://kobra.systems/components/{name}` | none, since its 192 locked Pro blocks have no page under `/components/` |
| `stage` | The CSS selector of the demo on a component page, the element page-record records | `[data-slot="preview-stage"]` | `.preview` |
| `aliases` | A page's last path segment, mapped to the registry item its install command names | none | 12 pages, such as `3d-card-effect` to `3d-card` |

A site without `stage` gets no rebuilds. Its locked components are `skipped`.

With `--json` it prints one report, as `contracts/ui-site-report.schema.json` defines it. Each item has `name`, `itemUrl`, `pageUrl`, `outcome`, `detail`, `score`, `costUsd`, and `stepsFile`. `costUsd` is the item's `ui-steps` spend plus its rebuild's `ui-draft` spend, and the report's `costUsd` is their sum. Without `--json` it prints one line per component, with its outcome, name, score, cost, and detail, then the counts and the total cost.

| Outcome | Meaning | Next step |
|---|---|---|
| `kept` | The code is in victor-ui, as `collect` keeps it. On a dry run, it would be | Nothing |
| `exists` | victor-ui already has an item from this item URL or page. `detail` names it | Nothing |
| `rebuilt` | The best round reached `--target`. `detail` names the item and the round | Look at it in the preview |
| `below-target` | The best round stayed below `--target`. `score` holds it | Look at it, then run `rebuild` with its `stepsFile` to push further |
| `would-rebuild` | A dry run would rebuild it | Run without `--dry-run` |
| `no-steps` | The survey failed, `ui-steps` failed, or its steps failed to record twice | Read `detail`. Write the steps by hand from `stepsFile` and run `rebuild` |
| `rebuild-failed` | The rebuild loop judged no round, or stopped with an error | Read `detail` and the rounds in the data home |
| `needs-terms` | The site's terms do not allow keeping code. Nothing was fetched | Read the site's license, then set `keepCode` and `terms` |
| `skipped` | A `registry:lib` helper, nothing to rebuild from, or not tried after a 429 or a bot check | Read `detail` |
| `failed` | Any other error, or the 429 or bot check that stopped the site | Report it |

On 2026-11-03 a dry run of Kobra listed 96 components. 79 were locked Pro items to rebuild, 11 were already in victor-ui, and 6 were `registry:lib` helpers. A dry run of Aceternity listed 318. 120 were already in victor-ui, 4 were free demos to keep, which only its pages name, and 193 were locked Pro blocks with no page to record. In each run one item fetch failed with a TLS handshake timeout, after about 90 fetches in a row. A later run retries it, since it is not in victor-ui.

## Rebuild a locked component

A `locked` component is rebuilt from how it looks and behaves, never from its code. Do not read the site's source for it: not its registry item, not a code viewer on its page, not its JS bundles. The rendered page, its DOM, and page-record's recordings are fair to read.

1. Open the component's page and write a page-record steps file for it by hand, as `contracts/page-steps.schema.json` defines it. Each component needs its own. Name each state a user reaches, such as idle, hover, focus, typed, error, and success. Add `frames` to a state that animates. Pick a `target` selector and action selectors that a rebuilt demo can also carry, such as `[data-preview-root]` and `input`.
2. In victor-ui, start the preview with `npm run preview:dev`.
3. Run `rebuild`. It loops until a round scores the target or the rounds run out:

```sh
TOOL_FACTORY_CALL_BUDGET_USD=1 <this skill's folder>/run rebuild steps.json --into ~/victor/victor-ui --name input-otp-rebuild
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

Cost per round is ui-draft's `costUsd`, 0 on a cache hit. The total is their sum. The run log also records each call. Each ui-draft call has the kit's ceiling of $0.25 unless `TOOL_FACTORY_CALL_BUDGET_USD` says more, and five rounds of a large component can pass it, so raise the ceiling for a rebuild. The daily budget still applies.

To judge a rebuild by hand, score it, then fix the largest difference and score again:

```sh
<this skill's folder>/run judge steps.json --rebuild http://localhost:5173/<name> --json
<this skill's folder>/run judge steps.json --rebuild http://localhost:5173/<name> --original <earlier recording.json> --json
```

`judge` records the original with the steps file and the rebuild at `--rebuild` with the same steps, then prints page-diff's result, as `contracts/page-diff.schema.json` defines it. `--original` reuses an earlier recording of the original. Read each state's `styles`, `animations`, `motion`, `image`, and `sheet` to find what differs. The sheet shows every frame of both side by side.

`rebuild` stops at a score of 0.9 or after five rounds. Victor then looks at the rebuild and decides whether it needs more work. Pass `--target` to push one further. The score is mechanical and strict, so a rebuild can score well below 1 and still look the same. Measured on Kobra's input-otp on 2026-11-02, with `sites.json`'s Kobra theme in place: two recordings of the original score 0.9999 against each other, Kobra's own code in the preview scores 0.972, a hand-made rebuild from observation scores 0.976, and `rebuild`'s round 5 scores 0.942. Victor could not tell the four apart. What keeps Kobra's own code from 1 is the licensed font the preview lacks, and the rest of the gap is motion a frame early or late. When a site's fonts or images are missing from the preview, judge one of its kept components against its page first, to see how high the real code scores there.

A name another source already holds gets a number, such as `toast-2`. When the two differ, compare them and run victor-ui's `scripts/rename.mjs` to name the difference, such as `toast-icons`. Names never carry the site's name.

A site's `index` and `base` in `sites.json` name where its registry is read from. rareui.com answers scripts with HTTP 403 and 429, measured on 2026-11-05, so its entry reads the same registry from its public GitHub repository. It has no `stage`, since every item there is free.

A site's `theme` in `sites.json` holds the CSS variables its stylesheet sets for every component, read from the rendered page. `collect` adds them to each kept item's `cssVars.theme`, under the item's own. Without them Kobra's `ease-out` resolves to Tailwind's default curve, and its own code scored 0.964 before the theme was added.

Main-thread motion, such as motion's `x` springs, never shows up in `animations`, but page-diff's `motion` lists each element whose transform or opacity moves differently, frame by frame. Ask for `frames` on every state that moves. A state that lasts only between two frames still escapes the recording. Watch the page yourself for those. Make `forMs` cover the slowest reaction. Kobra's error shake starts 1550 ms after the code is typed. A reaction that starts within a few milliseconds of a frame can land one frame later from run to run, so the same element can show up in `motion` even when the original is compared with itself.

On failure before any component is fetched, the script exits 1. With `--json` it prints `{"error": {"code", "message"}}`, otherwise the code and message go to stderr.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_args` | `--into` has no `scripts/add.mjs`, the site is neither a key nor a URL, `--only` names a component the site lacks, or an argument is missing | Check `run --help` and the path |
| `unavailable` | The site refused its registry index | Report the message |
| `rate_limited` | The site answered HTTP 429 for its registry index | Retry later |
| `network_error` | The site could not be reached | Retry later |
| `invalid_source` | The site has no shadcn registry index at the address tried | Add an `index` and `base` to its `sites.json` entry |
| `internal` | A bug. The traceback is on stderr | Report the message and the traceback |
