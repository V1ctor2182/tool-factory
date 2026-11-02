---
name: ui-source
description: Fetch one UI component's shadcn registry item and tell whether its source code is exposed. Use after ui-catalog lists a site's components, or when someone gives a registry item URL.
---

# ui-source

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds each verb's inputs, and `bin/ui-source <verb> --help` prints them.

```sh
bin/ui-source registry https://kobra.systems/r/input-otp.json --json
bin/ui-source registry https://kobra.systems/r/input-otp.json
bin/ui-source parse saved-item.json --json
```

The result is a UI source, as `contracts/ui-source.schema.json` defines it. `item` is the registry item exactly as the site serves it, so shadcn's registry-item schema describes its fields. Each entry in `item.files` holds a `path` and, when exposed, its `content`.

`exposed` is true when `files` is non-empty and every file carries its content. Some sites serve paid items with `files` empty, and those come back with `exposed` false. A site that answers HTTP 401 for an item, as Kobra does for a Pro item, also gives `exposed` false, with `item` null. It is a locked component, so the call succeeds and the run log does not count it as a failure. Without `--json` the CLI prints each file path on its own line, or nothing when the item is not exposed.

Requests name the atom in the User-Agent, as `tool-factory/<atom>`. The atom is `observe`, so it never caches. Every call reads the item again and sets `cacheHit` to false.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | Not an http or https URL, or the response or file is not a registry item with a `name` and `files` | Pass an item URL from `ui-catalog` |
| `invalid_args` | An unknown argument | Check `bin/ui-source <verb> --help` |
| `network_error` | The site could not be reached | Retry later |
| `unavailable` | The site answered with an HTTP error other than 401. The status is in the message | Report it |
| `rate_limited` | The site answered HTTP 429 | Retry later |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
