import * as THREE from 'three'
import { normalMapFromCanvas } from './stone'

/* -------------------------------------------------------------------------- */
/*  The journal's parts, built in code.                                         */
/*                                                                              */
/*  Everything here is expressed in a frame where the *open spread* is one unit  */
/*  wide, so the scene only ever has to state the book's real-world width.       */
/*  +X runs across the spread, +Z toward the reader, +Y up. The spine is the     */
/*  line x = 0.                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Depth of a page, front to back.
 *
 * Chosen so that one page's footprint has the same aspect as the canvas the
 * painter draws on (`PAGE_W / PAGE_H` in bookPaint.ts). Anything else stretches
 * the type in one axis, which on a serif face is immediately obvious.
 */
export const PAGE_DEPTH = 0.72
/** Half-width of the gap the spine occupies between the two page blocks. */
export const GUTTER = 0.014
/** Board thickness. */
export const COVER_T = 0.018
/** How far the boards stand proud of the paper on the three outer edges. */
export const SQUARE = 0.015
/** Thickness of a page block at its fore edge, where it rests on the board. */
export const BLOCK_FORE = 0.028
/**
 * Extra height the paper gains climbing toward the spine.
 *
 * Modest, and the reason is the *shut* book rather than the open one. The bow
 * makes each half a wedge — thin at the fore edge, thick at the spine — and
 * when the left half flips over onto the right the two wedges oppose, drawing
 * an X across the fore edge that nothing about a closed book explains. Real
 * paper solves this by not being rigid; here it is solved by keeping the wedge
 * shallow enough not to read.
 */
export const BOW = 0.036
/** How far it then drops into the gutter. */
export const GUTTER_DIP = 0.024

/**
 * Height of the paper above the board, as a function of position across the
 * half: 0 at the fore edge, 1 at the spine.
 *
 * An open book is not flat. The stack is thickest near the binding, so the
 * paper climbs from the fore edge, crests a little short of the spine, then
 * falls away into the gutter. That crest-and-valley is most of what makes a
 * rendered book look like paper rather than like two cards.
 */
