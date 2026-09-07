"""Prepare Fabric030 as tint-safe web textures for the campsite tents.

The source PBR set remains untouched.  The albedo is converted to a neutral,
mid-grey detail map so it can only modulate brightness and cannot shift the
runtime olive, sand, or blue canvas hues.
"""

from pathlib import Path
from io import BytesIO
import sys
import zipfile

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ZIP = (
    Path(sys.argv[1])
    if len(sys.argv) > 1
    else Path(r"C:\Users\bilto\Downloads\Fabric030_1K-JPG.zip")
)
OUTPUT = ROOT / "public" / "textures" / "tent-cloth" / "fabric030-neutral"


def read_member(archive: zipfile.ZipFile, filename: str) -> bytes:
    return archive.read(filename)


def load_luma(archive: zipfile.ZipFile, filename: str) -> np.ndarray:
    rgb = np.asarray(
        Image.open(BytesIO(read_member(archive, filename))).convert("RGB"),
        dtype=np.float32,
    ) / 255.0
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def robust_normalize(values: np.ndarray, low: float = 2.0, high: float = 98.0) -> np.ndarray:
    lo, hi = np.percentile(values, (low, high))
    return np.clip((values - lo) / max(hi - lo, 1e-6), 0.0, 1.0)


def save_gray(values: np.ndarray, filename: str, quality: int = 96) -> None:
    pixels = np.round(np.clip(values, 0.0, 1.0) * 255.0).astype(np.uint8)
    Image.fromarray(pixels, mode="L").save(OUTPUT / filename, "WEBP", quality=quality, method=6)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(SOURCE_ZIP) as archive:
        color_luma = robust_normalize(
            load_luma(archive, "Fabric030_1K-JPG_Color.jpg")
        )
        # Center tightly around 50% grey. This retains weave/mottle detail while
        # preventing the original brown-grey albedo from contaminating runtime hue.
        neutral_color = 0.5 + (color_luma - 0.5) * 0.36
        save_gray(neutral_color, "Fabric030_NeutralColor.webp")

        height = robust_normalize(
            load_luma(archive, "Fabric030_1K-JPG_Displacement.jpg"),
            1.0,
            99.0,
        )
        save_gray(height, "Fabric030_Height.webp", quality=98)

        roughness = load_luma(archive, "Fabric030_1K-JPG_Roughness.jpg")
        save_gray(roughness, "Fabric030_Roughness.webp")

        ao = load_luma(archive, "Fabric030_1K-JPG_AmbientOcclusion.jpg")
        save_gray(ao, "Fabric030_AO.webp")

        # The website derives its triplanar normal response from this height map
        # instead of shipping the much larger tangent-space normal. That avoids
        # UV/tangent seams and keeps the original normal safely inside the ZIP.


if __name__ == "__main__":
    main()
