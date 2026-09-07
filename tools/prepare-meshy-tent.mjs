import path from 'node:path'
import process from 'node:process'
import { NodeIO } from '@gltf-transform/core'
import sharp from 'sharp'

const [, , inputArg, outputArg] = process.argv

if (!inputArg) {
  console.error('Usage: node tools/prepare-meshy-tent.mjs <input.glb> [output.glb]')
  process.exit(1)
}

const inputPath = path.resolve(inputArg)
const outputPath = outputArg ? path.resolve(outputArg) : null
const io = new NodeIO()
const document = await io.read(inputPath)
const root = document.getRoot()
const meshes = root.listMeshes()

if (meshes.length !== 1 || meshes[0].listPrimitives().length !== 1) {
  throw new Error(`Expected one mesh with one primitive, found ${meshes.length} mesh(es).`)
}

const mesh = meshes[0]
const sourcePrimitive = mesh.listPrimitives()[0]
const positionAccessor = sourcePrimitive.getAttribute('POSITION')
const normalAccessor = sourcePrimitive.getAttribute('NORMAL')
const uvAccessor = sourcePrimitive.getAttribute('TEXCOORD_0')
const indexAccessor = sourcePrimitive.getIndices()
const sourceMaterial = sourcePrimitive.getMaterial()
const baseColorTexture = sourceMaterial?.getBaseColorTexture()

if (!positionAccessor || !normalAccessor || !uvAccessor || !indexAccessor || !baseColorTexture) {
  throw new Error('The input must contain positions, normals, UVs, indices, and a base-color texture.')
}

const encodedImage = baseColorTexture.getImage()
if (!encodedImage) throw new Error('The base-color texture has no embedded image data.')

const { data: pixels, info } = await sharp(encodedImage)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const positions = positionAccessor.getArray()
const normals = normalAccessor.getArray()
const uvs = uvAccessor.getArray()
const indices = indexAccessor.getArray()

const sampleUv = (u, v) => {
  const wrappedU = ((u % 1) + 1) % 1
  const wrappedV = ((v % 1) + 1) % 1
  const x = Math.min(info.width - 1, Math.max(0, Math.round(wrappedU * (info.width - 1))))
  const y = Math.min(info.height - 1, Math.max(0, Math.round(wrappedV * (info.height - 1))))
  const offset = (y * info.width + x) * info.channels
  const r = pixels[offset] / 255
  const g = pixels[offset + 1] / 255
  const b = pixels[offset + 2] / 255
  return {
    luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b,
    chroma: Math.max(r, g, b) - Math.min(r, g, b),
  }
}

const wrappedAverage = (values) => {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const adjusted = max - min > 0.5 ? values.map((value) => (value < 0.5 ? value + 1 : value)) : values
  return adjusted.reduce((sum, value) => sum + value, 0) / adjusted.length
}

const sampleTriangle = (triangle) => {
  // Stay slightly inside each corner so a UV seam itself cannot decide which
  // material owns an otherwise-canvas triangle.
  const barycentricPoints = [
    [1 / 3, 1 / 3, 1 / 3],
    [0.6, 0.2, 0.2],
    [0.2, 0.6, 0.2],
    [0.2, 0.2, 0.6],
  ]
  return barycentricPoints.map((weights) => {
    const rawU = triangle.map((vertex) => uvs[vertex * 2])
    const rawV = triangle.map((vertex) => uvs[vertex * 2 + 1])
    const baseU = wrappedAverage(rawU)
    const baseV = wrappedAverage(rawV)
    const unwrappedU = rawU.map((value) => (Math.abs(value - baseU) > 0.5 ? value + Math.sign(baseU - value) : value))
    const unwrappedV = rawV.map((value) => (Math.abs(value - baseV) > 0.5 ? value + Math.sign(baseV - value) : value))
    const u = weights.reduce((sum, weight, index) => sum + weight * unwrappedU[index], 0)
    const v = weights.reduce((sum, weight, index) => sum + weight * unwrappedV[index], 0)
    return sampleUv(u, v)
  })
}

const canvasVoteCount = (samples, luminance = 0.45, maxChroma = 0.3) =>
  samples.filter((sample) => sample.luminance >= luminance && sample.chroma <= maxChroma).length

const isCanvasFace = (samples, luminance = 0.45, maxChroma = 0.3, minimumVotes = 1) =>
  canvasVoteCount(samples, luminance, maxChroma) >= minimumVotes

const faceSamples = []
for (let i = 0; i < indices.length; i += 3) {
  const triangle = [indices[i], indices[i + 1], indices[i + 2]]
  faceSamples.push(sampleTriangle(triangle))
}

