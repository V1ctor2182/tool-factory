# captions tests

`test.sh` runs offline. It parses `fixtures/jNQXAC9IVRw.en.json3`, the English captions of "Me at the zoo" recorded with yt-dlp on 2026-10-25, and checks the transcript schema, the first segment, and the whole output against `expected/jNQXAC9IVRw.en.json`.

Live checks use two public YouTube videos.

| Video | Captions | Expected result of `captions get` |
|---|---|---|
| `jNQXAC9IVRw`, "Me at the zoo", 19 seconds | Uploaded English and German | A transcript with `method` set to `captions` |
| `7VE8U3Z_av8`, a poem read aloud, 132 seconds | None, uploaded or automatic, checked 2026-10-25 | Exit 1 with the error code `no_captions` |

`7VE8U3Z_av8` has speech, so the YouTube tool's fallback to `download` and `transcribe` gets words to transcribe. If YouTube adds automatic captions to it later, pick another video that `yt-dlp --list-subs` shows with no tracks and update this table.
