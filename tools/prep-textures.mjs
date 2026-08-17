/**
 * Normalises the Unity source textures before Blender ever sees them.
 *
 *   node tools/prep-textures.mjs
 *
 * Two reasons this exists rather than letting gltf-transform resize afterwards:
 *   1. Some of the pack's PNGs are 16-bit / odd colour spaces, which makes
 *      libvips fail with "colourspace: parameter space not set".
 *   2. Resizing 4K maps before the GLB is built keeps the intermediate file
 *      small enough to work with comfortably.
 *
 * Colour maps keep more resolution than normal/roughness, which nobody looks at
 * directly.
 */
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'

const SRC = String.raw`E:\Unity Workspaces\Gameplay Portfolio\Assets\Polyart\PolyartStudio\DreamscapeCampsite\Textures`
const OUT = path.join(process.cwd(), 'tools', 'build', 'tex')

/** Only the maps the kit actually wires up — the pack has 419 PNGs. */
const WANTED = [
  ['Structures', 'T_Tent_01_C.png', 2048],
  ['Structures', 'T_Tent_01_N.png', 512],
  ['Structures', 'T_Tent_01_R.png', 512],
  // Tent variation B.
  ['Structures', 'T_Tent_04_C.png', 1024],
  ['Structures', 'T_Tent_04_N.png', 512],
  ['Structures', 'T_Tent_04_R.png', 512],
  ['Structures', 'T_Tent_04_Mask.png', 512],
  ['Structures', 'T_Stall_01_C.png', 512],
  ['Structures', 'T_Stall_01_N.png', 512],
  ['Structures', 'T_Stall_01_R.png', 512],
  // Interior dressing, so a tent you walk into is not an empty shell.
  ['Props', 'T_SleepingBag_02_C.png', 512],
  ['Props', 'T_SleepingBag_02_N.png', 512],
  ['Props', 'T_SleepingBag_02_R.png', 512],
  ['Props', 'T_SleepingBag_Open_C.png', 512],
  ['Props', 'T_SleepingBag_Open_N.png', 512],
  ['Props', 'T_SleepingBag_Open_R.png', 512],
  ['Props', 'T_Torch_01_C.png', 512],
  ['Props', 'T_Torch_01_N.png', 512],
  ['Props', 'T_Torch_01_R.png', 512],
  ['Props', 'T_Table_01_C.png', 512],
  ['Props', 'T_Table_01_N.png', 512],
  ['Props', 'T_Table_01_R.png', 512],
  ['Props', 'T_Support_01_C.png', 512],
  ['Props', 'T_Support_01_N.png', 512],
  ['Props', 'T_Support_01_R.png', 512],
  // Candles for the tent bench. Candle_02 is the metal stick, Candle_01 the
  // plain wax stub — both are exported so the dressing can pick.
  ['Props', 'T_Candle_01_C.png', 256],
  ['Props', 'T_Candle_01_N.png', 256],
  ['Props', 'T_Candle_01_R.png', 256],
  ['Props', 'T_Candle_02_C.png', 256],
  ['Props', 'T_Candle_02_N.png', 256],
  ['Props', 'T_Candle_02_R.png', 256],
  ['Props', 'T_Pillow_05_C.png', 256],
  ['Props', 'T_Pillow_05_N.png', 256],
  ['Props', 'T_Pillow_05_R.png', 256],
  ['Props', 'T_Pillow_06_C.png', 256],
  ['Props', 'T_Pillow_06_N.png', 256],
  ['Props', 'T_Pillow_06_R.png', 256],
  ['Props', 'T_Pillow_07_C.png', 256],
  ['Props', 'T_Pillow_07_N.png', 256],
  ['Props', 'T_Pillow_07_R.png', 256],
  ['Containers', 'T_Backpack_02_Base_C.png', 512],
  ['Containers', 'T_Backpack_02_Base_N.png', 512],
  ['Containers', 'T_Backpack_02_Base_R.png', 512],
  ['Containers', 'T_Jar_02_Purple_C.png', 256],
  ['Containers', 'T_Jar_02_Purple_E.png', 256],
  ['Containers', 'T_Potion_03_Green_C.png', 256],
  ['Containers', 'T_Potion_03_Green_E.png', 256],
  ['Cooking', 'T_Sticks_Combined_C.png', 512],
  ['Cooking', 'T_Sticks_Combined_N.png', 512],
  ['Cooking', 'T_Sticks_Combined_R.png', 512],
  ['Cooking', 'T_Pots_Combined_C.png', 512],
  ['Cooking', 'T_Pots_Combined_N.png', 512],
  ['Cooking', 'T_Pots_Combined_R.png', 512],
  ['Cooking', 'T_SpitRoast_C.png', 512],
  ['Cooking', 'T_SpitRoast_N.png', 512],
  ['Cooking', 'T_SpitRoast_R.png', 512],
  ['Cooking', 'T_Roast_Combined_C.png', 512],
  ['Cooking', 'T_Roast_Combined_N.png', 512],
  ['Cooking', 'T_Roast_Combined_R.png', 512],
  ['Trees', 'T_Bark_Autumn_01_C.png', 1024],
  ['Trees', 'T_Bark_Autumn_01_N.png', 512],
  ['Trees', 'T_Bark_Autumn_01_R.png', 512],
  ['Trees', 'T_Campsite_Leaves_01.png', 1024],
  ['Trees', 'T_Campsite_Leaves_02.png', 1024],
  ['Trees', 'T_Campsite_Leaves_03.png', 1024],
  ['Foliage', 'T_Grass_Medium_01.png', 512],
  ['Foliage', 'T_Grass_Medium_01_O.png', 512],
  ['Foliage', 'T_Flowers_Campsite_C.png', 512],
  ['Foliage', 'T_Flowers_Campsite_A.png', 512],
  ['Cooking', 'T_Firewood_01_Burning_C.png', 512],
  ['Cooking', 'T_Firewood_01_Burning_N.png', 512],
  ['Cooking', 'T_Firewood_01_Burning_R.png', 512],
  ['Cooking', 'T_Firewood_01_Burning_E.png', 512],
  ['Cooking', 'T_Campfire_Rocks_Lit_C.png', 512],
  ['Cooking', 'T_Campfire_Rocks_N.png', 512],
  ['Cooking', 'T_Campfire_Rocks_R.png', 512],
  ['Props', 'T_Lamp_01_C.png', 512],
  ['Props', 'T_Lamp_01_N.png', 512],
  ['Props', 'T_Lamp_01_R.png', 512],
  ['Props', 'T_Lamp_01_E.png', 512],
  // The campfire benches — plain, low-detail, at a distance. Left at the
  // pack's original resolution.
  ['Props', 'T_Bench_01_C.png', 512],
  ['Props', 'T_Bench_01_N.png', 512],
  ['Props', 'T_Bench_01_R.png', 512],
  // Same bench model, reused as the journal's table just inside the tent —
  // close to the lens, so it gets its own higher-res copy under a different
  // filename rather than lifting the outdoor version too. Colour maxes out
  // at the source's native 2048; normal/rough are already native at 1024.
  ['Props', 'T_Bench_01_C.png', 2048, 'T_Bench_01_Indoor_C.png'],
  ['Props', 'T_Bench_01_N.png', 1024, 'T_Bench_01_Indoor_N.png'],
  ['Props', 'T_Bench_01_R.png', 1024, 'T_Bench_01_Indoor_R.png'],
  ['Props', 'T_Pumpkin_01_C.png', 512],
  ['Props', 'T_Pumpkin_01_N.png', 512],
  ['Props', 'T_Pumpkin_01_R.png', 512],
  ['Props', 'T_WoodPlank_C.png', 512],
  ['Props', 'T_WoodPlank_N.png', 512],
  ['Props', 'T_WoodPlank_R.png', 512],
  ['Stones', 'T_Stones_Update_C.png', 512],
  ['Stones', 'T_Stones_Update_N.png', 512],
  ['Stones', 'T_Stones_Update_R.png', 512],
  // Sprite sheets used by the code-driven effects, copied straight into public/.
  ['Effects', 'T_Leaf_Update_01.png', 256],
  ['Effects', 'T_Leaf_Update_02.png', 256],
  // The pack's fire, smoke, dust and cloud sprites are gone on purpose: they
  // are single-channel masks (black RGB, opaque alpha) and render as dark
  // boxes on a quad. Those effects are shader-generated instead.
  // Tree impostors: the pack ships billboard bakes, which is how the far
  // treeline gets depth without another few thousand triangles each.
  ['Trees', 'T_Tree_Campsite_01_Billboard.png', 512],
  ['Trees', 'T_Tree_Campsite_02_Billboard.png', 512],
  ['Trees', 'T_Tree_Campsite_03_Billboard.png', 512],
  ['Trees', 'T_Tree_Campsite_04_Billboard.png', 512],
  // Ground: tiled directly on a plane in the scene, not through the GLB.
  ['Terrain', 'T_AutumnGrass_01_C.png', 1024],
  ['Terrain', 'T_AutumnGrass_01_N.png', 512],
  // Trodden earth round the fire. The roughness map doubles as the height
  // field for the parallax pass, so it ships at the same size as the colour.
  ['Terrain', 'T_Dirt_Ground_C.png', 1024],
  ['Terrain', 'T_Dirt_Ground_N.png', 1024],
  ['Terrain', 'T_Dirt_Ground_R.png', 1024],
]

