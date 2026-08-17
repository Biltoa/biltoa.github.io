/**
 * Region-average colour of a frame, for comparing a render against a reference
 * numerically instead of by eye.
 *
 * "Match this screenshot" is not a thing eyes are good at across a dozen
 * iterations — the eye adapts to whatever it saw last, and a scene that is
 * three percent too warm looks correct after ten minutes of staring at one
 * that is ten percent too warm. Region averages do not adapt.
 *
 * The grid is deliberately coarse and fixed in *fractions* of the frame, so a
 * 1600x900 render and a 1772x857 reference are still comparable cell for cell.
 */

import sharp from 'sharp'

/**
 * Named areas, in fractions of width/height: [x0, y0, x1, y1].
 *
 * Chosen to isolate the three things under discussion — the sky and its
 * display, the treeline, and the field at several distances from the fire —
 * rather than to cover the frame evenly.
 */
export const REGIONS = {
  skyTop: [0.30, 0.00, 0.70, 0.10],
  skyLeft: [0.02, 0.05, 0.22, 0.22],
  skyRight: [0.78, 0.05, 0.98, 0.22],
  treelineFar: [0.30, 0.14, 0.70, 0.26],
  treelineLeft: [0.03, 0.20, 0.24, 0.38],
  treelineRight: [0.76, 0.20, 0.97, 0.38],
  woodMid: [0.36, 0.34, 0.64, 0.46],
  grassFar: [0.06, 0.52, 0.26, 0.60],
  grassMidLeft: [0.14, 0.62, 0.34, 0.72],
  grassNearFire: [0.42, 0.60, 0.58, 0.66],
  grassFront: [0.30, 0.86, 0.70, 0.98],
  grassCorner: [0.01, 0.88, 0.14, 0.99],
}

/**
 * Mean sRGB triple of every region, 0-255.
 *
 * The means are computed off a raw pixel buffer rather than with sharp's own
 * `.stats()`, which looks at the *input* image and ignores everything queued in
 * front of it — so an `.extract().stats()` chain returns the average of the
 * whole frame, identically, for every region. It fails silently and plausibly:
 * twelve rows of the same colour look like a flat render, not like a broken
 * measurement.
 */
export async function regionStats(file) {
  const { width, height } = await sharp(file).metadata()
  const out = {}
  for (const [name, [x0, y0, x1, y1]] of Object.entries(REGIONS)) {
    const left = Math.round(x0 * width)
    const top = Math.round(y0 * height)
    const w = Math.max(1, Math.round((x1 - x0) * width))
    const h = Math.max(1, Math.round((y1 - y0) * height))
    const { data, info } = await sharp(file)
      .extract({ left, top, width: w, height: h })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const n = info.width * info.height
    const sum = [0, 0, 0]
    for (let i = 0; i < data.length; i += 3) {
      sum[0] += data[i]
      sum[1] += data[i + 1]
      sum[2] += data[i + 2]
    }
    out[name] = sum.map((s) => Math.round(s / n))
  }
  return out
}

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')

/** Rough perceptual descriptors, so a diff reads as words and not just numbers. */
function describe([r, g, b]) {
  const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const sat = max === 0 ? 0 : Math.round(((max - min) / max) * 100)
  let hue = 'grey'
  if (max - min > 6) {
    if (max === r) hue = g > b ? 'warm' : 'magenta'
    else if (max === g) hue = b > r ? 'teal' : 'green'
    else hue = r > g ? 'violet' : 'blue'
  }
  return { lum, sat, hue }
}

export function printStats(stats, label = '') {
  if (label) console.log(`\n${label}`)
  for (const [name, rgb] of Object.entries(stats)) {
    const d = describe(rgb)
    console.log(
      `  ${name.padEnd(15)} ${hex(rgb)}  rgb(${rgb.join(',').padEnd(11)})  ` +
        `lum ${String(d.lum).padStart(3)}  sat ${String(d.sat).padStart(3)}%  ${d.hue}`
    )
  }
}

/** Side-by-side of two frames, with the delta that matters for grading. */
export async function compare(mineFile, refFile) {
  const mine = await regionStats(mineFile)
  const ref = await regionStats(refFile)
  console.log(
    `\n  ${'region'.padEnd(15)} ${'mine'.padEnd(9)} ${'ref'.padEnd(9)} ` +
      `${'dLum'.padStart(5)} ${'dSat'.padStart(5)}  hue`
  )
  for (const name of Object.keys(REGIONS)) {
    const a = describe(mine[name])
    const b = describe(ref[name])
    const dl = a.lum - b.lum
    const ds = a.sat - b.sat
    const flag = Math.abs(dl) > 12 || Math.abs(ds) > 14 ? ' <<' : ''
    console.log(
      `  ${name.padEnd(15)} ${hex(mine[name]).padEnd(9)} ${hex(ref[name]).padEnd(9)} ` +
        `${String(dl).padStart(5)} ${String(ds).padStart(5)}  ${a.hue}/${b.hue}${flag}`
    )
  }
  return { mine, ref }
}
