/**
 * Build the shipped campsite kit from the last pixel-approved runtime asset.
 *
 * The Blender export is useful as an authoring-data cross-check, but it does
 * not contain the later alpha-cutout and up-res texture patches. The archived
 * runtime input does, so it is the only safe source for a visual-equivalent
 * prune.
 *
 *   node tools/strip-kit.mjs
 *   node tools/strip-kit.mjs <input.glb> <output.glb>
 *   node tools/strip-kit.mjs <input.glb> <output.glb> --authoring <build.glb>
 *
 * Defaults:
 *   input:     tools/source/runtime-assets/campsite-kit.pre-prune.glb
 *   output:    public/models/campsite-kit.glb
 *   authoring: tools/build/campsite-kit.glb
 *
 * Input and output must be distinct. Output is written beside the destination
 * under a temporary name, round-tripped through NodeIO, checked with Khronos'
 * official glTF Validator, and atomically renamed only after every invariant
 * passes. The input is never modified.
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune } from '@gltf-transform/functions'
import validator from 'gltf-validator'

const KEEP = new Set([
  'TreeA',
  'TreeB',
  'TreeC',
  'GrassA',
  'GrassB',
  'Flowers_0',
  'Flowers_1',
  'Firewood',
  'FireRocks',
  'Bench',
  'Stone',
  'Torch',
  'Pillow7',
])

// Blender exports these auxiliary vertex-colour sets on a few props. They are
// absent from the pixel-approved runtime GLB and Three's glTF materials do not
// consume them. COLOR_0 is used and must remain byte-identical.
const UNUSED_COLOR_SEMANTICS = new Set(['COLOR_1', 'COLOR_2'])

const defaults = {
  input: 'tools/source/runtime-assets/campsite-kit.pre-prune.glb',
  output: 'public/models/campsite-kit.glb',
  authoring: 'tools/build/campsite-kit.glb',
}

function parseArgs(argv) {
  const positional = []
  let authoring = defaults.authoring
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--authoring') {
      if (!argv[i + 1]) throw new Error('--authoring requires a path')
      authoring = argv[++i]
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`)
    } else {
      positional.push(arg)
    }
  }
  if (positional.length > 2) throw new Error('expected at most <input.glb> <output.glb>')
  return {
    input: path.resolve(positional[0] ?? defaults.input),
    output: path.resolve(positional[1] ?? defaults.output),
    authoring: path.resolve(authoring),
  }
}

function hashBytes(array) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function accessorSignature(accessor) {
  if (!accessor) return null
  const array = accessor.getArray()
  if (!array) throw new Error(`accessor ${accessor.getName() || '(unnamed)'} has no data`)
  return {
    type: accessor.getType(),
    componentType: accessor.getComponentType(),
    normalized: accessor.getNormalized(),
    count: accessor.getCount(),
    arrayType: array.constructor.name,
    hash: hashBytes(array),
  }
}

function primitiveSignature(primitive) {
  const attributes = {}
  for (const semantic of primitive.listSemantics().sort()) {
    attributes[semantic] = accessorSignature(primitive.getAttribute(semantic))
  }
  return {
    mode: primitive.getMode(),
    indices: accessorSignature(primitive.getIndices()),
    attributes,
    targets: primitive.listTargets().map((target) =>
      Object.fromEntries(
        target
          .listSemantics()
          .sort()
          .map((semantic) => [semantic, accessorSignature(target.getAttribute(semantic))]),
      ),
    ),
  }
}

function nodeSignature(node) {
  return {
    matrix: node.getMatrix(),
    primitives: node.getMesh()?.listPrimitives().map(primitiveSignature) ?? [],
  }
}

function namedMeshNodes(document, name) {
  return document
    .getRoot()
    .listNodes()
    .filter((node) => node.getName() === name && node.getMesh())
}

/**
 * Refuse a stale authoring export. The runtime archive may omit only the
 * explicitly audited COLOR_1/COLOR_2 supersets; every retained transform,
 * primitive, index and runtime accessor must otherwise match byte-for-byte.
 */
