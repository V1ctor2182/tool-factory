# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "pywhispercpp>=1.5,<2", "av", "numpy", "huggingface-hub"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
from pathlib import Path

from factory_kit import cli
from factory_kit.cache import Cache
from factory_kit.hash import file_sha256

RATE = 16000


def _audio(file: Path):
    import av
    import numpy as np

    resampler = av.AudioResampler(format="flt", layout="mono", rate=RATE)
    chunks = []
    try:
        with av.open(str(file)) as container:
            stream = container.streams.audio[0]
            # PyAV 18 keeps the AAC encoder's end padding, so the stream's duration is the media's length.
            samples = int(stream.duration * stream.time_base * RATE) if stream.duration else None
            for frame in container.decode(stream):
                chunks += [f.to_ndarray().reshape(-1) for f in resampler.resample(frame)]
        chunks += [f.to_ndarray().reshape(-1) for f in resampler.resample(None)]
    except (av.error.InvalidDataError, IndexError):
        raise cli.AtomError("invalid_source", f"Not an audio or video file: {file}")
    audio = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)
    return audio[:samples]


def _weights(model: str) -> str:
    from huggingface_hub import hf_hub_download
    from huggingface_hub.errors import EntryNotFoundError, LocalEntryNotFoundError

    try:
        return hf_hub_download("ggerganov/whisper.cpp", f"ggml-{model}.bin")
    except LocalEntryNotFoundError as e:
        raise cli.AtomError("network_error", f"Could not download the {model} weights: {e}")
    except EntryNotFoundError:
        raise cli.AtomError("invalid_args", f"Unknown whisper.cpp model: {model}")


def _whisper(file: Path, model: str, language: str | None) -> dict:
    import _pywhispercpp
    from pywhispercpp.model import Model

    audio = _audio(file)
    weights = _weights(model)
    whisper = Model(
        weights,
        params_sampling_strategy=1,
        beam_search={"beam_size": 5, "patience": -1.0},
        temperature_inc=0.0,
        language=language or "auto",
        print_progress=False,
        print_realtime=False,
        print_timestamps=False,
        redirect_whispercpp_logs_to=None,
    )
    end_cs = len(audio) * 100 // RATE
    segments = [
        {"start": s.t0 / 100, "end": min(s.t1, end_cs) / 100, "text": s.text.strip()}
        for s in whisper.transcribe(audio)
        if s.text.strip() and s.t0 < end_cs
    ]
    detected = _pywhispercpp.whisper_lang_str(_pywhispercpp.whisper_full_lang_id(whisper._ctx))
    return {
        "source": str(file),
        "method": "whisper",
        "language": language or detected,
        "model": model,
        "text": " ".join(s["text"] for s in segments),
        "segments": segments,
    }


def transcribe(path: str, model: str, language: str | None) -> dict:
    file = cli.existing_file(path)
    if language == "auto":
        language = None
    cache = Cache("transcribe")
    key = f"{file_sha256(file)}-whispercpp-{model}-{language or 'auto'}"
    if cached := cache.get(key):
        return {**cached, "source": str(file)}
    transcript = _whisper(file, model, language)
    cache.put(key, transcript)
    return transcript


def _timestamp(seconds: float) -> str:
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def subtitles(path: str, model: str, language: str | None) -> dict:
    transcript = transcribe(path, model, language)
    srt = "\n".join(
        f"{i}\n{_timestamp(s['start'])} --> {_timestamp(s['end'])}\n{s['text']}\n"
        for i, s in enumerate(transcript["segments"], 1)
    )
    return {**transcript, "srt": srt}


if __name__ == "__main__":
    cli.main(
        Path(__file__).resolve().parent.parent,
        {
            "file": cli.Verb(transcribe),
            "srt": cli.Verb(subtitles, lambda result: result["srt"]),
        },
    )
