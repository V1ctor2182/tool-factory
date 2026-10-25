---
name: youtube
description: Summarize a YouTube video, or any video URL yt-dlp supports, from its transcript. Use when someone asks what a video says, wants its summary or chapters, or wants its transcript.
allowed-tools: Bash(*youtube/run *)
---

# youtube

Get the transcript with the `run` script in this skill's folder, then write the summary yourself. You are the model, so do not call the `digest` atom.

```sh
<this skill's folder>/run "https://www.youtube.com/watch?v=jNQXAC9IVRw" --no-digest
```

It prints one transcript line per caption or speech segment, each starting with its time as `[m:ss]`. It tries the video's captions first. When the video has none, it downloads the audio and transcribes it on this Mac, which takes about 30 seconds for a ten-minute video. Progress lines go to stderr.

With `--json` it prints the transcript as `contracts/transcript.schema.json` defines it. Its `method` is `captions` or `whisper`.

Then answer from the transcript.

- A summary of what the video says, in a short paragraph.
- Chapters with their `m:ss` start times, taken from the transcript lines.
- The key points, if the person asked for detail.

Without `--no-digest` the script also calls the `digest` atom, a paid model call. Victor uses that form in a terminal. An agent never needs it.

On failure the script exits 1. With `--json` it prints `{"error": {"code", "message"}}`, otherwise the code and message go to stderr.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | Not an http or https URL, an unsupported URL, or a playlist | Ask for one video URL |
| `network_error` | The site could not be reached | Retry later |
| `unavailable` | The site refused the video, for example a private or removed one | Report the message |
| `invalid_args` | A missing or unknown argument | Check `run --help` |
| `budget_exceeded` | Only without `--no-digest`. Today's model spend reached the budget | Use `--no-digest` and summarize yourself |
| `internal` | A bug in an atom. The traceback is on stderr | Report the message and the traceback |