function verifyAuthoringData(runtimeDocument, authoringDocument) {
  const ignored = []
  for (const name of [...KEEP].sort()) {
    const runtimeNodes = namedMeshNodes(runtimeDocument, name)
    const authoringNodes = namedMeshNodes(authoringDocument, name)
    if (runtimeNodes.length !== 1 || authoringNodes.length !== 1) {
      throw new Error(
        `${name}: expected one mesh node (runtime=${runtimeNodes.length}, authoring=${authoringNodes.length})`,
      )
    }

    const runtime = nodeSignature(runtimeNodes[0])
    const authoring = nodeSignature(authoringNodes[0])
    if (JSON.stringify(runtime.matrix) !== JSON.stringify(authoring.matrix)) {
      throw new Error(`${name}: authoring node transform does not match approved runtime source`)
    }
    if (runtime.primitives.length !== authoring.primitives.length) {
      throw new Error(`${name}: authoring primitive count does not match approved runtime source`)
    }

    for (let i = 0; i < runtime.primitives.length; i++) {
      const runtimePrimitive = runtime.primitives[i]
      const authoringPrimitive = authoring.primitives[i]
      if (runtimePrimitive.mode !== authoringPrimitive.mode) {
        throw new Error(`${name}[${i}]: primitive mode mismatch`)
      }
      if (JSON.stringify(runtimePrimitive.indices) !== JSON.stringify(authoringPrimitive.indices)) {
        throw new Error(`${name}[${i}]: index accessor mismatch`)
      }
      if (JSON.stringify(runtimePrimitive.targets) !== JSON.stringify(authoringPrimitive.targets)) {
        throw new Error(`${name}[${i}]: morph-target accessor mismatch`)
      }

      const runtimeSemantics = Object.keys(runtimePrimitive.attributes).sort()
      const authoringSemantics = Object.keys(authoringPrimitive.attributes).sort()
      for (const semantic of runtimeSemantics) {
        if (
          JSON.stringify(runtimePrimitive.attributes[semantic]) !==
          JSON.stringify(authoringPrimitive.attributes[semantic])
        ) {
          throw new Error(`${name}[${i}]: ${semantic} accessor mismatch`)
        }
      }
      for (const semantic of authoringSemantics.filter((item) => !runtimeSemantics.includes(item))) {
        if (!UNUSED_COLOR_SEMANTICS.has(semantic)) {
          throw new Error(`${name}[${i}]: unexpected authoring-only attribute ${semantic}`)
        }
        ignored.push(`${name}[${i}].${semantic}`)
      }
      for (const semantic of runtimeSemantics.filter((item) => !authoringSemantics.includes(item))) {
        throw new Error(`${name}[${i}]: authoring export is missing runtime attribute ${semantic}`)
      }
    }
  }
  return ignored
}

function textureSignature(texture) {
  if (!texture) return null
  const image = texture.getImage()
  if (!image) throw new Error(`texture ${texture.getName() || '(unnamed)'} has no embedded image`)
  return {
    name: texture.getName(),
    mimeType: texture.getMimeType(),
    byteLength: image.byteLength,
    hash: hashBytes(image),
  }
}

function textureSlotSignature(material, textureGetter, infoGetter) {
  const texture = material[textureGetter]()
  if (!texture) return null
  const info = material[infoGetter]()
  return {
    texture: textureSignature(texture),
    texCoord: info?.getTexCoord() ?? 0,
    magFilter: info?.getMagFilter() ?? null,
    minFilter: info?.getMinFilter() ?? null,
    wrapS: info?.getWrapS() ?? null,
    wrapT: info?.getWrapT() ?? null,
  }
}

function retainedMaterials(document) {
  const materials = new Set()
  for (const node of document.getRoot().listNodes()) {
    if (!KEEP.has(node.getName())) continue
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const material = primitive.getMaterial()
      if (material) materials.add(material)
    }
  }
  return [...materials].sort((a, b) => a.getName().localeCompare(b.getName()))
}

function visibleMaterialSignature(document) {
  return retainedMaterials(document).map((material) => {
    const emissiveStrength = material
      .listExtensions()
      .find((extension) => typeof extension.getEmissiveStrength === 'function')
    return {
      name: material.getName(),
      baseColorFactor: material.getBaseColorFactor(),
      emissiveFactor: material.getEmissiveFactor(),
      emissiveStrength: emissiveStrength?.getEmissiveStrength() ?? 1,
      metallicFactor: material.getMetallicFactor(),
      roughnessFactor: material.getRoughnessFactor(),
      alphaMode: material.getAlphaMode(),
      alphaCutoff: material.getAlphaCutoff(),
      doubleSided: material.getDoubleSided(),
      normalScale: material.getNormalScale(),
      occlusionStrength: material.getOcclusionStrength(),
      baseColor: textureSlotSignature(
        material,
        'getBaseColorTexture',
        'getBaseColorTextureInfo',
      ),
      normal: textureSlotSignature(material, 'getNormalTexture', 'getNormalTextureInfo'),
      emissive: textureSlotSignature(
        material,
        'getEmissiveTexture',
        'getEmissiveTextureInfo',
      ),
      occlusion: textureSlotSignature(
        material,
        'getOcclusionTexture',
        'getOcclusionTextureInfo',
      ),
    }
  })
}

function retainedNodeSignatures(document) {
  return Object.fromEntries(
    [...KEEP]
      .sort()
      .map((name) => [name, namedMeshNodes(document, name).map(nodeSignature)]),
  )
}

function verifyOutput(document, approvedNodes, approvedMaterials) {
  const names = document
    .getRoot()
    .listNodes()
    .filter((node) => node.getMesh())
    .map((node) => node.getName())
    .sort()
  const expected = [...KEEP].sort()
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`output mesh-node set mismatch: ${names.join(', ')}`)
  }

  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      for (const semantic of UNUSED_COLOR_SEMANTICS) {
        if (primitive.getAttribute(semantic)) throw new Error(`output retained ${semantic}`)
      }
    }
  }
  for (const material of document.getRoot().listMaterials()) {
    if (material.getMetallicRoughnessTexture()) {
      throw new Error(`${material.getName()}: output retained metallicRoughnessTexture`)
    }
  }
  if (JSON.stringify(retainedNodeSignatures(document)) !== JSON.stringify(approvedNodes)) {
    throw new Error('retained node/mesh/accessor data changed during prune')
  }
  if (JSON.stringify(visibleMaterialSignature(document)) !== JSON.stringify(approvedMaterials)) {
    throw new Error('visible material settings or texture pixels changed during prune')
  }
}

