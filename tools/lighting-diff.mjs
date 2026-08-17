/**
 * One-off region analysis for the lighting-rework comparison (LIGHTING_TUNING.md).
 * Not a general tool — region boxes are eyeballed against the two 1774x887 frames
 * in tools/shots/hero-baseline.png and tools/ref/target.png.
 *
 *   node tools/lighting-diff.mjs
 */
import sharp from 'sharp'

const CUR = process.argv[2] ?? 'tools/shots/hero-baseline.png'
const REF = process.argv[3] ?? 'tools/ref/target.png'

function hueOf(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max === min) return 0
  let h
  if (max === r) h = ((g - b) / (max - min)) % 6
  else if (max === g) h = (b - r) / (max - min) + 2
  else h = (r - g) / (max - min) + 4
  h *= 60
  if (h < 0) h += 360
  return h
}
const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

async function regionMean(file, box, { width, height }) {
  const [x0, y0, x1, y1] = box
  const left = Math.min(width - 1, Math.max(0, Math.round(x0 * width)))
  const top = Math.min(height - 1, Math.max(0, Math.round(y0 * height)))
  const w = Math.max(1, Math.min(width - left, Math.round((x1 - x0) * width)))
  const h = Math.max(1, Math.min(height - top, Math.round((y1 - y0) * height)))
  const { data } = await sharp(file).extract({ left, top, width: w, height: h }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let sr = 0, sg = 0, sb = 0, n = 0, sumLum = 0
  for (let i = 0; i < data.length; i += 3) {
    sr += data[i]; sg += data[i + 1]; sb += data[i + 2]
    sumLum += lumOf(data[i], data[i + 1], data[i + 2])
    n++
  }
  const r = sr / n, g = sg / n, b = sb / n
  return { r, g, b, lum: sumLum / n, hue: hueOf(r, g, b) }
}

async function percentileLum(file, pct, meta) {
  const { data } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const lums = []
  for (let i = 0; i < data.length; i += 3) lums.push(lumOf(data[i], data[i + 1], data[i + 2]))
  lums.sort((a, b) => a - b)
  return lums[Math.floor(lums.length * pct)]
}

function fmt(x) { return x.toFixed(1) }

async function main() {
  const curMeta = await sharp(CUR).metadata()
  const refMeta = await sharp(REF).metadata()
  console.log(`cur ${curMeta.width}x${curMeta.height}  ref ${refMeta.width}x${refMeta.height}`)

  // (a) outer grass, left/right 15%, lower half
  console.log('\n(a) outer grass — left/right 15%, lower half')
  for (const [label, box] of [
    ['left', [0.0, 0.5, 0.15, 1.0]],
    ['right', [0.85, 0.5, 1.0, 1.0]],
  ]) {
    const c = await regionMean(CUR, box, curMeta)
    const r = await regionMean(REF, box, refMeta)
    console.log(`  ${label.padEnd(6)} cur lum ${fmt(c.lum)} hue ${fmt(c.hue)}   ref lum ${fmt(r.lum)} hue ${fmt(r.hue)}   dLum ${fmt(c.lum - r.lum)}`)
  }

  // (b) global black level, 5th percentile
  console.log('\n(b) global 5th-percentile luminance')
  const c5 = await percentileLum(CUR, 0.05, curMeta)
  const r5 = await percentileLum(REF, 0.05, refMeta)
  console.log(`  cur ${fmt(c5)}   ref ${fmt(r5)}   d ${fmt(c5 - r5)}`)

  // (c) radial falloff from fire. Fire sits roughly at (0.5, 0.72) of frame in
  // both (composition locked). Sample small boxes at increasing radius along
  // a ray toward lower-left, avoiding benches/tents.
  console.log('\n(c) radial falloff from fire (toward lower-left)')
  const fireCx = 0.5, fireCy = 0.70
  for (const rad of [0.03, 0.08, 0.14, 0.22, 0.32, 0.45]) {
    const cx = fireCx - rad * 0.7
    const cy = Math.min(0.97, fireCy + rad * 0.5)
    const s = 0.03
    const box = [cx - s, cy - s, cx + s, cy + s]
    const c = await regionMean(CUR, box, curMeta)
    const r = await regionMean(REF, box, refMeta)
    console.log(`  r=${rad.toString().padEnd(4)} cur lum ${fmt(c.lum)}   ref lum ${fmt(r.lum)}   d ${fmt(c.lum - r.lum)}`)
  }

  // (d) foreground cots — top faces. Two cots roughly at x~0.30 and x~0.70, y~0.80
  console.log('\n(d) foreground cot top faces')
  for (const [label, box] of [
    ['cotLeft', [0.24, 0.76, 0.34, 0.82]],
    ['cotRight', [0.66, 0.76, 0.76, 0.82]],
  ]) {
    const c = await regionMean(CUR, box, curMeta)
    const r = await regionMean(REF, box, refMeta)
    console.log(`  ${label.padEnd(10)} cur lum ${fmt(c.lum)} hue ${fmt(c.hue)}   ref lum ${fmt(r.lum)} hue ${fmt(r.hue)}   dLum ${fmt(c.lum - r.lum)}`)
  }

  // (e) ground under torches — torches flank each tent doorway, roughly
  // x ~ 0.16/0.28 (About), 0.46/0.58 (Gameplay), 0.72/0.84 (Projects), y ~ 0.52
  console.log('\n(e) ground beneath torches vs surrounding grass')
  const torchX = [0.155, 0.285, 0.455, 0.575, 0.715, 0.845]
  for (let i = 0; i < torchX.length; i++) {
    const x = torchX[i]
    const box = [x - 0.02, 0.55, x + 0.02, 0.60]
    const c = await regionMean(CUR, box, curMeta)
    const r = await regionMean(REF, box, refMeta)
    console.log(`  torch${i}      cur lum ${fmt(c.lum)} hue ${fmt(c.hue)}   ref lum ${fmt(r.lum)} hue ${fmt(r.hue)}   dLum ${fmt(c.lum - r.lum)}`)
  }

  // (f) treeline band vs tent-roof band
  console.log('\n(f) treeline vs tent-roof band')
  for (const [label, box] of [
    ['treeline', [0.30, 0.14, 0.70, 0.24]],
    ['tentRoof', [0.42, 0.36, 0.58, 0.44]],
  ]) {
    const c = await regionMean(CUR, box, curMeta)
    const r = await regionMean(REF, box, refMeta)
    console.log(`  ${label.padEnd(10)} cur lum ${fmt(c.lum)} hue ${fmt(c.hue)}   ref lum ${fmt(r.lum)} hue ${fmt(r.hue)}   dLum ${fmt(c.lum - r.lum)}`)
  }

  // (g) grass in front of tent doorways
  console.log('\n(g) grass in front of tent doorways')
  const doorX = [0.20, 0.50, 0.80]
  for (let i = 0; i < doorX.length; i++) {
    const x = doorX[i]
    const box = [x - 0.035, 0.62, x + 0.035, 0.68]
    const c = await regionMean(CUR, box, curMeta)
    const r = await regionMean(REF, box, refMeta)
    console.log(`  door${i}       cur lum ${fmt(c.lum)} hue ${fmt(c.hue)}   ref lum ${fmt(r.lum)} hue ${fmt(r.hue)}   dLum ${fmt(c.lum - r.lum)}`)
  }
}

main()
