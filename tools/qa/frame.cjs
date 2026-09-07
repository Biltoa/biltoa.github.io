/**
 * Normalised composition read of a closed-journal capture.
 *
 * Everything the framing brief is stated in — how wide the board is as a
 * fraction of the viewport, where it starts and stops down the frame, where
 * the tabletop's horizon falls, how much keystone the perspective is adding,
 * and where the two candle holders sit — measured rather than eyeballed. The
 * eye cannot hold a 3% width difference across a dozen iterations; this can.
 *
 *   node tools/qa/frame.cjs base-1810
 *
 * The board is found by hue, not by colour: below the horizon the tabletop is
 * orange (r > b) and the board is blue (b > r), which holds whether the
 * leather is rendered near-black or blown out to royal blue.
 */
const sharp = require('sharp')

;(async () => {
  const n = process.argv[2]
  const { data, info } = await sharp(`tools/shots/${n}.png`).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  const px = (x, y) => {
    const i = (y * W + x) * C
    return [data[i], data[i + 1], data[i + 2]]
  }
  const warm = (x, y) => {
    const [r, g, b] = px(x, y)
    return r - b > 30 && r > 40
  }
  const cool = (x, y) => {
    const [r, g, b] = px(x, y)
    return b - r > 12 && g < b
  }

  // Horizon: first row, out at the left quarter, where the tabletop starts.
  let horizon = -1
  for (let y = 0; y < H && horizon < 0; y++) {
    let hits = 0
    for (let x = Math.round(W * 0.2); x < Math.round(W * 0.34); x += 3) if (warm(x, y)) hits++
    if (hits > 12) horizon = y
  }

  // Board: middle-third pixels that differ from the far-left of the same row.
  //
  // A flat colour test cannot find the board at both ends of the frame: above
  // the horizon it stands against navy and below it against orange. A row-wise
  // difference against a column that is always background finds both, which is
  // what lets the top edge be measured where it pokes above the tabletop.
  let x0 = W, x1 = 0, y0 = H, y1 = 0
  const rowSpan = new Array(H).fill(null)
  const differs = (x, y) => {
    const a = px(x, y)
    const b = px(Math.round(W * 0.06), y)
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 55
  }
  for (let y = 4; y < H - 40; y++) {
    // Longest contiguous run, not first-to-last: the board's own cast shadow
    // and the tent behind it both answer the difference test in places, and a
    // first-to-last span quietly swallows everything between them.
    let a = -1, b = -1, run = -1, gap = 0
    for (let x = Math.round(W * 0.28); x < Math.round(W * 0.72); x++) {
      const on = cool(x, y) && differs(x, y)
      if (on) {
        if (run < 0) run = x
        gap = 0
      } else if (run >= 0 && ++gap > 6) {
        if (x - gap - run > b - a) { a = run; b = x - gap }
        run = -1
      }
    }
    if (run >= 0 && Math.round(W * 0.72) - run > b - a) { a = run; b = Math.round(W * 0.72) }

    // A run touching both edges of the search band is the background, not the
    // board: the sky's own vertical gradient answers the difference test.
    const lo = Math.round(W * 0.28)
    const hi = Math.round(W * 0.72)
    if (a > lo && b < hi && b - a > W * 0.08) {
      rowSpan[y] = [a, b]
      x0 = Math.min(x0, a); x1 = Math.max(x1, b)
      y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
  }

  const spanAt = (f) => {
    const y = Math.round(y0 + (y1 - y0) * f)
    for (let d = 0; d < 30; d++) {
      for (const yy of [y + d, y - d]) if (rowSpan[yy]) return rowSpan[yy][1] - rowSpan[yy][0]
    }
    return NaN
  }

  // Candle holders: the two warm-metal discs either side, found as the darkest
  // run in the outer thirds of the band the holders occupy.
  const holder = (lo, hi) => {
    let best = null
    for (let y = Math.round(H * 0.3); y < Math.round(H * 0.62); y += 2) {
      for (let x = Math.round(W * lo); x < Math.round(W * hi); x += 2) {
        const [r, g, b] = px(x, y)
        const v = r + g + b
        if (!best || v < best.v) best = { x, y, v }
      }
    }
    return best
  }
  const L = holder(0.1, 0.28)
  const R = holder(0.72, 0.9)

  const f = (v, d = 1) => (v / d * 100).toFixed(1) + '%'
  const top = spanAt(0.06)
  const bot = spanAt(0.94)
  console.log(`${n}  ${W}x${H}`)
  console.log(`  horizon      ${horizon}px  ${f(horizon, H)}`)
  console.log(`  book width   ${x1 - x0}px  ${f(x1 - x0, W)}`)
  console.log(`  book top     ${y0}px  ${f(y0, H)}`)
  console.log(`  book bottom  ${y1}px  ${f(y1, H)}`)
  console.log(`  book centre  x ${f((x0 + x1) / 2, W)}   y ${f((y0 + y1) / 2, H)}`)
  console.log(`  keystone     top ${top}px  bottom ${bot}px  ratio ${(bot / top).toFixed(3)}`)
  console.log(`  holders      L x ${f(L.x, W)} y ${f(L.y, H)}   R x ${f(R.x, W)} y ${f(R.y, H)}`)
})()