export function pageLift(u: number) {
  return BOW * Math.pow(Math.max(0, u), 1.6) - GUTTER_DIP * smoothstep(0.86, 1, u)
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Height of the spine hinge: the *highest* point of a text block.
 *
 * The closed state is the open one with the left half rotated 180 degrees about
 * this line, so the pivot decides where the flipped half lands. Put it at the
 * middle of the block and the two halves occupy the same space — they
 * interpenetrate, their fore edges end up coplanar, and the shut journal shows
 * a pale wedge where two page blocks z-fight. Put it at the crest and the left
 * half comes to rest exactly on top of the right one, which is both correct and
 * what makes a shut book twice the thickness of an open half.
 */
export const PAGE_MAX_LIFT = /* @__PURE__ */ (() => {
  let max = 0
  for (let i = 0; i <= 40; i++) max = Math.max(max, pageLift(i / 40))
  return max
})()

export const HINGE_Y = COVER_T + BLOCK_FORE + PAGE_MAX_LIFT

/** Height of the printed surface at a given x, on a given half. */
export function pageTopY(side: 'left' | 'right', x: number) {
  const xFore = side === 'left' ? -0.5 : 0.5
  const xSpine = side === 'left' ? -GUTTER : GUTTER
  return COVER_T + BLOCK_FORE + pageLift((x - xFore) / (xSpine - xFore))
}

/* ------------------------------------------------------------------ blocks */

export interface PageBlock {
  geometry: THREE.BufferGeometry
  /** Footprint of the printed surface, for placing hit targets on it. */
  bounds: THREE.Box3
}

/**
 * One half of the text block: the stack of leaves, with the top face carrying
 * the printed page.
 *
 * Built as a single geometry with two material groups — group 0 is the printed
 * top, group 1 is the fore edge and the underside. That matters: the previous
 * journal floated a separate painted quad a millimetre above a downloaded
 * model, and no amount of tuning the gap fixed the fact that it was a second
 * object. Here the printed surface *is* the top of the block, so there is
 * nothing to float.
 */
export function buildPageBlock(side: 'left' | 'right', nx = 26, nz = 4): PageBlock {
  const xFore = side === 'left' ? -0.5 : 0.5
  const xSpine = side === 'left' ? -GUTTER : GUTTER
  const xMin = Math.min(xFore, xSpine)
  const xMax = Math.max(xFore, xSpine)
  const zMin = -PAGE_DEPTH / 2
  const zMax = PAGE_DEPTH / 2

  const pos: number[] = []
  const uv: number[] = []
  const top: number[] = []
  const rest: number[] = []

  const yAt = (x: number) => {
    // u is 0 at the fore edge and 1 at the spine, whichever side that is.
    const u = (x - xFore) / (xSpine - xFore)
    return COVER_T + BLOCK_FORE + pageLift(u)
  }

  const push = (x: number, y: number, z: number, u: number, v: number) => {
    pos.push(x, y, z)
    uv.push(u, v)
    return pos.length / 3 - 1
  }

  /* ------------------------------------------------------------ printed top */

  // Vertex u runs with +x on both halves, and v is 1 at the far (-Z) edge, so
  // the canvas's own top-left corner lands at the top-left of the page as the
  // reader sees it. Deriving this from the geometry rather than projecting the
  // texture through a separate matrix is what fixes the clipped headings: the
  // old projection used the *model's* bounding box while the painted quad was
  // inset inside it, so the first few percent of every page fell off the top.
  const grid: number[][] = []
  for (let j = 0; j <= nz; j++) {
    const row: number[] = []
    const z = THREE.MathUtils.lerp(zMin, zMax, j / nz)
    const v = 1 - j / nz
    for (let i = 0; i <= nx; i++) {
      const x = THREE.MathUtils.lerp(xMin, xMax, i / nx)
      row.push(push(x, yAt(x), z, i / nx, v))
    }
    grid.push(row)
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = grid[j][i]
      const b = grid[j][i + 1]
      const c = grid[j + 1][i + 1]
      const d = grid[j + 1][i]
      top.push(a, d, c, a, c, b)
    }
  }

  /* -------------------------------------------------- fore edge and underside */

  /**
   * A vertical quad from a top-edge point down to the board.
   *
   * `flip` picks the winding. Getting this wrong is not subtle and is not
   * obviously a winding problem when you see it: back-facing walls let the lit
   * interior of the block show through, which draws a bright sawtooth along the
   * head of every page where the triangles alternate.
   *
   * Both UV axes are keyed to *world* size rather than to the quad's own
   * parameter range. The block is a wedge — a couple of millimetres thick at
   * the fore edge and three times that at the spine — so stretching a fixed v
   * range over it packs the leaf lines together at one end and pulls them apart
   * at the other, which reads as a pale triangular wedge across the edge rather
   * than as a stack of paper.
   */
  const EDGE_V_PER_UNIT = 10
  const EDGE_U_PER_UNIT = 6
  const wall = (x0: number, z0: number, x1: number, z1: number, flip: boolean) => {
    const u0 = (x0 === x1 ? z0 : x0) * EDGE_U_PER_UNIT
    const u1 = (x0 === x1 ? z1 : x1) * EDGE_U_PER_UNIT
    const a = push(x0, yAt(x0), z0, u0, (yAt(x0) - COVER_T) * EDGE_V_PER_UNIT)
    const b = push(x1, yAt(x1), z1, u1, (yAt(x1) - COVER_T) * EDGE_V_PER_UNIT)
    const c = push(x1, COVER_T, z1, u1, 0)
    const d = push(x0, COVER_T, z0, u0, 0)
    if (flip) rest.push(a, b, c, a, c, d)
    else rest.push(a, c, b, a, d, c)
  }

  // Fore edge, in strips, so the wall follows the head-to-tail curve if one is
  // ever added. Head and tail run the other way round.
  for (let j = 0; j < nz; j++) {
    const z0 = THREE.MathUtils.lerp(zMin, zMax, j / nz)
    const z1 = THREE.MathUtils.lerp(zMin, zMax, (j + 1) / nz)
    // Outward is +X on the right half and -X on the left.
    wall(xFore, z0, xFore, z1, side === 'right')
  }
  for (let i = 0; i < nx; i++) {
    const x0 = THREE.MathUtils.lerp(xMin, xMax, i / nx)
    const x1 = THREE.MathUtils.lerp(xMin, xMax, (i + 1) / nx)
    // Head faces -Z, tail faces +Z.
    wall(x0, zMin, x1, zMin, true)
    wall(x0, zMax, x1, zMax, false)
  }

  // Underside, facing -Y. Only ever seen once the cover has flipped shut.
  const u0 = push(xMin, COVER_T, zMin, 0, 0)
  const u1 = push(xMax, COVER_T, zMin, 1, 0)
  const u2 = push(xMax, COVER_T, zMax, 1, 0.3)
  const u3 = push(xMin, COVER_T, zMax, 0, 0.3)
  rest.push(u0, u1, u2, u0, u2, u3)

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex([...top, ...rest])
  g.addGroup(0, top.length, 0)
  g.addGroup(top.length, rest.length, 1)
  g.computeVertexNormals()
  g.computeBoundingBox()

  return {
    geometry: g,
    bounds: new THREE.Box3(
      new THREE.Vector3(xMin, COVER_T, zMin),
      new THREE.Vector3(xMax, yAt(xSpine), zMax)
    ),
  }
}

