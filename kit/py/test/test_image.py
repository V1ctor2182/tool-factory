import numpy as np
import pytest
from PIL import Image

from factory_kit.cli import AtomError
from factory_kit.color import rgb_to_lab
from factory_kit.image import best_shift, load_image


def test_loads_an_image_in_the_mode_and_type_asked_for(tmp_path):
    path = tmp_path / "red.png"
    Image.new("RGB", (2, 1), (255, 0, 0)).save(path)
    loaded = load_image(path, "RGBA", np.int16)
    assert loaded.dtype == np.int16
    assert loaded.tolist() == [[[255, 0, 0, 255], [255, 0, 0, 255]]]


def test_a_file_that_is_no_image_is_an_invalid_source(tmp_path):
    path = tmp_path / "note.png"
    path.write_text("not an image")
    with pytest.raises(AtomError) as raised:
        load_image(path, "RGB", np.int16)
    assert raised.value.code == "invalid_source"


def test_finds_the_shift_between_two_profiles():
    a = np.array([0.0, 0, 9, 1, 7, 0, 0, 0, 0, 0])
    assert best_shift(a, np.roll(a, 2), 3) == (2, 0.0)
    assert best_shift(np.roll(a, 2), a, 3) == (-2, 0.0)


@pytest.mark.parametrize(
    ("rgb", "expected"),
    [((0, 0, 0), (0, 0, 0)), ((255, 255, 255), (100, 0, 0)), ((255, 0, 0), (53.24, 80.09, 67.22))],
)
def test_converts_rgb_to_lab(rgb, expected):
    assert rgb_to_lab(rgb) == pytest.approx(expected, abs=0.02)
