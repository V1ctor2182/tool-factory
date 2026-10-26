# /// script
# requires-python = ">=3.12"
# dependencies = ["pillow"]
# ///
"""Record a real terminal run with timing, then render it to PNG or MP4 without screen capture.

record OUT.json COMMAND...   run COMMAND in a 100-column pty and save each output chunk with its time
video REC.json OUT.mp4       type the command at a steady pace, replay the chunks at their real times, hold the end
png TEXT OUT.png             render a text file, wrapped at 100 columns
"""
import json
import os
import pty
import re
import select
import shlex
import struct
import subprocess
import sys
import tempfile
import termios
import fcntl
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

COLS, ROWS = 100, 34
FONT = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 15)
CELL_W, CELL_H = 9, 18
PAD = 16
BG, FG, PROMPT = (24, 24, 27), (228, 228, 231), (134, 239, 172)
FPS = 10
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def record(out: str, command: list[str]) -> None:
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(command[0], command)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    start, chunks = time.monotonic(), []
    while True:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if ready:
            try:
                data = os.read(fd, 4096)
            except OSError:
                break
            if not data:
                break
            chunks.append([round(time.monotonic() - start, 3), data.decode("utf-8", "replace")])
    _, status = os.waitpid(pid, 0)
    Path(out).write_text(json.dumps({"command": shlex.join(command), "exit": os.waitstatus_to_exitcode(status), "chunks": chunks}))


def screen_lines(text: str) -> list[tuple[str, bool]]:
    lines = []
    for raw in ANSI.sub("", text).replace("\r\n", "\n").split("\n"):
        raw = raw.split("\r")[-1]
        prompt = raw.startswith("$ ")
        while len(raw) > COLS:
            lines.append((raw[:COLS], prompt))
            raw, prompt = raw[COLS:], False
        lines.append((raw, prompt))
    return lines


def frame(text: str, rows: int = ROWS) -> Image.Image:
    lines = screen_lines(text)[-rows:]
    image = Image.new("RGB", (COLS * CELL_W + 2 * PAD, rows * CELL_H + 2 * PAD), BG)
    draw = ImageDraw.Draw(image)
    for i, (line, prompt) in enumerate(lines):
        y = PAD + i * CELL_H
        if prompt:
            draw.text((PAD, y), "$", font=FONT, fill=PROMPT)
            draw.text((PAD + 2 * CELL_W, y), line[2:], font=FONT, fill=FG)
        else:
            draw.text((PAD, y), line, font=FONT, fill=FG)
    return image


def video(rec_path: str, out: str) -> None:
    rec = json.loads(Path(rec_path).read_text())
    typed = "$ " + rec["command"]
    type_secs = len(typed) / 30 + 0.5
    end = rec["chunks"][-1][0] + type_secs + 6
    with tempfile.TemporaryDirectory() as tmp:
        for n in range(int(end * FPS)):
            t = n / FPS
            if t < type_secs:
                text = typed[: int(t * 30)]
            else:
                text = typed + "\n" + "".join(c for at, c in rec["chunks"] if at + type_secs <= t)
            frame(text).save(f"{tmp}/{n:05d}.png")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", f"{tmp}/%05d.png",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "28", "-preset", "slow", out],
            check=True,
        )


def png(text_path: str, out: str) -> None:
    text = Path(text_path).read_text()
    frame(text, rows=len(screen_lines(text))).save(out, optimize=True)


if __name__ == "__main__":
    verb, *rest = sys.argv[1:]
    {"record": lambda: record(rest[0], rest[1:]), "video": lambda: video(*rest), "png": lambda: png(*rest)}[verb]()
