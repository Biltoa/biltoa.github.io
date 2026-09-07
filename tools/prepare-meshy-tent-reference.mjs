import path from 'node:path'
import process from 'node:process'
import { NodeIO } from '@gltf-transform/core'

const [, , inputArg, outputArg] = process.argv

if (!inputArg || !outputArg) {
  console.error('Usage: node tools/prepare-meshy-tent-reference.mjs <input.glb> <output.glb>')
  process.exit(1)
}

const inputPath = path.resolve(inputArg)
const outputPath = path.resolve(outputArg)
const io = new NodeIO()
const document = await io.read(inputPath)
const root = document.getRoot()
const meshes = root.listMeshes()

if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) {
  throw new Error(`Expected one mesh with one primitive, found ${meshes.length} mesh(es).`)
}

const mesh = meshes[0]
const primitive = mesh.listPrimitives()[0]
const positions = primitive.getAttribute('POSITION')?.getArray()
const normals = primitive.getAttribute('NORMAL')?.getArray()
const indices = primitive.getIndices()

if (!positions || !normals || !indices) {
  throw new Error('The optimized reference must contain positions, normals, and indices.')
}

// Match the original campsite contract exactly without changing topology, UVs,
// hierarchy, or material textures. The source download remains untouched.
const targetBounds = {
  min: [-0.5, -0.40039, -0.414065],
  max: [0.5, 0.39648, 0.414065],
}
const sourceMin = [Infinity, Infinity, Infinity]
const sourceMax = [-Infinity, -Infinity, -Infinity]
for (let index = 0; index < positions.length; index += 3) {
  for (let axis = 0; axis < 3; axis += 1) {
    sourceMin[axis] = Math.min(sourceMin[axis], positions[index + axis])
    sourceMax[axis] = Math.max(sourceMax[axis], positions[index + axis])
  }
}
const scale = sourceMin.map((minimum, axis) =>
  (targetBounds.max[axis] - targetBounds.min[axis]) / (sourceMax[axis] - minimum),
)

for (let index = 0; index < positions.length; index += 3) {
  for (let axis = 0; axis < 3; axis += 1) {
    positions[index + axis] = targetBounds.min[axis]
      + (positions[index + axis] - sourceMin[axis]) * scale[axis]
  }
  const nx = normals[index] / scale[0]
  const ny = normals[index + 1] / scale[1]
  const nz = normals[index + 2] / scale[2]
  const length = Math.hypot(nx, ny, nz) || 1
  normals[index] = nx / length
  normals[index + 1] = ny / length
  normals[index + 2] = nz / length
}

mesh.setName('Tent_Reference_15k')
primitive.setName('Tent_Reference_15k')
primitive.getMaterial()?.setName('Tent_Reference_Baked')
root.listNodes().forEach((node) => {
  if (node.getMesh() === mesh) {
    node.setName('Tent_Reference_15k')
    node.setTranslation([0, 0, 0])
    node.setRotation([0, 0, 0, 1])
    node.setScale([1, 1, 1])
  }
})

await io.write(outputPath, document)
console.log(JSON.stringify({
  input: inputPath,
  output: outputPath,
  triangles: indices.getCount() / 3,
  primitiveCount: mesh.listPrimitives().length,
  material: primitive.getMaterial()?.getName(),
  targetBounds,
}, null, 2))
