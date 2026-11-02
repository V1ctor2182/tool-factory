---
name: ui-clone
description: Copy a site's UI components into Victor's private shadcn registry, victor-ui. Use when Victor wants the components of kobra.systems, rareui.com, ui.aceternity.com, or another site with a shadcn registry. Keeps the components whose code the site exposes and whose terms allow keeping, lists the locked ones, and scores a rebuild of a locked one against its original.
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

A `locked` component is rebuilt from how it looks and behaves, never from its code. Do not read the site's source for it: not its registry item, not a code viewer on its page, not its JS bundles. The rendered page, its DOM, and ui-record's recordings are fair to read.

1. Open the component's page and write a ui-record steps file for it, as `contracts/ui-steps.schema.json` defines it. Name each state a user reaches, such as idle, hover, focus, typed, error, and success. Add `frames` to a state that animates. Pick a `target` selector that also exists on the rebuild's demo.
2. In victor-ui, add the rebuild as a registry item with `meta.method` set to `rebuild`, plus a demo in `preview/demos/<name>.tsx` that copies the original page's surroundings. Start the preview with `npm run preview:dev`.
3. Score it, then fix the largest difference and score again:

```sh
<this skill's folder>/run judge steps.json --rebuild http://localhost:5173/<name> --json
<this skill's folder>/run judge steps.json --rebuild http://localhost:5173/<name> --original <earlier recording.json> --json
```

`judge` records the original with the steps file and the rebuild at `--rebuild` with the same steps, then prints ui-diff's result, as `contracts/ui-diff.schema.json` defines it. `--original` reuses an earlier recording of the original. Read each state's `styles`, `animations`, `motion`, `image`, and `sheet` to find what differs. The sheet shows every frame of both side by side.

Stop at a score of 0.94 or after five rounds. Measured on Kobra's input-otp on 2026-11-01: Kobra's own code in the preview scores 0.960, because the preview lacks Kobra's licensed font, and a rebuild from observation scored 0.963 after two rounds. A site whose font the preview has can reach higher.

Main-thread motion, such as motion's `x` springs, never shows up in `animations`, but ui-diff's `motion` lists each element whose transform or opacity moves differently, frame by frame. Ask for `frames` on every state that moves. CSS animations hold still in frames under ui-record's clock, so judge their timing from `animations`. A state that lasts only between two frames still escapes the recording. Watch the page yourself for those.

On failure before any component is fetched, the script exits 1. With `--json` it prints `{"error": {"code", "message"}}`, otherwise the code and message go to stderr.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_args` | `--into` has no `scripts/add.mjs`, the site is neither a key nor a URL, `--only` names a component the site lacks, or an argument is missing | Check `run --help` and the path |
| `unavailable` | The site refused its registry index. rareui.com answered HTTP 403, then 429, on 2026-11-01 | Report the message |
| `network_error` | The site could not be reached | Retry later |
| `invalid_source` | The site has no shadcn registry index at the address tried | Add an `index` and `base` to its `sites.json` entry |
| `internal` | A bug. The traceback is on stderr | Report the message and the traceback |
