---
name: download
description: Download the audio or video of a video URL to a local file. Use when an atom needs the media itself, such as transcribe for a video with no captions. Works on any site yt-dlp supports.
---

# download

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds each verb's inputs, and `bin/download get --help` prints them.

```sh
bin/download get "https://www.youtube.com/watch?v=jNQXAC9IVRw" --audio --json
bin/download get "<url>" --video --json
```

The result is a media record, as `contracts/media.schema.json` defines it. `path` is an absolute path under `$TOOL_FACTORY_HOME/download/files/`. Audio is the default. Video is one file with both streams, so it may be lower resolution than the site's best.

It needs node 22 or newer as the first `node` on `PATH`. yt-dlp runs the site's player code in node. With an older node it only logs a warning, and some videos or formats go missing.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`. The codes are `invalid_source`, `invalid_args`, `network_error`, and `unavailable`, with the same meanings as in the captions atom.

A second call for the same video and kind returns the same path with `cacheHit` set to true, and downloads nothing.
