# /// script
# requires-python = ">=3.12"
# dependencies = ["faster-whisper==1.2.1", "av<19"]
# ///
import json
import sys

from faster_whisper import WhisperModel

whisper = WhisperModel("small", device="cpu", compute_type="int8", cpu_threads=4)
segments, _ = whisper.transcribe(sys.argv[1], temperature=0.0)
print(json.dumps({"text": " ".join(s.text.strip() for s in segments if s.text.strip())}))
