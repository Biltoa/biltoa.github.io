/**
 * Vertical extent of the journal in a capture, in pixels.
 *
 * Compares the middle column against the same row far out to the left, which
 * is always tent wall or floor. The three tents are lit very differently — the
 * Gameplay board is blue against a blue sky — so a fixed colour test does not
 * carry across all of them; a row-wise difference does.
 *
 *   node tools/qa/measure.cjs cover-1
 */
const sharp = require('sharp')
;(async () => {
  const n = process.argv[2]
  const { data, info } = await sharp(`tools/shots/${n}.png`).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  const mid = Math.round(W / 2)
  const at = (x, y) => {
    const i = (y * W + x) * C
    return [data[i], data[i + 1], data[i + 2]]
  }
  let top = -1
  let bot = -1
  for (let y = 0; y < H; y++) {
    const a = at(mid, y)
    const b = at(Math.round(W * 0.14), y)
    const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
    if (d > 70) {
      if (top < 0) top = y
      bot = y
    }
  }
  console.log(n, 'topgap', top, 'botgap', H - bot, 'height', bot - top)
})()
