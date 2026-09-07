import sharp from 'sharp'

const [beforePath, afterPath, outputPath] = process.argv.slice(2)
if (!beforePath || !afterPath || !outputPath) {
  throw new Error('usage: node tools/qa/image-diff.mjs before.png after.png diff.png')
}

const beforeImage = sharp(beforePath).removeAlpha()
const afterImage = sharp(afterPath).removeAlpha()
const [beforeMeta, afterMeta] = await Promise.all([beforeImage.metadata(), afterImage.metadata()])
if (beforeMeta.width !== afterMeta.width || beforeMeta.height !== afterMeta.height) {
  throw new Error(`size mismatch: ${beforeMeta.width}x${beforeMeta.height} vs ${afterMeta.width}x${afterMeta.height}`)
}

const [before, after] = await Promise.all([beforeImage.raw().toBuffer(), afterImage.raw().toBuffer()])
const diff = Buffer.alloc(before.length)
let total = 0
let changed1 = 0
let changed2 = 0
let maximum = 0
for (let i = 0; i < before.length; i++) {
  const delta = Math.abs(before[i] - after[i])
  total += delta
  if (delta > 1) changed1++
  if (delta > 2) changed2++
  if (delta > maximum) maximum = delta
  diff[i] = Math.min(255, delta * 12)
}

await sharp(diff, {
  raw: { width: beforeMeta.width, height: beforeMeta.height, channels: 3 },
}).png().toFile(outputPath)

const samples = before.length
console.log(JSON.stringify({
  width: beforeMeta.width,
  height: beforeMeta.height,
  meanAbsoluteSubpixelDifference: total / samples,
  subpixelsOver1Percent: (changed1 / samples) * 100,
  subpixelsOver2Percent: (changed2 / samples) * 100,
  maximum,
  outputPath,
}, null, 2))
