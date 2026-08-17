/**
 * Drops every mesh the scene no longer places, then prunes whatever that
 * orphans (materials, textures, images, accessors).
 *
 * The kit was exported with the whole prop set so the layout could be tried
 * with different dressing. Once the arrangement settled, more than half of it
 * was never instanced — the market stall alone is 15k triangles and three 1K
 * textures that every visitor was downloading and uploading to the GPU.
 *
 *   node tools/strip-kit.mjs public/models/campsite-kit.glb
 *
 * Keep this list in step with the node names used in src/three/CampHero.tsx
 * and src/three/campsite/useKit.ts.
 */
import fs from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, dedup } from '@gltf-transform/functions'

const KEEP = new Set([
  'Tent',
  'TreeA',
  'TreeB',
  'TreeC',
  'GrassA',
  'GrassB',
  'Flowers_0',
  'Flowers_1',
  'Firewood',
  'FireRocks',
  'Lamp',
  'Bench',
  'BenchIndoor',
  'Stone',
  'Torch',
  'Pillow5',
  'Pillow6',
  'Pillow7',
  'SleepingBag1',
  'Backpack',
  // Tent interior dressing: a bench to read at, candles either side of the
  // journal, and a shelf of glassware in the corner. (The pack's Table is a
  // trestle a metre and a half tall — inside a tent it is a workbench filling
  // the room, so the camp bench does the job instead.)
  'Shelf',
  'Candle2',
  'Jar',
  'Potion',
])

const file = process.argv[2] ?? 'public/models/campsite-kit.glb'
const before = fs.statSync(file).size

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(file)
const root = doc.getRoot()

const dropped = []
for (const node of root.listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  // Multi-primitive props export as "Name" or "Name_0"; both start with the
  // node name the site asks for.
  const name = node.getName()
  if (KEEP.has(name)) continue
  dropped.push(name)
  node.dispose()
}

for (const mesh of root.listMeshes()) {
  if (mesh.listParents().filter((p) => p.propertyType === 'Node').length === 0) mesh.dispose()
}

// Materials excluded: the tent's window sash is deliberately split onto its
// own material (see tools/export-campsite.py's mark_faces_by_bbox) with
// textures identical to the tent's main material, purely so the runtime can
// tell the two primitives apart and skip the hover highlight on the window.
// Material dedup doesn't look at names, only content — it would merge that
// pair straight back into one and silently undo the split.
await doc.transform(prune(), dedup({ propertyTypes: ['Accessor', 'Texture', 'Mesh', 'Skin'] }))

const tris = root
  .listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0)

await io.write(file, doc)
const after = fs.statSync(file).size

console.log('dropped:', dropped.join(', ') || '(none)')
console.log(`kept ${root.listMeshes().length} meshes, ${tris} tris, ${root.listTextures().length} textures`)
console.log(`${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`)
