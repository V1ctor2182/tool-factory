---
name: page-links
description: List the same-origin links a web page shows once it has rendered in headless Chromium, in document order, optionally only those whose path matches a pattern. Use to find a site's component pages from its catalog page, such as kobra.systems/components, when the links are drawn by script.
---

# page-links

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds the verb's inputs, and `bin/page-links list --help` prints them.

```sh
bin/page-links list https://kobra.systems/components --match '^/components/[^/]+/?$' --json
bin/page-links list https://ui.aceternity.com/components
```

The result is a list of links, as `contracts/page-links.schema.json` defines it. Without `--json` it prints one URL per line.

`list` loads the page in headless Chromium, waits until the network has been idle for 500 ms, and reads every `a[href]` in document order. It keeps a link when its scheme and host match the page it landed on, after any redirect. It drops each URL's fragment and keeps the first occurrence of each URL, with that link's rendered text, whitespace collapsed. An icon link has empty text. `--match` is a Python regular expression searched in the link's path, without the query.

The atom is `observe`, so it never caches. Kobra's catalog listed 89 component pages on 2026-11-03.

It never tries to get past a bot check. On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `blocked` | The page shows a bot check, such as a Cloudflare challenge | Stop. Open the page yourself |
| `rate_limited` | The page answered HTTP 429 | Stop and retry much later |
| `unavailable` | The page answered another HTTP error, or Chromium is missing. The message says which | For Chromium, run the command in the message |
| `network_error` | The page could not be reached or never went idle within 45 s | Retry later |
| `invalid_source` | The URL is not http, https, or file | Pass a page URL |
| `invalid_args` | `--match` is not a regular expression | Fix the pattern |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
