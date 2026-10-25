---
name: frames
description: Pick the key frames of a local video file, the first frame plus one at each scene change, with their timestamps. Use before see when someone wants to know what a video shows.
---

# frames

Run the CLI. It prints one JSON object with `--json`. `manifest.json` holds the verb's inputs, and `bin/frames get --help` prints them.

```sh
bin/frames get video.mp4 --json
bin/frames get video.mp4 --threshold 0.2
```

The result is a frame set, as `contracts/frame-set.schema.json` defines it. Each frame is a JPEG in the data home with its time in seconds. Without `--json` it prints one time and path per line.

It runs ffmpeg's `select` filter with the scene score. `--threshold` is the score from 0 to 1 above which a frame starts a new scene, 0.3 by default. A lower threshold finds more frames. The first frame is always in the set. It needs `ffmpeg` on `PATH`.

A second call on a file with the same bytes and the same threshold reads the cache and sets `cacheHit` to true. If a frame file is gone, the atom runs ffmpeg again.

On failure the CLI exits 1 and prints `{"error": {"code", "message"}}`.

| Code | Meaning | What to do |
|---|---|---|
| `invalid_source` | The file is missing or ffmpeg finds no video in it | Pass a video file, such as the path `download get <url> --video` prints |
| `invalid_args` | A threshold outside 0 to 1, or an unknown argument | Check `bin/frames get --help` |
| `missing_bin` | `ffmpeg` is not on `PATH` | Install ffmpeg |
| `internal` | A bug in the atom. The traceback is on stderr | Report the message and the traceback |
