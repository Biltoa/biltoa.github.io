from pathlib import Path

import numpy as np
from PIL import Image


PROJECT_ROOT = Path(r"E:\Portfolio Project")
SOURCE = PROJECT_ROOT / "public" / "models" / "tent-painted-final" / "Tent_BaseColor_Painted.png"
OUTPUT_DIR = PROJECT_ROOT / "public" / "models" / "tent-painting-blue"
OUTPUT = OUTPUT_DIR / "Tent_BaseColor_BluePaint.png"
TARGET_SRGB = np.array([0x39, 0x4A, 0x53], dtype=np.float32) / 255.0


def srgb_to_linear(value: np.ndarray) -> np.ndarray:
    return np.where(value <= 0.04045, value / 12.92, ((value + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(value: np.ndarray) -> np.ndarray:
    value = np.clip(value, 0.0, 1.0)
    return np.where(value <= 0.0031308, value * 12.92, 1.055 * value ** (1.0 / 2.4) - 0.055)


def smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    t = np.clip((value - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
source = np.asarray(Image.open(SOURCE).convert("RGB"), dtype=np.float32) / 255.0
linear = srgb_to_linear(source)
luma = linear @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

# Match the website's canvas classification. Dark leather and wood stay baked;
# the light canvas becomes the Projects tent's smoky blue-charcoal colour.
canvas_mask = smoothstep(0.28, 0.48, luma)[..., None]
canvas_surface = np.clip(luma / 0.58, 0.72, 1.12)[..., None]
target_linear = srgb_to_linear(TARGET_SRGB)
result_linear = linear * (1.0 - canvas_mask) + target_linear * canvas_surface * canvas_mask
result = np.rint(linear_to_srgb(result_linear) * 255.0).astype(np.uint8)

Image.fromarray(result, mode="RGB").save(OUTPUT, format="PNG", compress_level=6)
print(f"BLUE_PAINT_TEXTURE={OUTPUT}")
print(f"CANVAS_PIXELS={int((canvas_mask[..., 0] > 0.5).sum())}")
