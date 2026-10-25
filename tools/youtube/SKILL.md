---
name: youtube
description: Summarize a YouTube video, or any video URL yt-dlp supports, from its transcript. Use when someone asks what a video says, wants its summary or chapters, or wants its transcript. Also digests a search, a playlist, or a channel, and notes what appears on screen.
allowed-tools: Bash(*youtube/run *)
---

# youtube

Get the transcript with the `run` script in this skill's folder, then write the summary yourself. You are the model, so do not call the `digest` atom.

```sh
<this skill's folder>/run transcript "https://www.youtube.com/watch?v=jNQXAC9IVRw"
```

It prints one transcript line per caption or speech segment, each starting with its time as `[m:ss]`. It tries the video's captions first. When the video has none, it downloads the audio and transcribes it on this Mac, which takes about 30 seconds for a ten-minute video. Progress lines go to stderr.

With `--json` it prints the transcript as `contracts/transcript.schema.json` defines it. Its `method` is `captions` or `whisper`.

Then answer from the transcript.

- A summary of what the video says, in a short paragraph.
- Chapters with their `m:ss` start times, taken from the transcript lines.
- The key points, if the person asked for detail.

The `get` verb, which `run <video url>` also means, calls the `digest` atom instead, a paid model call. Victor uses that form in a terminal. An agent needs it only for `--visual`. `run <url> --no-digest` is the same as `run transcript <url>`.

`get <video url> --visual` also downloads the video, picks up to 8 key frames with the `frames` atom, and describes them with the `see` atom, a paid haiku call of well under one cent a frame. The digest then has a `visual` field with one note per frame and its start time. Use it only when the person asks what the video shows. `transcript` does not take `--visual`.

The `search` verb, which `run <words>` and `run <playlist or channel url>` also mean, digests several videos, one paid model call each.

```sh
<this skill's folder>/run search "me at the zoo" --limit 2 --json
<this skill's folder>/run search "https://www.youtube.com/playlist?list=PLZHQObOWTQDMsr9K-rj53DwVRMYO3t5Yr" --limit 3 --json
```

Search words take the top result, or `--limit` results. A playlist or channel takes every video, or stops after `--limit`. With `--json` it prints one digest list, as `contracts/digest-list.schema.json` defines it: `items` holds the digests and `failed` holds each video that failed with its error. It exits 0 when at least one video has a digest. Without `--json`, each video starts with a `# <title>` line and its URL.

On failure the script exits 1. With `--json` it prints `{"error": {"code", "message"}}`, otherwise the code and message go to stderr.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | Not an http or https URL, or an unsupported URL | Ask for a video URL, a playlist, or search words |
| `no_results` | Only from `search`. The words, playlist, or channel found no videos | Try other words or another list |
| `network_error` | The site could not be reached | Retry later |
| `unavailable` | The site refused the video, for example a private or removed one | Report the message |
| `invalid_args` | A missing or unknown argument, such as `--visual` with `--no-digest` | Check `run --help` |
| `budget_exceeded` | Only from `get` and `search`. Today's model spend reached the budget | Use `transcript` and summarize yourself |
| `internal` | A bug in an atom. The traceback is on stderr | Report the message and the traceback |
