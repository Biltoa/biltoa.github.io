/* -------------------------------------------------------------------------- */
/*  Bakes a normal map out of a painted canvas.                                 */
/*                                                                              */
/*  This used to sit under a procedural cobble generator for the paved walkway   */
/*  around the fire. The paving is gone — the camp stands on trodden earth now,   */
/*  which the pack's own dirt maps cover — and the baker outlived it: the book's  */
/*  cover leather is still a painted height field, and a surface built that way   */
/*  should not also ship a hand-authored normal map for the two to disagree over. */
/* -------------------------------------------------------------------------- */

/**
 * Bakes a tangent-space normal map from a canvas's luminance, with a Sobel
 * filter and wrap-around sampling so the result tiles wherever the source did.
 *
 * Sign convention: green takes the canvas gradient un-negated while red is
 * flipped, which is what ordinary meshes with stock UVs expect — and also what
 * a ground plane rotated so its +v runs along world -Z expects (see
 * parallax.ts), so both cases agree.
 */
export function normalMapFromCanvas(src: HTMLCanvasElement, strength = 3) {
  const size = src.width
  const h = src.height
  /*
    `willReadFrequently` matters more than it looks.

    A 2D canvas is GPU-backed by default, and `getImageData` on one is a
    readback: it has to flush every drawing command still queued and then stall
    the CPU until the pixels come back across the bus. The canvas this is handed
    — the book's cover leather — is two and a half thousand radial gradients
    deep by the time it gets here, and profiled across a tent click that single
    read was 2.7 seconds of a 9.5-second freeze.

    The hint asks for a CPU-backed canvas instead, where the read is a memcpy.
    It is the right trade for this canvas: it is drawn exactly once, read
    exactly once, and then only ever uploaded as a texture.

    It has to be requested on the *first* `getContext` call for the canvas to
    take effect, which is why the caller passes an already-hinted canvas and
    this only asserts the same options rather than creating its own.
  */
  const sctx = src.getContext('2d', { willReadFrequently: true })!
  const data = sctx.getImageData(0, 0, size, h).data
  const lum = new Float32Array(size * h)
  for (let i = 0; i < size * h; i++) {
    lum[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255
  }

  const out = document.createElement('canvas')
  out.width = size
  out.height = h
  const octx = out.getContext('2d')!
  const img = octx.createImageData(size, h)
  const at = (x: number, y: number) => lum[((y + h) % h) * size + ((x + size) % size)]

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      const du =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
      const dv =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
      let nx = -du * strength
      let ny = dv * strength
      const inv = 1 / Math.hypot(nx, ny, 1)
      nx *= inv
      ny *= inv
      const i = (y * size + x) * 4
      img.data[i] = (nx * 0.5 + 0.5) * 255
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255
      img.data[i + 2] = inv * 255
      img.data[i + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)
  return out
}
