/**
 * Re-encodes a few of the kit's textures at a higher resolution, in place.
 *
 *   node tools/upres-textures.mjs
 *
 * The pipeline that built the GLB (prep-textures.mjs → Blender → strip-kit.mjs)
 * downsamples everything to a size chosen for how the prop is *usually* seen —
 * and for most of the kit, "usually" means from across the clearing, where 512
 * is more than the frame can resolve.
 *
 * Two of them are not seen that way. The camp bench is what the journal lies on,
 * and the reading camera sits sixty centimetres above it: at 512 across a 1.5m
 * plank the wood grain is about eight pixels a centimetre on screen and the
 * surface reads as a photograph of a table rather than as one. This lifts those
 * maps back up from the pack's originals without re-running Blender, which the
 * full pipeline would need.
 *
 * Kept as a separate script rather than folded into prep-textures.mjs because it
 * patches the shipped GLB directly: the intermediate files the rest of the
 * pipeline works from are long gone by the time this matters.
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'

const SRC = String.raw`E:\Unity Workspaces\Gameplay Portfolio\Assets\Polyart\PolyartStudio\DreamscapeCampsite\Textures`
const GLB = path.join(process.cwd(), 'public', 'models', 'campsite-kit.glb')

/** texture name in the GLB → [source folder, file, size] */
const UPRES = [
  ['T_Bench_01_C', 'Props', 'T_Bench_01_C.png', 1024],
  ['T_Bench_01_N', 'Props', 'T_Bench_01_N.png', 1024],
  ['T_Bench_01_R', 'Props', 'T_Bench_01_R.png', 1024],
  // The candlesticks stand either side of the journal, in the same shot.
  ['T_Candle_02_C', 'Props', 'T_Candle_02_C.png', 512],
  ['T_Candle_02_N', 'Props', 'T_Candle_02_N.png', 512],
]

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(GLB)
const textures = new Map(doc.getRoot().listTextures().map((t) => [t.getName(), t]))

let before = 0
let after = 0

for (const [name, folder, file, size] of UPRES) {
  const tex = textures.get(name)
  if (!tex) {
    console.warn(`skip ${name}: not in the kit`)
    continue
  }
  const src = path.join(SRC, folder, file)
  try {
    await fs.access(src)
  } catch {
    console.warn(`skip ${name}: no source at ${src}`)
    continue
  }

  const wasBytes = tex.getImage()?.byteLength ?? 0
  const buf = await sharp(src, { unlimited: true })
    .toColourspace('srgb')
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88, alphaQuality: 90 })
    .toBuffer()

  tex.setImage(new Uint8Array(buf))
  tex.setMimeType('image/webp')

  before += wasBytes
  after += buf.byteLength
  console.log(`${name}  ${(wasBytes / 1024) | 0}KB -> ${size}px ${(buf.byteLength / 1024) | 0}KB`)
}

await io.write(GLB, doc)
const { size } = await fs.stat(GLB)
console.log(
  `\n${path.relative(process.cwd(), GLB)}  ${(size / 1024 / 1024).toFixed(2)}MB  ` +
    `(textures ${(before / 1024) | 0}KB -> ${(after / 1024) | 0}KB)`
)
