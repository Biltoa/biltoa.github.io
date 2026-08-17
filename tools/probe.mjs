/**
 * Point samples of a frame at fractional coordinates.
 *
 * `imagestats.mjs` answers "is this region the right brightness"; this answers
 * "what colour is *that thing*" — the moon's disc, one aurora curtain, the sky
 * two degrees off the limb. Region averages cannot: the moon is a thousandth of
 * the frame and averages into the sky around it, and the whole point of a
 * feature like a halo is that it is a gradient over forty pixels.
 *
 *   node tools/probe.mjs tools/ref/target.png '[["moon",0.342,0.092,3]]'
 *
 * Each entry is `[name, xFraction, yFraction, radius]` — fractions so a
 * reference and a render of different sizes sample the same content, radius in
 * pixels of the box averaged around the point (default 2, i.e. 5x5).
 */

import sharp from 'sharp'

const file = process.argv[2]
const pts = JSON.parse(process.argv[3])

const { width, height } = await sharp(file).metadata()
const { data } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })

console.log(`${file}  ${width}x${height}`)
for (const [name, fx, fy, r = 2] of pts) {
  const cx = Math.round(fx * width)
  const cy = Math.round(fy * height)
  let n = 0
  const s = [0, 0, 0]
  let peak = 0
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const i = (y * width + x) * 3
      s[0] += data[i]
      s[1] += data[i + 1]
      s[2] += data[i + 2]
      peak = Math.max(peak, data[i], data[i + 1], data[i + 2])
      n++
    }
  }
  const m = s.map((v) => Math.round(v / n))
  console.log(
    `  ${name.padEnd(16)} px(${String(cx).padStart(4)},${String(cy).padStart(4)})  ` +
      `rgb(${m.join(',').padEnd(12)}) #${m.map((v) => v.toString(16).padStart(2, '0')).join('')}  peak ${peak}`
  )
}
