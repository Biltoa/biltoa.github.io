/**
 * Losslessly prepares the campsite's runtime-only tent assets.
 *
 * The authoring inputs live outside `public/` so Vite does not copy them into
 * production. The generated files keep the exact decoded texels used by the
 * renderer while discarding texture slots that CampHero always disables.
 *
 *   node tools/optimize-runtime-assets.mjs
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'
import validator from 'gltf-validator'
import sharp from 'sharp'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(projectRoot, 'tools', 'source', 'runtime-assets')
const tentInput = path.join(sourceRoot, 'tent-painted-blue-final.source.glb')
const tentOutput = path.join(projectRoot, 'public', 'models', 'tent-painted-blue-final.glb')
const fabricInputRoot = path.join(sourceRoot, 'fabric030-neutral')
const fabricOutput = path.join(
  projectRoot,
  'public',
  'textures',
  'tent-cloth',
  'fabric030-neutral',
  'Fabric030_Packed.webp',
)
const pngSourceRoot = path.join(sourceRoot, 'lossless-png', 'public')
const excludedPngOutputs = new Set([
  path.join('media', 'build', 'after-dismiss.png'),
])

const fabricInputs = [
  ['red', 'Fabric030_NeutralColor.webp'],
  ['green', 'Fabric030_Height.webp'],
  ['blue', 'Fabric030_Roughness.webp'],
  ['alpha', 'Fabric030_AO.webp'],
].map(([channel, name]) => ({ channel, path: path.join(fabricInputRoot, name) }))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function accessorSignature(accessor) {
  assert(accessor, 'Missing required geometry accessor.')
  const array = accessor.getArray()
  assert(array, `Accessor ${accessor.getName() || '(unnamed)'} has no typed array.`)
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
  return `${accessor.getType()}:${accessor.getComponentType()}:${accessor.getCount()}:${sha256(bytes)}`
}

function geometrySignatures(document) {
  return document.getRoot().listMeshes().flatMap((mesh) =>
    mesh.listPrimitives().map((primitive) => ({
      mode: primitive.getMode(),
      position: accessorSignature(primitive.getAttribute('POSITION')),
      normal: accessorSignature(primitive.getAttribute('NORMAL')),
      uv: accessorSignature(primitive.getAttribute('TEXCOORD_0')),
      indices: accessorSignature(primitive.getIndices()),
    })),
  )
}

async function decodedPixels(encoded) {
  return sharp(encoded).removeAlpha().raw().toBuffer({ resolveWithObject: true })
}

async function assertSameDecodedPixels(before, after, label) {
  const a = await decodedPixels(before)
  const b = await decodedPixels(after)
  assert(
    a.info.width === b.info.width
      && a.info.height === b.info.height
      && a.info.channels === b.info.channels,
    `${label}: decoded image dimensions/channels changed.`,
  )
  assert(a.data.equals(b.data), `${label}: decoded texels changed.`)
}

async function decodedRgba(encoded) {
  return sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

async function assertSameDecodedRgba(before, after, label) {
  const a = await decodedRgba(before)
  const b = await decodedRgba(after)
  assert(
    a.info.width === b.info.width
      && a.info.height === b.info.height
      && a.info.channels === 4
      && b.info.channels === 4,
    `${label}: decoded RGBA dimensions changed.`,
  )
  assert(a.data.equals(b.data), `${label}: decoded RGBA texels changed.`)
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(file) : [file]
  })
}

function publishBytes(bytes, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp-${process.pid}`
  fs.writeFileSync(temporary, bytes)
  fs.copyFileSync(temporary, destination)
  fs.unlinkSync(temporary)
}

async function optimizeTent() {
  assert(fs.existsSync(tentInput), `Missing tent authoring source: ${tentInput}`)
  const inputBytes = fs.readFileSync(tentInput)
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const document = await io.readBinary(new Uint8Array(inputBytes))
  const root = document.getRoot()
  const materials = root.listMaterials()
  const meshes = root.listMeshes()

  assert(meshes.length === 1, `Expected one tent mesh, found ${meshes.length}.`)
  assert(meshes[0].listPrimitives().length === 1, 'Expected one tent primitive.')
  assert(materials.length === 1, `Expected one tent material, found ${materials.length}.`)

  const geometryBefore = geometrySignatures(document)
  const material = materials[0]
  assert(material.getAlphaMode() === 'OPAQUE', 'Tent base-color alpha is unexpectedly visible.')
  const baseColorTexture = material.getBaseColorTexture()
  const baseColorImage = baseColorTexture?.getImage()
  assert(baseColorTexture && baseColorImage, 'Tent is missing its embedded base-color image.')

  // WebP is not a core glTF image MIME type. Attaching the required extension
  // makes the generated texture source standards-compliant and lets GLTFLoader
  // capability-check it before use.
  document.createExtension(EXTTextureWebP).setRequired(true)

  // CampHero unconditionally clears these two slots before the first render.
  // Pruning them here changes neither a shader input nor a visible texel.
  material.setEmissiveTexture(null)
  material.setMetallicRoughnessTexture(null)

  const losslessBaseColor = await sharp(baseColorImage)
    .webp({ lossless: true, effort: 6 })
    .toBuffer()
  await assertSameDecodedPixels(baseColorImage, losslessBaseColor, 'Tent base color')
  baseColorTexture.setImage(new Uint8Array(losslessBaseColor)).setMimeType('image/webp')

  await document.transform(prune())
  const outputBytes = await io.writeBinary(document)
  const validation = await validator.validateBytes(outputBytes, {
    uri: path.basename(tentOutput),
    format: 'glb',
    maxIssues: 0,
    writeTimestamp: false,
  })
  assert(
    validation.issues.numErrors === 0,
    `Official glTF Validator found ${validation.issues.numErrors} tent error(s).`,
  )
  const verified = await io.readBinary(outputBytes)
  const verifiedMaterial = verified.getRoot().listMaterials()[0]

  assert(
    JSON.stringify(geometrySignatures(verified)) === JSON.stringify(geometryBefore),
    'Tent geometry/accessor bytes changed during lossless repack.',
  )
  assert(verified.getRoot().listTextures().length === 2, 'Tent should retain only base color and normal.')
  assert(!verifiedMaterial.getEmissiveTexture(), 'Unused emissive texture survived pruning.')
  assert(
    !verifiedMaterial.getMetallicRoughnessTexture(),
    'Unused metallic-roughness texture survived pruning.',
  )
  await assertSameDecodedPixels(
    baseColorImage,
    verifiedMaterial.getBaseColorTexture().getImage(),
    'Verified tent base color',
  )

  publishBytes(outputBytes, tentOutput)
  return {
    sourceBytes: inputBytes.byteLength,
    outputBytes: outputBytes.byteLength,
    savedBytes: inputBytes.byteLength - outputBytes.byteLength,
    outputSha256: sha256(outputBytes),
    textures: verified.getRoot().listTextures().length,
    validator: {
      errors: validation.issues.numErrors,
      warnings: validation.issues.numWarnings,
      infos: validation.issues.numInfos,
      hints: validation.issues.numHints,
    },
  }
}

async function packFabric() {
  for (const input of fabricInputs) {
    assert(fs.existsSync(input.path), `Missing ${input.channel} fabric source: ${input.path}`)
  }

  const decoded = await Promise.all(
    fabricInputs.map(async (input) => ({
      ...input,
      ...(await sharp(input.path).removeAlpha().raw().toBuffer({ resolveWithObject: true })),
    })),
  )
  const { width, height } = decoded[0].info
  for (const input of decoded) {
    assert(
      input.info.width === width && input.info.height === height,
      `Fabric map dimensions differ: ${input.path}`,
    )
  }

  const pixels = width * height
  const packed = Buffer.allocUnsafe(pixels * 4)
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const target = pixel * 4
    for (let channel = 0; channel < 4; channel += 1) {
      packed[target + channel] = decoded[channel].data[pixel * decoded[channel].info.channels]
    }
  }

  const encoded = await sharp(packed, { raw: { width, height, channels: 4 } })
    .webp({ lossless: true, effort: 6 })
    .toBuffer()
  const check = await sharp(encoded).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert(check.info.width === width && check.info.height === height && check.info.channels === 4,
    'Packed fabric dimensions/channels changed.')
  assert(check.data.equals(packed), 'Packed fabric channel texels changed during WebP encoding.')

  publishBytes(encoded, fabricOutput)
  const sourceBytes = fabricInputs.reduce((sum, input) => sum + fs.statSync(input.path).size, 0)
  return {
    sourceBytes,
    outputBytes: encoded.byteLength,
    networkDeltaBytes: encoded.byteLength - sourceBytes,
    outputSha256: sha256(encoded),
    resolution: `${width}x${height}`,
    channels: Object.fromEntries(fabricInputs.map((input) => [input.channel, path.basename(input.path)])),
  }
}

async function convertLosslessPngs() {
  assert(fs.existsSync(pngSourceRoot), `Missing archived PNG source tree: ${pngSourceRoot}`)
  const sources = listFiles(pngSourceRoot)
    .filter((file) => path.extname(file).toLowerCase() === '.png')
    .sort()
  let sourceBytes = 0
  let outputBytes = 0
  let excludedBytes = 0
  let converted = 0

  for (const source of sources) {
    const relative = path.relative(pngSourceRoot, source)
    const bytes = fs.readFileSync(source)
    sourceBytes += bytes.byteLength
    if (excludedPngOutputs.has(relative)) {
      excludedBytes += bytes.byteLength
      continue
    }

    const encoded = await sharp(bytes).webp({ lossless: true, effort: 6 }).toBuffer()
    await assertSameDecodedRgba(bytes, encoded, relative)
    const destination = path.join(
      projectRoot,
      'public',
      relative.slice(0, -path.extname(relative).length) + '.webp',
    )
    publishBytes(encoded, destination)
    outputBytes += encoded.byteLength
    converted += 1
  }

  return {
    sources: sources.length,
    converted,
    sourceBytes,
    outputBytes,
    excludedBytes,
    savedBytes: sourceBytes - outputBytes,
  }
}

const [tent, fabric, losslessPngs] = await Promise.all([
  optimizeTent(),
  packFabric(),
  convertLosslessPngs(),
])
console.log(JSON.stringify({ tent, fabric, losslessPngs }, null, 2))
