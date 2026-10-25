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

Fixture. `atoms/transcribe/test/make-long-fixture.sh` speaks the first 1656 words of `ARCHITECTURE.md` with `say`, 608 seconds of audio. `say -f ARCHITECTURE.md` on the raw Markdown stops after 105 seconds, so the script removes the symbols first.

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

Word match is the share of the 1607 source words that `difflib.SequenceMatcher` aligns with the transcript, after lowercasing and removing punctuation. Most misses are the same on every backend. Speech synthesis says "atom" so that it sounds like "Adam", and it reads "CLI" as "clee".

Limiters, from `/usr/bin/time -l` on one cold run each.

- faster-whisper used 264.8 seconds of user CPU in 66.1 seconds of wall time, which is four threads kept busy. More threads were slower. A probe on a 107-second clip took 14.7 seconds at 4 threads, 16.1 at 8, and 21.3 at 10, because the extra threads land on efficiency cores.
- whisper.cpp used 5.5 seconds of user CPU in 16.5 seconds of wall time with `small`, and 4.8 in 30.4 with the default model in a separate run. The GPU does the work.
- A cached run reads one JSON file and hashes the input. It never loads a model. That is why it takes under 0.1 seconds for both backends.

The plan's budget fails a cold run over 300 seconds or a cached run over 1 second. The default passes both.

Stability. Three cold `srt` runs on `hello.aiff` gave the same bytes, and two cold runs on the 608-second fixture gave the same transcript. whisper.cpp runs beam search with five beams and no temperature fallback, and faster-whisper ran with `temperature=0.0`.

## What this costs

- The default weights are about 570 MB. The first call downloads them.
- The atom reads the detected language from `pywhispercpp`'s private `_ctx` attribute. The version stays below 2, and `test/test.sh` fails if the language goes missing.
- whisper.cpp on another Mac without Metal would fall back to the CPU. This repo serves one Mac.
- Not measured. faster-whisper with a large model, because on four CPU threads it would be slower than its `small` model, which already loses.

## Reproduce

Commit `481fa3d`, an early commit of PR 2, holds the faster-whisper version of the atom. These commands repeat round 2.

```sh
git worktree add /private/tmp/fw 481fa3d
RUNS=5 sh atoms/transcribe/test/bench.sh /private/tmp/fw/atoms/transcribe/bin/transcribe atoms/transcribe/bin/transcribe
```
