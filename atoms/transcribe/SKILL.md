---
name: transcribe
description: Transcribe a local audio or video file to a timed transcript with whisper.cpp on this Mac's GPU. Use when no captions exist, or for a local recording. Prints plain text, SubRip subtitles, or JSON.
---

# transcribe

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds each verb's inputs, and `bin/transcribe <verb> --help` prints them.

```sh
bin/transcribe file recording.m4a --json
bin/transcribe file talk.mp4 --model small --language en --json
bin/transcribe srt recording.m4a > recording.srt
```

The result is a transcript, as `contracts/transcript.schema.json` defines it, with `method` set to `whisper`. `srt` prints SubRip text. Its `--json` output is the same transcript as `file`, plus an `srt` field that holds the SubRip text.

The default model is `large-v3-turbo-q5_0`. A ten-minute file takes about 30 seconds on this Mac, and `--model small` takes about 17. See `docs/decisions/0001-whisper-backend.md`. The first call with a new model downloads its weights from huggingface.co to `~/.cache/huggingface/`. The default weights are about 574 MB. The manifest lists them under `needs.models`, with a pattern for the weights of any other model. The atom checks the input file before it looks for weights, so a bad input fails without the network.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | The file is missing or is not audio or video | Pass an audio or video file |
| `invalid_args` | An unknown model name, or a missing or unknown argument | Pick a model from huggingface.co/ggerganov/whisper.cpp |
| `network_error` | The weights are not on disk and huggingface.co could not be reached | Retry online once, after which the weights stay on disk |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |

A second call on a file with the same content, model, and language reads the cache and sets `cacheHit` to true.
