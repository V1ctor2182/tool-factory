---
name: transcribe
description: Transcribe a local audio or video file to a timed transcript with faster-whisper on this Mac. Use when no captions exist, or for a local recording. Prints plain text, SubRip subtitles, or JSON.
---

# transcribe

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds each verb's inputs, and `bin/transcribe <verb> --help` prints them.

```sh
bin/transcribe file recording.m4a --json
bin/transcribe file talk.mp4 --model tiny --language en --json
bin/transcribe srt recording.m4a > recording.srt
```

The result is a transcript, as `contracts/transcript.schema.json` defines it, with `method` set to `whisper`. `srt` prints SubRip text, and its `--json` output is the same transcript as `file`.

The default model is `small`. A ten-minute file takes about a minute on this Mac. See `docs/decisions/0001-whisper-backend.md`. The first call with a new model downloads its weights to `~/.cache/huggingface/`.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`. `invalid_source` means the file is missing or is not audio or video. `invalid_args` means an unknown model name.

A second call on a file with the same content, model, and language reads the cache and sets `cacheHit` to true.
