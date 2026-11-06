---
name: page-bundle
description: Download the files a web page ships and read its stack, source modules, keys, storage keys, design tokens, motion, fonts, and assets without running it. Use first when cloning or studying a site, before recording or clicking through it.
---

# page-bundle

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds each verb's inputs, and `bin/page-bundle <verb> --help` prints them.

```sh
bin/page-bundle fetch https://quorum.elianiva.com/ --json
bin/page-bundle fetch https://quorum.elianiva.com/
bin/page-bundle parse ~/.local/share/tool-factory/page-bundle/quorum.elianiva.com --json
```

The result is a page bundle, as `contracts/page-bundle.schema.json` defines it. Without `--json` the CLI prints each stack entry as `layer name`, one per line.

`fetch` downloads the page as `index.html`, then its same-origin scripts, stylesheets, and modulepreloads, the chunks those scripts import, and their source maps. It stops at 80 files and skips any file over 20 MB or any file the site will not serve. Files land at their URL paths under `page-bundle/<host>/` in the data home, which each successful call empties and refills. Google Fonts stylesheets are not downloaded, but their families appear in `fonts`. `parse` reads a folder already on disk the same way, starting from its `index.html`.

Every fact comes from reading text. Nothing runs. `stack` lists each library whose signature matched, with the matched text and file as evidence. `routes` and `keys` are candidates, so a keys list from a big bundle holds labels from other switches too. Routes a router builds from bare segments do not appear. `modules` comes from source paths in the bundle and its maps, and `names` from `path#Name` trace tags, which most minified sites strip. A storage key passed as a variable resolves only when that variable is only ever assigned a string literal.

Requests name the atom in the User-Agent, as `tool-factory/page-bundle`. The page request asks for `text/html`, so a host such as Cloudflare injects the same beacon a browser gets. The atom is `observe`, so it never caches and sets `cacheHit` to false.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | Not an http or https URL, a folder without `index.html`, or a source map that is not JSON | Pass a page URL or a folder from an earlier fetch |
| `invalid_args` | An unknown argument | Check `bin/page-bundle <verb> --help` |
| `network_error` | The page could not be reached | Retry later |
| `unavailable` | The page answered with an HTTP error. The status is in the message | Check the URL |
| `rate_limited` | The page answered HTTP 429 | Retry later |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
