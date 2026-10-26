# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from factory_kit import cli, paths
from factory_kit.cache import Cache
from factory_kit.hash import file_sha256

PTS_TIME = re.compile(r"\] n:\s*\d+ .*?pts_time:(\S+)")


def _extract(video: Path, threshold: float, into: Path) -> list[float]:
    select = f"select='eq(n\\,0)+gt(scene\\,{threshold})',showinfo"
    command = [
        "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "info", "-i", str(video),
        "-vf", select, "-fps_mode", "vfr", "-q:v", "3", str(into / "frame-%04d.jpg"),
    ]
    try:
        done = subprocess.run(command, capture_output=True, text=True)
    except FileNotFoundError:
        raise cli.AtomError("missing_bin", "ffmpeg is not on PATH.")
    if done.returncode != 0:
        last = done.stderr.strip().splitlines()[-1:] or [""]
        raise cli.AtomError("invalid_source", f"ffmpeg could not read a video stream from {video}: {last[0]}")
    return [round(float(t), 3) for t in PTS_TIME.findall(done.stderr)]


def get(video: str, threshold: float) -> dict:
    if not 0 <= threshold <= 1:
        raise cli.AtomError("invalid_args", f"--threshold must be from 0 to 1, not {threshold}.")
    file = Path(video).expanduser().resolve()
    if not file.is_file():
        raise cli.AtomError("invalid_source", f"Not a file: {video}")
    key = f"{file_sha256(file)}-{threshold}"
    cache = Cache("frames")
    if (cached := cache.get(key)) and all(Path(f["path"]).is_file() for f in cached["frames"]):
        return {**cached, "source": str(file)}
    staging = Path(tempfile.mkdtemp(dir=paths.atom_dir("frames", "tmp")))
    try:
        times = _extract(file, threshold, staging)
        images = sorted(staging.glob("frame-*.jpg"))
        if not images or len(images) != len(times):
            raise cli.AtomError("invalid_source", f"ffmpeg wrote {len(images)} frames and logged {len(times)} times for {video}")
        final = paths.atom_dir("frames", "files") / key
        shutil.rmtree(final, ignore_errors=True)
        staging.rename(final)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    frame_set = {
        "source": str(file),
        "threshold": threshold,
        "frames": [{"time": t, "path": str(final / image.name)} for t, image in zip(times, images)],
    }
    cache.put(key, frame_set)
    return frame_set


def _text(frame_set: dict) -> str:
    return "\n".join(f"{f['time']:.3f}  {f['path']}" for f in frame_set["frames"])


if __name__ == "__main__":
    cli.main(Path(__file__).resolve().parent.parent, {"get": cli.Verb(get, _text)})
