# 0001. Transcribe with whisper.cpp, not faster-whisper

Date 2026-10-25. Status accepted. Decided in F1 of `docs/plans/factory-v1.md`.

## Decision

The `transcribe` atom runs whisper.cpp through the `pywhispercpp` Python package, with the `large-v3-turbo-q5_0` model by default. PyAV decodes the input, so the atom needs no ffmpeg. Weights download once from `huggingface.co/ggerganov/whisper.cpp` into `~/.cache/huggingface/`.

On this Mac, a ten-minute file takes about 30 seconds with the default model. faster-whisper with the `small` model takes about 65 seconds and matches fewer words.

## Why

faster-whisper runs on the CPU only. CTranslate2 has no Metal backend, so on Apple silicon it is bound by four CPU threads. whisper.cpp runs the model on the Metal GPU and leaves the CPU almost idle.

The faster backend buys a bigger model. whisper.cpp with `large-v3-turbo-q5_0` is twice as fast as faster-whisper with `small`, and it matches slightly more of the source text. whisper.cpp with `small` is four times as fast but matches about five points fewer words, so it stays an option through `--model small`, not the default.

Both packages install through `uv` with no system change. `pywhispercpp` 1.5.1 ships a macOS arm64 wheel with Metal. faster-whisper also needs PyAV pinned below 19, which this choice drops.

## Measurements

Machine. Apple M5, 4 performance and 6 efficiency cores, macOS 26.5. Load average was between 3.9 and 6.7 during the runs, from other work on the Mac. The rounds alternate between backends, so that load hits both sides.

Fixture. `atoms/transcribe/test/make-long-fixture.sh` speaks the first 1655 words of `ARCHITECTURE.md` with `say`, 608 seconds of audio. `say -f ARCHITECTURE.md` on the raw Markdown stops after 105 seconds, so the script removes the symbols first.

Two runs of the script on 2026-10-25 gave the same file, 26836910 bytes.

Probe. `atoms/transcribe/test/bench.sh` runs `/usr/bin/time -p` around `bin/transcribe file <fixture> --json`, once cold in a fresh data home and once cached, for each backend in turn. Model weights were already downloaded, so "cold" means a cache miss with the weights on disk. Every cold run reported `cacheHit` false and every cached run reported true.

Round 1 compares the backends on the same model, `small`, five rounds.

| Backend | Cold median | Cold range | Cached range | Word match |
|---|---|---|---|---|
| faster-whisper 1.2.1, `small`, int8, 4 threads | 64.6 s | 63.7 to 74.2 s | 0.06 to 0.08 s | 93.1 % |
| whisper.cpp through pywhispercpp 1.5.1, `small`, Metal | 16.5 s | 16.5 to 16.6 s | 0.05 to 0.06 s | 87.9 % |

Round 2 compares faster-whisper `small` with the shipped default, five rounds.

| Backend | Cold median | Cold range | Cached range | Word match |
|---|---|---|---|---|
| faster-whisper 1.2.1, `small` | 65.6 s | 65.2 to 66.8 s | 0.06 to 0.08 s | 93.1 % |
| whisper.cpp, `large-v3-turbo-q5_0` | 30.7 s | 30.6 to 31.0 s | 0.06 s | 93.9 % |

Word match is the share of the 1607 source words that `difflib.SequenceMatcher(autojunk=False)` aligns with the transcript. Both sides are lowercased, and every character other than a letter, digit, or space becomes a space. `0001-whisper-backend/score.py` computes it. With the default `autojunk=True`, the same transcripts score 92.7 % for faster-whisper `small`, 87.3 % for whisper.cpp `small`, and 93.8 % for the default model. Most misses are the same on every backend. Speech synthesis says "atom" so that it sounds like "Adam", and it reads "CLI" as "clee".

Limiters, from one cold run each. `/usr/bin/time -l` timed the whisper.cpp `small` run. `/usr/bin/time -p` timed the others.

- faster-whisper used 261.6 seconds of user CPU in 73.4 seconds of wall time, about 3.6 of its four threads kept busy. This is one round of `0001-whisper-backend/bench.sh`, on 2026-10-25 at load average 4.0 to 4.9, and the wall time includes uv start and model load.
- whisper.cpp used 5.5 seconds of user CPU in 16.5 seconds of wall time with `small`, and 4.8 in 30.5 with the default model in a separate run. The same bench round measured 4.8 in 30.7. The GPU does the work.
- A cached run reads one JSON file and hashes the input. It never loads a model. That is why it takes under 0.1 seconds for both backends.

The plan's budget fails a cold run over 300 seconds or a cached run over 1 second. The default passes both.

Stability. `atoms/transcribe/test/test.sh` compares a cold `srt` run on `hello.aiff` with `expected/hello.srt` byte for byte on every run. Two cold runs on the same 608-second fixture file gave the same transcript, byte for byte. To check, make an empty directory and run `BENCH_OUT=<dir> RUNS=1 sh atoms/transcribe/test/bench.sh atoms/transcribe/bin/transcribe atoms/transcribe/bin/transcribe`, then `cmp` the two `transcript-*.json` files in it. whisper.cpp runs beam search with five beams and no temperature fallback, and faster-whisper ran with `temperature=0.0`.

## What this costs

- The default weights are about 574 MB. The first call downloads them, and `needs.models` in the manifest declares them.
- The atom reads the detected language from `pywhispercpp`'s private `_ctx` attribute. The version stays below 2, and `test/test.sh` fails if the language goes missing.
- whisper.cpp on another Mac without Metal would fall back to the CPU. This repo serves one Mac.
- Not measured. faster-whisper with a large model, because on four CPU threads it would be slower than its `small` model, which already loses.

## Reproduce

`0001-whisper-backend/` holds the scripts. `faster_whisper_small.py` runs faster-whisper 1.2.1 with the round 1 and 2 settings, `small`, int8, four threads, and temperature 0. `bench.sh` makes the fixture, then times one faster-whisper run and one cold atom run per round, and scores every transcript with `score.py`.

```sh
RUNS=5 sh docs/decisions/0001-whisper-backend/bench.sh /private/tmp/whisper-bench
RUNS=5 MODEL=small sh docs/decisions/0001-whisper-backend/bench.sh /private/tmp/whisper-bench-small
```

The first command runs round 2's pair of backends, and the second runs round 1's. Rounds 1 and 2 ran faster-whisper through an earlier version of the atom. The committed script runs it directly. One round of the first, run on 2026-10-25, gave 73.4 s and 93.1 % for faster-whisper and 30.7 s and 93.9 % for whisper.cpp. The 73.4 s falls outside round 2's range of 65.2 to 66.8 s. The cause is not measured. Both the load on the Mac and the way faster-whisper starts differed from round 2.
