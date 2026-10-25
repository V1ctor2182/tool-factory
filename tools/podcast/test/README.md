# podcast tests

`test.sh` serves `atoms/transcribe/test/fixtures/hello.aiff` from a local HTTP server, so the real `download` and `transcribe` atoms run with no internet. `claude` is a stub, so the run makes no paid call. A second pass copies `run` into a scratch repo whose atoms log their calls, to check `search` and that the atoms it calls are the manifest's `uses`.

The live episode for F5 lane 3 is Merriam-Webster's Word of the Day for "puissant", 104 seconds long, published 2026-10-24.

```
https://podcasts.apple.com/us/podcast/puissant/id164829166?i=1000797883796
```

yt-dlp reads it with its ApplePodcasts extractor and downloads a 2.3 MB MP3.