/* ------------------------------------------------------------------ boards */

/**
 * A cover board: a rounded rectangle extruded to thickness, with a bevel on
 * both faces.
 *
 * Square corners are the giveaway on a rendered book. Real boards are cut
 * square and then the covering material wraps the edge, which rounds it by a
 * millimetre or two — small enough that nobody names it, large enough that its
 * absence reads as plastic.
 */
export function buildCover(side: 'left' | 'right') {
  const w = 0.5 - GUTTER + SQUARE
  const d = PAGE_DEPTH + SQUARE * 2
  const r = 0.022

  const shape = new THREE.Shape()
  const hw = w / 2
  const hd = d / 2
  shape.moveTo(-hw + r, -hd)
  shape.lineTo(hw - r, -hd)
  shape.quadraticCurveTo(hw, -hd, hw, -hd + r)
  shape.lineTo(hw, hd - r)
  shape.quadraticCurveTo(hw, hd, hw - r, hd)
  shape.lineTo(-hw + r, hd)
  shape.quadraticCurveTo(-hw, hd, -hw, hd - r)
  shape.lineTo(-hw, -hd + r)
  shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd)

  const bevel = 0.0035
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: COVER_T - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 5,
  })
  // Extrusion runs along +Z; stand it up so it runs along +Y instead.
  g.rotateX(-Math.PI / 2)
  // Then place it: outer edge flush with the squares, sitting on y = 0.
  const cx = side === 'left' ? -(GUTTER + w / 2) + SQUARE * 0.5 : GUTTER + w / 2 - SQUARE * 0.5
  g.translate(cx, bevel, 0)
  g.computeVertexNormals()
  return g
}

/**
 * The spine: a shallow arch bridging the two boards.
 *
 * Modelled rather than faked with a flat strip, because when the journal is
 * shut this is the only part of it with any silhouette, and a flat one makes
 * the book read as a folded card.
 */