function modelStats(document) {
  const root = document.getRoot()
  let primitives = 0
  let triangles = 0
  let renderVertices = 0
  let uploadVertices = 0
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      primitives++
      const indices = primitive.getIndices()
      const position = primitive.getAttribute('POSITION')
      const rendered = indices?.getCount() ?? position?.getCount() ?? 0
      renderVertices += rendered
      uploadVertices += position?.getCount() ?? 0
      if (primitive.getMode() === 4) triangles += rendered / 3
    }
  }
  return {
    meshes: root.listMeshes().length,
    primitives,
    triangles,
    renderVertices,
    uploadVertices,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
  }
}

const paths = parseArgs(process.argv.slice(2))
if (paths.input === paths.output) throw new Error('input and output paths must be distinct')

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const [document, authoringDocument] = await Promise.all([
  io.read(paths.input),
  io.read(paths.authoring),
])
const beforeBytes = (await fs.stat(paths.input)).size
const ignoredAuthoringAttributes = verifyAuthoringData(document, authoringDocument)
const approvedNodes = retainedNodeSignatures(document)
const approvedMaterials = visibleMaterialSignature(document)

const root = document.getRoot()
const dropped = []
for (const node of root.listNodes()) {
  if (!node.getMesh() || KEEP.has(node.getName())) continue
  dropped.push(node.getName())
  node.dispose()
}

for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    for (const semantic of UNUSED_COLOR_SEMANTICS) {
      if (primitive.getAttribute(semantic)) primitive.setAttribute(semantic, null)
    }
  }
}
for (const material of root.listMaterials()) material.setMetallicRoughnessTexture(null)

// Do not deduplicate materials: names and independent material instances are
// used by the runtime preparation pass. Other exact-value properties are safe.
await document.transform(
  prune(),
  dedup({ propertyTypes: ['Accessor', 'Texture', 'Mesh', 'Skin'] }),
)
verifyOutput(document, approvedNodes, approvedMaterials)

await fs.mkdir(path.dirname(paths.output), { recursive: true })
const outputExtension = path.extname(paths.output)
const outputStem = paths.output.slice(0, -outputExtension.length)
const tempPath = `${outputStem}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}${outputExtension}`
try {
  await io.write(tempPath, document)
  const tempBytes = await fs.readFile(tempPath)
  const roundTripped = await io.read(tempPath)
  verifyOutput(roundTripped, approvedNodes, approvedMaterials)

  const validation = await validator.validateBytes(new Uint8Array(tempBytes), {
    uri: path.basename(paths.output),
    format: 'glb',
    maxIssues: 0,
    writeTimestamp: false,
  })
  if (validation.issues.numErrors > 0) {
    const errors = validation.issues.messages
      .filter((issue) => issue.severity === 0)
      .map((issue) => `${issue.code}: ${issue.message}${issue.pointer ? ` (${issue.pointer})` : ''}`)
      .join('\n')
    throw new Error(
      `official glTF Validator found ${validation.issues.numErrors} error(s):\n${errors}`,
    )
  }

  await fs.rename(tempPath, paths.output)
  const afterBytes = (await fs.stat(paths.output)).size
  const stats = modelStats(roundTripped)
  const saved = beforeBytes - afterBytes

  console.log(`input:  ${path.relative(process.cwd(), paths.input)}`)
  console.log(`output: ${path.relative(process.cwd(), paths.output)}`)
  console.log(`authoring gate: all 13 retained runtime meshes/accessors match byte-for-byte`)
  console.log(
    `authoring-only attributes removed: ${ignoredAuthoringAttributes.join(', ') || '(none)'}`,
  )
  console.log(`dropped (${dropped.length}): ${dropped.sort().join(', ') || '(none)'}`)
  console.log(`kept (${KEEP.size}): ${[...KEEP].sort().join(', ')}`)
  console.log(
    `model: ${stats.meshes} meshes, ${stats.primitives} primitives, ` +
      `${stats.triangles} triangles, ${stats.renderVertices} render vertices, ` +
      `${stats.uploadVertices} upload vertices, ${stats.materials} materials, ` +
      `${stats.textures} textures`,
  )
  console.log(
    `bytes: ${beforeBytes} -> ${afterBytes} ` +
      `(saved ${saved}, ${((saved / beforeBytes) * 100).toFixed(2)}%)`,
  )
  console.log(
    `validator: ${validation.issues.numErrors} errors, ` +
      `${validation.issues.numWarnings} warnings, ${validation.issues.numInfos} infos, ` +
      `${validation.issues.numHints} hints`,
  )
} catch (error) {
  await fs.rm(tempPath, { force: true })
  throw error
}
