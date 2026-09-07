import argparse
from pathlib import Path

import numpy as np
from PIL import Image


parser = argparse.ArgumentParser(description="Build the tent fabric preview texture.")
parser.add_argument("source", type=Path, help="Path to the source canvas photograph")
args = parser.parse_args()

SOURCE = args.source
OUTPUT = Path(__file__).resolve().parents[1] / "public/textures/tent-cloth/canvas-reference.webp"

# Turn the supplied white canvas photograph into a neutral scalar weave map.
# Percentile normalization preserves its real vertical thread structure without
# adding the reference image's white colour to the runtime tent tints.
image = Image.open(SOURCE).convert("L").resize((1024, 1024), Image.Resampling.LANCZOS)
pixels = np.asarray(image, dtype=np.float32)
low, high = np.percentile(pixels, (3.0, 97.0))
normalized = np.clip((pixels - low) / max(high - low, 1.0), 0.0, 1.0)
height = np.rint((0.20 + normalized * 0.60) * 255.0).astype(np.uint8)
rgb = np.repeat(height[..., None], 3, axis=2)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray(rgb, mode="RGB").save(OUTPUT, format="WEBP", quality=92, method=6)
print(f"FABRIC_PREVIEW_TEXTURE={OUTPUT}")
print(f"SOURCE_RANGE={low:.2f},{high:.2f}")