export function buildSpine() {
  const halfW = GUTTER + 0.008
  const d = PAGE_DEPTH + SQUARE * 2
  const SEG = 14
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []

  const rows: number[][] = []
  for (let j = 0; j <= 1; j++) {
    const z = (j === 0 ? -1 : 1) * (d / 2)
    const row: number[] = []
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG
      const a = Math.PI * t
      const x = -halfW + 2 * halfW * t
      // Drops below the boards at the ends and arches under the gutter, which
      // is the profile of a rounded back.
      const y = COVER_T * 0.5 - Math.sin(a) * 0.026
      pos.push(x, y, z)
      uv.push(t, j)
      row.push(pos.length / 3 - 1)
    }
    rows.push(row)
  }
  for (let i = 0; i < SEG; i++) {
    const a = rows[0][i]
    const b = rows[0][i + 1]
    const c = rows[1][i + 1]
    const dd = rows[1][i]
    idx.push(a, b, c, a, c, dd)
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/**
 * The gutter: the surface that closes the valley between the two halves.
 *
 * Without it you look straight down through the gap between the text blocks,
 * past the gap between the boards, and out at whatever is under the book — which
 * from the reading pose reads as a row of dark slots down the middle of the
 * spread rather than as a binding.
 */
export function buildGutter() {
  const yL = pageTopY('left', -GUTTER)
  const yR = pageTopY('right', GUTTER)
  const dip = 0.026
  const SEG = 10
  const d = PAGE_DEPTH / 2

  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const rows: number[][] = []

  for (let j = 0; j <= 1; j++) {
    const z = (j === 0 ? -1 : 1) * d
    const row: number[] = []
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG
      pos.push(-GUTTER + 2 * GUTTER * t, THREE.MathUtils.lerp(yL, yR, t) - Math.sin(Math.PI * t) * dip, z)
      uv.push(t, j)
      row.push(pos.length / 3 - 1)
    }
    rows.push(row)
  }
  for (let i = 0; i < SEG; i++) {
    const a = rows[0][i]
    const b = rows[0][i + 1]
    const c = rows[1][i + 1]
    const dd = rows[1][i]
    idx.push(a, dd, c, a, c, b)
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/* ---------------------------------------------------------------- textures */

/**
 * Cover leather: grain, a scatter of scuffs, and a blind-stamped rule inset
 * from the edge. The albedo doubles as the height field for the normal map.
 */
export function makeLeatherMaps(accent: string, seed = 17) {
  const size = 512
  const c = document.createElement('canvas')
  c.width = c.height = size
  // CPU-backed, because the albedo painted here is read straight back out
  // again as the height field for the normal map below — see the note in
  // stone.ts. The hint only applies on the first getContext call for a canvas,
  // so it has to be set here rather than where the read happens.
  const ctx = c.getContext('2d', { willReadFrequently: true })!

  let s = seed >>> 0 || 3
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)

  // Dark hide, pulled a little toward the tent's own colour so the three
  // journals are not identical objects.
  const base = new THREE.Color('#4a2a20').lerp(new THREE.Color(accent), 0.16)
  ctx.fillStyle = `#${base.getHexString()}`
  ctx.fillRect(0, 0, size, size)

  // Grain: overlapping soft cells, which is what leather actually is.
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const r = 2 + rnd() * 9
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const v = rnd() > 0.5 ? 255 : 0
    g.addColorStop(0, `rgba(${v},${v},${v},${0.05 + rnd() * 0.06})`)
    g.addColorStop(1, `rgba(${v},${v},${v},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Creases: long faint lines running with the hide.
  ctx.lineCap = 'round'
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`
    ctx.lineWidth = 1 + rnd() * 2.5
    ctx.beginPath()
    let x = rnd() * size
    let y = rnd() * size
    ctx.moveTo(x, y)
    for (let k = 0; k < 5; k++) {
      x += (rnd() - 0.5) * 90
      y += (rnd() - 0.5) * 90
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // Blind-stamped double rule. Two strokes, one dark and one light and offset,
  // which is what an impression in leather looks like from any one direction.
  const inset = 34
  for (const [off, col, wdt] of [
    [0, 'rgba(0,0,0,0.55)', 5],
    [-2, 'rgba(255,220,180,0.20)', 2],
  ] as [number, string, number][]) {
    ctx.strokeStyle = col
    ctx.lineWidth = wdt
    ctx.strokeRect(inset + off, inset + off, size - (inset + off) * 2, size - (inset + off) * 2)
    ctx.strokeRect(
      inset + 14 + off,
      inset + 14 + off,
      size - (inset + 14 + off) * 2,
      size - (inset + 14 + off) * 2
    )
  }

  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8

  const normalMap = new THREE.CanvasTexture(normalMapFromCanvas(c, 1.6))

  // One tile per board, exactly.
  //
  // ExtrudeGeometry's UVs are in *shape* units, so a board half a unit wide
  // samples half a tile — which put the stamped rule somewhere across the
  // middle of the cover and drew what looked like a grid rather than a border.
  // Mapping the board's own extent onto 0..1 lands the impression where it was
  // drawn: one rule, inset from the edge.
  const w = 0.5 - GUTTER + SQUARE
  const d = PAGE_DEPTH + SQUARE * 2
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1 / w, 1 / d)
    t.offset.set(0.5, 0.5)
  }

  return { map, normalMap, dispose: () => [map, normalMap].forEach((t) => t.dispose()) }
}

/**
 * The fore edge: a stack of individual leaves seen end-on.
 *
 * Tall and thin, tiled along the edge. The lines have to be irregular in both
 * spacing and value — an evenly ruled edge reads as corduroy.
 */
export function makeEdgeTexture(seed = 51) {
  const w = 64
  const h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!

  let s = seed >>> 0 || 5
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)

  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#d9c9a4')
  g.addColorStop(0.5, '#c3ae86')
  g.addColorStop(1, '#a8916c')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // One line per leaf, jittered.
  let y = 0
  while (y < h) {
    y += 1.4 + rnd() * 2.6
    ctx.strokeStyle = `rgba(70,48,26,${0.10 + rnd() * 0.30})`
    ctx.lineWidth = 0.6 + rnd() * 0.9
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  // Grubby patches, heavier at the top where the block is handled.
  for (let i = 0; i < 40; i++) {
    const x = rnd() * w
    const yy = rnd() * h
    const r = 4 + rnd() * 22
    const sg = ctx.createRadialGradient(x, yy, 0, x, yy, r)
    sg.addColorStop(0, `rgba(90,64,34,${0.05 + rnd() * 0.12})`)
    sg.addColorStop(1, 'rgba(90,64,34,0)')
    ctx.fillStyle = sg
    ctx.beginPath()
    ctx.arc(x, yy, r, 0, Math.PI * 2)
    ctx.fill()
  }

  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}
