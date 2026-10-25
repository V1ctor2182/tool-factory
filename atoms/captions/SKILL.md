---
name: captions
description: Get the published captions of a video URL as a timed transcript. Use before transcribing audio, since captions are faster and free. Works on any site yt-dlp supports.
---

# captions

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds each verb's inputs, and `bin/captions <verb> --help` prints them.

```sh
bin/captions get "https://www.youtube.com/watch?v=jNQXAC9IVRw" --json
bin/captions get "<url>" --lang de --json
bin/captions parse saved.en.json3 --json
```

The result is a transcript, as `contracts/transcript.schema.json` defines it, with `method` set to `captions`. Uploaded captions win over automatic ones.

It needs node 22 or newer as the first `node` on `PATH`. yt-dlp runs the site's player code in node. With an older node it only logs a warning, and some videos or formats go missing.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `no_captions` | The video has no captions in that language | Run `download get <url> --audio`, then `transcribe file <path>` |
| `invalid_source` | Not an http or https URL, an unsupported URL, a playlist, or for `parse` a missing or unreadable file | Pass one video URL or one json3 file |
| `network_error` | The site could not be reached | Retry later |
| `unavailable` | The site refused the video, for example a private or removed one | Report the message |
| `invalid_args` | A missing or unknown argument | Check `bin/captions <verb> --help` |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |

A second `get` for the same video and language, or a second `parse` of a file with the same content and language, reads the cache and sets `cacheHit` to true.