const sortedLuminance = faceSamples
  .map((samples) => samples.reduce((sum, sample) => sum + sample.luminance, 0) / samples.length)
  .sort((a, b) => a - b)
const percentile = (amount) => sortedLuminance[Math.floor((sortedLuminance.length - 1) * amount)]
const thresholds = [0.35, 0.4, 0.45, 0.5, 0.55, 0.6].map((luminance) => ({
  luminance,
  faces: faceSamples.filter((samples) => isCanvasFace(samples, luminance)).length,
}))

console.log(JSON.stringify({
  source: inputPath,
  triangles: indices.length / 3,
  texture: `${info.width}x${info.height}`,
  luminancePercentiles: {
    p10: percentile(0.1),
    p25: percentile(0.25),
    p50: percentile(0.5),
    p75: percentile(0.75),
    p90: percentile(0.9),
  },
  canvasCandidates: thresholds,
  canvasVoteHistogram: faceSamples.reduce((histogram, samples) => {
    const votes = canvasVoteCount(samples)
    histogram[votes] += 1
    return histogram
  }, [0, 0, 0, 0, 0]),
}, null, 2))

if (!outputPath) process.exit(0)

// The site's camera and interaction math was authored against this exact local
// bounding-box contract. Bake the Meshy model into it so none of the campsite
// positions, hover scaling, doorway path, or interior coordinates need to move.
const targetBounds = {
  min: [-0.5, -0.40039, -0.414065],
  max: [0.5, 0.39648, 0.414065],
}
const sourceMin = [Infinity, Infinity, Infinity]
const sourceMax = [-Infinity, -Infinity, -Infinity]
for (let i = 0; i < positions.length; i += 3) {
  for (let axis = 0; axis < 3; axis += 1) {
    sourceMin[axis] = Math.min(sourceMin[axis], positions[i + axis])
    sourceMax[axis] = Math.max(sourceMax[axis], positions[i + axis])
  }
}
const scale = sourceMin.map((min, axis) =>
  (targetBounds.max[axis] - targetBounds.min[axis]) / (sourceMax[axis] - min),
)
for (let i = 0; i < positions.length; i += 3) {
  for (let axis = 0; axis < 3; axis += 1) {
    positions[i + axis] = targetBounds.min[axis] + (positions[i + axis] - sourceMin[axis]) * scale[axis]
  }
  const nx = normals[i] / scale[0]
  const ny = normals[i + 1] / scale[1]
  const nz = normals[i + 2] / scale[2]
  const length = Math.hypot(nx, ny, nz) || 1
  normals[i] = nx / length
  normals[i + 1] = ny / length
  normals[i + 2] = nz / length
}

// Meshy's atlas is light, low-chroma canvas and darker/chromatic wood/leather.
// Splitting by the atlas keeps the baked leather and wood maps intact while the
// runtime can replace only the canvas material with the three established tints.
const canvasIndices = []
const detailIndices = []
const canvasLuminance = 0.45
const canvasMaxChroma = 0.3
faceSamples.forEach((samples, faceIndex) => {
  const output = isCanvasFace(samples, canvasLuminance, canvasMaxChroma)
    ? canvasIndices
    : detailIndices
  const offset = faceIndex * 3
  output.push(indices[offset], indices[offset + 1], indices[offset + 2])
})

const canvasMaterial = sourceMaterial.clone().setName('Tent_Canvas')
sourceMaterial.setName('Tent_Baked_Details')

const makePrimitive = (name, material, triangleIndices) => {
  const primitive = document.createPrimitive(name)
    .setMode(sourcePrimitive.getMode())
    .setMaterial(material)
  for (const semantic of sourcePrimitive.listSemantics()) {
    primitive.setAttribute(semantic, sourcePrimitive.getAttribute(semantic))
  }
  const IndexArray = positions.length / 3 <= 65535 ? Uint16Array : Uint32Array
  primitive.setIndices(document.createAccessor(`${name}_indices`)
    .setType('SCALAR')
    .setArray(new IndexArray(triangleIndices)))
  mesh.addPrimitive(primitive)
}

makePrimitive('Tent_Canvas', canvasMaterial, canvasIndices)
makePrimitive('Tent_Baked_Details', sourceMaterial, detailIndices)

mesh.removePrimitive(sourcePrimitive)
mesh.setName('Tent_Meshy_Optimized')
root.listNodes().forEach((node) => {
  if (node.getMesh() === mesh) node.setName('Tent_Meshy_Optimized')
})

await io.write(outputPath, document)
console.log(JSON.stringify({
  output: outputPath,
  canvasTriangles: canvasIndices.length / 3,
  bakedDetailTriangles: detailIndices.length / 3,
  targetBounds,
}, null, 2))
