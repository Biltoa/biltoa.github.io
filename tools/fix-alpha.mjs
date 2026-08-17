/**
 * Post-export fix: force alpha-cutout on the foliage materials.
 *
 *   node tools/fix-alpha.mjs tools/build/campsite-kit.glb public/models/campsite-kit.glb
 *
 * Blender 4.2 removed the material `blend_method = 'CLIP'` setting the glTF
 * exporter used to read to emit `alphaMode: MASK`. Without it every leaf card
 * exports OPAQUE and the trees render as squares. Setting it here keeps the
 * export script declarative instead of fighting a Blender version.
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'

const [, , input, output] = process.argv
if (!input || !output) {
  console.error('usage: node tools/fix-alpha.mjs <in.glb> <out.glb>')
  process.exit(1)
}

/** Material name -> cutoff. Names come from export-campsite.py: `<Entry>_<slot>`. */
const CUTOUT = [
  [/^Tree[ABC]_1$/, 0.42],
  [/^Grass[AB]_0$/, 0.34],
  [/^Flowers_0$/, 0.34],
]

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(input)

let changed = 0
for (const mat of doc.getRoot().listMaterials()) {
  const name = mat.getName()
  const rule = CUTOUT.find(([re]) => re.test(name))
  if (!rule) continue
  mat.setAlphaMode('MASK')
  mat.setAlphaCutoff(rule[1])
  mat.setDoubleSided(true)
  changed++
  console.log(`MASK  ${name}  cutoff ${rule[1]}`)
}

await io.write(output, doc)
console.log(`patched ${changed} materials -> ${output}`)
