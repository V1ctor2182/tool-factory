---
name: meeting-notes
description: Summarize a local meeting recording, call, voice memo, or any audio or video file on this Mac. Use when someone asks what was said in a recording, wants meeting notes, chapters, action items, or a transcript of a local file.
allowed-tools: Bash(*meeting-notes/run *)
---

# meeting-notes

Get the transcript with the `run` script in this skill's folder, then write the notes yourself. You are the model, so do not call the `digest` atom.

```sh
<this skill's folder>/run transcript ~/Downloads/standup.m4a
<this skill's folder>/run transcript ~/Downloads/standup.m4a --language de
```

It prints one transcript line per speech segment, each starting with its time as `[m:ss]`. The `transcribe` atom makes it on this Mac with whisper.cpp, which takes about 30 seconds for a ten-minute recording. A second run on the same file reads the cache. Progress lines go to stderr. `--language` takes a code such as `en`, and the language is detected when it is left out.

With `--json` it prints the transcript as `contracts/transcript.schema.json` defines it.

Then answer from the transcript.

- A summary of what the meeting covered, in a short paragraph.
- Chapters with their `m:ss` start times, taken from the transcript lines.
- Decisions and action items with their owners, when the transcript names them.

The `get` verb, which `run <file>` also means, calls the `digest` atom instead, a paid model call. Victor uses that form in a terminal and in scripts. An agent does not need it.

On failure the script exits 1. With `--json` it prints `{"error": {"code", "message"}}`, otherwise the code and message go to stderr.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | The file is missing or is not audio or video | Ask for the path of an audio or video file |
| `invalid_args` | A missing or unknown argument | Check `run --help` |
| `network_error` | The speech model weights are not on disk and huggingface.co could not be reached | Retry online once |
| `budget_exceeded` | Only from `get`. Today's model spend reached the budget | Use `transcript` and summarize yourself |
| `internal` | A bug in an atom. The traceback is on stderr | Report the message and the traceback |
