---
name: podcast
description: Summarize a podcast episode from its Apple Podcasts, SoundCloud, or other page URL, or find episodes from search words. Use when someone asks what an episode says, wants its summary, chapters, or transcript, or wants episodes about a topic summarized.
allowed-tools: Bash(*podcast/run *) Bash(*atoms/find-url/bin/find-url *)
---

# podcast

Get the transcript with the `run` script in this skill's folder, then write the summary yourself. You are the model, so do not call the `digest` atom.

```sh
<this skill's folder>/run transcript "https://podcasts.apple.com/us/podcast/puissant/id164829166?i=1000797883796"
```

It downloads the episode audio with the `download` atom and transcribes it on this Mac with the `transcribe` atom, which takes about 30 seconds for ten minutes of audio. A second run on the same episode reads both caches. It prints one transcript line per speech segment, each starting with its time as `[m:ss]`. Progress lines go to stderr. The URL can be any episode page or audio file URL yt-dlp supports.

With `--json` it prints the transcript as `contracts/transcript.schema.json` defines it.

Then answer from the transcript.

- A summary of what the episode says, in a short paragraph. Skip the ads.
- Chapters with their `m:ss` start times, taken from the transcript lines.
- The key points, if the person asked for detail.

To find an episode from words, run the `find-url` atom, two folders up from this skill's folder, with `--json`, then run `transcript` on the one the person wants. It prints each match's title, URL, and duration, as `contracts/url-list.schema.json` defines them, and makes no model call. Without `--json` it prints only the URLs.

```sh
<this skill's folder>/../../atoms/find-url/bin/find-url search "word of the day puissant" --limit 3 --json
```

The `get` verb, which `run <episode url>` also means, calls the `digest` atom instead, a paid model call. The `search` verb, which `run <words>` also means, digests each episode the words find, one paid model call each. `--limit` sets how many results to take, 1 by default, and `--site` sets the yt-dlp search prefix, `ytsearch` by default or `scsearch` for SoundCloud. With `--json` it prints one digest list, as `contracts/digest-list.schema.json` defines it, with `failed` listing each episode that failed. Victor uses `get` and `search` in a terminal. An agent does not need them.

On failure the script exits 1. With `--json` it prints `{"error": {"code", "message"}}`, otherwise the code and message go to stderr.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | Not an http or https URL, or a URL yt-dlp does not support | Ask for an episode URL or search words |
| `no_results` | Only from `search`. The words found no episodes | Try other words or another `--site` |
| `network_error` | The site could not be reached | Retry later |
| `unavailable` | The site refused the episode, for example a removed one | Report the message |
| `rate_limited` | The site answered HTTP 429 | Retry later |
| `invalid_args` | A missing or unknown argument | Check `run --help` |
| `budget_exceeded` | Only from `get` and `search`. Today's model spend reached the budget | Use `transcript` and summarize yourself |
| `internal` | A bug in an atom. The traceback is on stderr | Report the message and the traceback |
