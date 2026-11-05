---
name: ui-draft
description: Write a shadcn component and its demo page from a page-record recording of the original, through one paid model call on sonnet, and revise it from a page-diff. Use from scripts and from ui-clone rebuild. Never give it the original's code.
---

# ui-draft

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds the verb's inputs, and `bin/ui-draft write --help` prints them.

```sh
bin/ui-draft write recording.json --name input-otp-rebuild --packages motion,clsx,tailwind-merge --json
bin/ui-draft write recording.json --name input-otp-rebuild --previous round-1/draft.json --diff round-1/diff.json --json
bin/ui-draft write recording.json --name input-otp-rebuild --previous round-2/draft.json --problem "$(npm run --silent typecheck 2>&1)" --json
```

The result is a draft, as `contracts/ui-draft.schema.json` defines it. `item` is a shadcn registry item with one file at `components/ui/<name>.tsx`, in the shape `ui-source` returns, so victor-ui's `scripts/add.mjs --rebuild` takes it. `demo` is the TSX of a demo page that imports the component from `@/components/ui/<name>` and carries `data-preview-root` on its root. `notes` says what the draft changed and why. Without `--json` it prints the file, the demo's size, and the notes.

## What the model sees

The rebuild stays blind to the original's code. The model sees only:

- the recording's steps file, so the demo answers the same target and actions,
- for each state, the settled screenshot, up to 3 evenly spaced frames, the rendered DOM without scripts, the computed styles, the motion tracks, and the animations, each cut to a fixed size,
- with `--previous`, its own earlier draft,
- with `--diff`, page-diff's per-state scores, pixel, style, animation, and motion differences, and its `image` and `sheet` PNGs,
- a state's pointer sweep, as each distinct answer with its points and what changed, and up to 3 of their images. With `--diff`, the sweep's grid, its worst point, and that point's PNG,
- with `--problem`, the text given, such as a typecheck or install error.

Never pass it anything from `ui-source`, a site's registry, a code viewer, or a JS bundle. `--packages` lists the npm packages the target project has. The model's schema then allows only those as `dependencies`.

## Cost and cache

It sends everything in one call to headless Claude Code on `sonnet` through the kit's model adapter, with `prompts/write.md` as the system prompt. The test's call, two small states with five images, cost $0.021 on 2026-11-02. A real component with four states, frames, and a diff sends about 25 images and writes a longer file, so expect more. `costUsd` holds the spend, and the run log records it.

A draft is cached by the content of every image, text, and file it sends, plus the model and the prompt hash. On a cache hit `cacheHit` is true and `costUsd` is 0.

There is no daily budget by default. `TOOL_FACTORY_BUDGET_USD` adds one, shared with every model atom. Each call has no ceiling by default. `TOOL_FACTORY_CALL_BUDGET_USD` adds one.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `budget_exceeded` | Today's model spend reached the budget, or the call reached its cap | Wait for the next UTC day, or raise `TOOL_FACTORY_BUDGET_USD` or `TOOL_FACTORY_CALL_BUDGET_USD` |
| `invalid_source` | The recording, its steps file, one of its files, `--previous`, or `--diff` is missing or not JSON | Pass a page-record `recording.json` and files that exist |
| `invalid_args` | No recording or no `--name`, or a budget variable that is not a finite number of 0 or more | Check `bin/ui-draft write --help` |
| `model_error` | `claude` is missing, timed out, or returned no draft | Check that `claude` runs and is logged in, then retry |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