/** Maps that ship as loose WebP files rather than inside the GLB. */
const LOOSE = new Set(['Effects', 'Terrain'])
const LOOSE_FILES = new Set([
  'T_Tree_Campsite_01_Billboard.png',
  'T_Tree_Campsite_02_Billboard.png',
  'T_Tree_Campsite_03_Billboard.png',
  'T_Tree_Campsite_04_Billboard.png',
])

let total = 0

for (const [folder, file, size, outName] of WANTED) {
  const src = path.join(SRC, folder, file)
  const dstDir = path.join(OUT, folder)
  await fs.mkdir(dstDir, { recursive: true })
  const dst = path.join(dstDir, outName ?? file)

  try {
    let img = sharp(src, { unlimited: true })
    const meta = await img.metadata()
    const hasAlpha = Boolean(meta.hasAlpha)

    // The tent canvas is painted a warm tan. Multiplying a brand colour over
    // that gives mud — blue reads brown. Stripping it to luminance first means
    // the three tint colours come through as themselves.
    if (file === 'T_Tent_01_C.png') {
      img = img.grayscale().linear(1.25, 12)
    }
    // Tent 04's canvas is painted much darker than Tent 01's; without the
    // stronger lift the brand tint multiplies down to near-black.
    if (file === 'T_Tent_04_C.png') {
      img = img.grayscale().linear(1.55, 52)
    }

    await img
      // toColourspace + ensureAlpha normalises the 16-bit and greyscale cases
      // that make libvips complain further down the pipeline.
      .toColourspace('srgb')
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: false, force: true })
      .toFile(dst)

    const { size: bytes } = await fs.stat(dst)
    total += bytes
    console.log(
      `${folder}/${outName ?? file}  ${meta.width}x${meta.height} -> ${size}px  ${(bytes / 1024) | 0}KB${
        hasAlpha ? '  (alpha)' : ''
      }`
    )
  } catch (e) {
    console.error(`FAILED ${folder}/${file}:`, e.message)
  }
}

console.log(`\ntotal ${(total / 1024 / 1024).toFixed(1)}MB in ${OUT}`)

/* The effect sprites are not part of the GLB — the leaves, embers, fire and
   smoke are driven by code, so they ship as loose WebP files. */
const SPRITES = path.join(process.cwd(), 'public', 'textures')
await fs.mkdir(SPRITES, { recursive: true })

for (const [folder, file] of WANTED.filter(([f, n]) => LOOSE.has(f) || LOOSE_FILES.has(n))) {
  const src = path.join(OUT, folder, file)
  const dst = path.join(SPRITES, file.replace(/\.png$/i, '.webp'))
  await sharp(src).webp({ quality: 85, alphaQuality: 90 }).toFile(dst)
  const { size } = await fs.stat(dst)
  console.log(`sprite ${path.basename(dst)}  ${(size / 1024) | 0}KB`)
}
