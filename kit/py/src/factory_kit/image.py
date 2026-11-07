from pathlib import Path

import numpy as np
from PIL import Image, UnidentifiedImageError

from .cli import AtomError


def load_image(path: Path, mode: str, dtype) -> np.ndarray:
    try:
        with Image.open(path) as im:
            return np.asarray(im.convert(mode), dtype=dtype)
    except (UnidentifiedImageError, OSError) as e:
        raise AtomError("invalid_source", f"{path} is not an image: {e}") from None


def best_shift(a: np.ndarray, b: np.ndarray, reach: int) -> tuple[int, float]:
    """The offset that best lines up two brightness profiles, with the mismatch at that offset."""
    n = len(a)
    costs = [np.abs(a[max(0, -s) : n - max(0, s)] - b[max(0, s) : n - max(0, -s)]).mean() for s in range(-reach, reach + 1)]
    best = int(np.argmin(costs))
    return best - reach, float(costs[best])
