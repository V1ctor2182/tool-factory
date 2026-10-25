# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit", "faster-whisper", "av<19"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
# faster-whisper 1.2.1 passes an argument that PyAV 19 removed, so av stays below 19.
from pathlib import Path

from factory_kit import cli
from factory_kit.cache import Cache
from factory_kit.hash import file_sha256


def transcribe(path: str, model: str, language: str | None) -> dict:
    file = Path(path).expanduser().resolve()
    if not file.is_file():
        raise cli.AtomError("invalid_source", f"No such file: {path}")
    cache = Cache("transcribe")
    key = f"{file_sha256(file)}-{model}-{language or 'auto'}"
    if cached := cache.get(key):
        return {**cached, "source": str(file), "cacheHit": True}

    # Imported after the cache check because loading CTranslate2 and PyAV costs about a second.
    import av
    from faster_whisper import WhisperModel

    try:
        whisper = WhisperModel(model, device="cpu", compute_type="int8")
    except ValueError as e:
        raise cli.AtomError("invalid_args", str(e))
    try:
        raw, info = whisper.transcribe(str(file), language=language, temperature=0.0)
        segments = [
            {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in raw if s.text.strip()
        ]
    except av.error.InvalidDataError:
        raise cli.AtomError("invalid_source", f"Not an audio or video file: {path}")

    transcript = {
        "source": str(file),
        "method": "whisper",
        "language": info.language,
        "model": model,
        "text": " ".join(s["text"] for s in segments),
        "segments": segments,
        "cacheHit": False,
    }
    cache.put(key, transcript)
    return transcript


def _timestamp(seconds: float) -> str:
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def srt(transcript: dict) -> str:
    return "\n".join(
        f"{i}\n{_timestamp(s['start'])} --> {_timestamp(s['end'])}\n{s['text']}\n"
        for i, s in enumerate(transcript["segments"], 1)
    )


if __name__ == "__main__":
    cli.main(
        Path(__file__).resolve().parent.parent,
        {
            "file": cli.Verb(transcribe, lambda t: t["text"]),
            "srt": cli.Verb(transcribe, srt),
        },
    )
