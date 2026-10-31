---
name: ui-catalog
description: List the UI components a site publishes through a shadcn registry, with each component's item URL. Use before ui-source when someone names a component site, such as kobra.systems or rareui.com, instead of one component.
---

# ui-catalog

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds each verb's inputs, and `bin/ui-catalog <verb> --help` prints them.

```sh
bin/ui-catalog registry https://kobra.systems --json
bin/ui-catalog registry https://ui.aceternity.com/registry.json --base https://ui.aceternity.com/registry/
bin/ui-catalog parse saved-registry.json --base https://kobra.systems/r/ --json
```

The result is a catalog, as `contracts/ui-catalog.schema.json` defines it. Without `--json` it prints one item URL per line, ready for `ui-source registry`.

`registry` takes a site URL and reads `<site>/r/registry.json`, or takes an index URL that ends in `.json`. Each `itemUrl` is `<folder>/<name>.json`, where the folder is the index's own folder unless `--base` names another. Aceternity serves its index at the site root and its items under `/registry/`, so it needs `--base`. `parse` reads an index file on disk and takes its folder from `--base`, else the index's `homepage` plus `/r/`.

Items keep the index's order. A name listed twice appears once. Every item type is kept, so filtering for `registry:ui` or `registry:block` is the caller's job.

Requests name the atom in the User-Agent, as `tool-factory/<atom>`. The atom is `observe`, so it never caches. Every call reads the index again and sets `cacheHit` to false.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | Not an http or https URL, or the response or file is not a registry index | Pass the site URL or its index URL |
| `invalid_args` | An unknown argument, or `parse` on an index with no `homepage` and no `--base` | Check `bin/ui-catalog <verb> --help` |
| `network_error` | The site could not be reached | Retry later |
| `unavailable` | The site answered with an HTTP error. The status is in the message | Report the message |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
