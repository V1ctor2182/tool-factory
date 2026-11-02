---
name: find-url
description: Find video URLs from search words, a playlist, or a channel. Use before captions or download when someone names a topic or a list instead of one video. Works on any site yt-dlp supports.
---

# find-url

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds each verb's inputs, and `bin/find-url <verb> --help` prints them.

```sh
bin/find-url search "me at the zoo" --limit 3 --json
bin/find-url list "https://www.youtube.com/playlist?list=PLZHQObOWTQDMsr9K-rj53DwVRMYO3t5Yr" --json
bin/find-url list "https://www.youtube.com/@3blue1brown" --limit 10
bin/find-url parse saved-flat-playlist.json --json
```

The result is a URL list, as `contracts/url-list.schema.json` defines it. Without `--json` it prints one URL per line.

`search` uses the yt-dlp search prefix in `--site`, `ytsearch` by default. `list` takes a playlist or channel URL. A channel lists each of its tabs in order, such as videos, then live, then shorts. `parse` reads a file that `yt-dlp -J --flat-playlist` wrote.

The atom is `observe`, so it never caches. Every call reads the site again and sets `cacheHit` to false. It needs node 22 or newer as the first `node` on `PATH`, as `captions` does.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | Not an http or https URL, one video instead of a list, an unsupported URL, or for `parse` a file that is not a flat playlist | Pass a playlist or channel URL, or call `captions` on one video |
| `invalid_args` | Empty search words, a `--limit` below 1, or an unknown argument | Check `bin/find-url <verb> --help` |
| `network_error` | The site could not be reached | Retry later |
| `unavailable` | The site refused the list, for example a private playlist | Report the message |
| `rate_limited` | The site answered HTTP 429 | Retry later |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
