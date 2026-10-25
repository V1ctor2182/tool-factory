# /// script
# requires-python = ">=3.12"
# dependencies = ["factory-kit[ytdlp]"]
# [tool.uv.sources]
# factory-kit = { path = "../../../kit/py", editable = true }
# ///
from pathlib import Path

from factory_kit import cli, paths, ytdlp
from factory_kit.cache import Cache

# Single-file formats only, so no download needs ffmpeg to merge streams.
FORMATS = {"audio": "bestaudio[ext=m4a]/bestaudio/best", "video": "best[ext=mp4]/best"}


def get(url: str, audio: bool, video: bool) -> dict:
    if audio and video:
        raise cli.AtomError("invalid_args", "Pass --audio or --video, not both.")
    kind = "video" if video else "audio"

    def fetch(ydl, info):
        info = ydl.process_ie_result(info, download=True)
        return {
            "source": url,
            "path": info["requested_downloads"][0]["filepath"],
            "kind": kind,
            "extractor": info["extractor_key"],
            "id": info["id"],
            "title": info.get("title"),
            "durationSec": info.get("duration"),
        }

    return ytdlp.cached(
        Cache("download"),
        url,
        kind,
        fetch,
        usable=lambda media: Path(media["path"]).is_file(),
        format=FORMATS[kind],
        paths={"home": str(paths.atom_dir("download", "files")), "temp": str(paths.atom_dir("download", "tmp"))},
        outtmpl=f"%(extractor_key)s-%(id)s-{kind}.%(ext)s",
    )


if __name__ == "__main__":
    cli.main(Path(__file__).resolve().parent.parent, {"get": cli.Verb(get, lambda media: media["path"])})
