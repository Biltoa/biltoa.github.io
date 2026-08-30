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
 *
 * A half is `0.5 - PAGE_GUTTER` across, so this is `(0.5 - PAGE_GUTTER) *
 * PAGE_H / PAGE_W` = 0.498 * 1180 / 796. It went 0.72 -> 0.738 when the page
 * blocks were closed up to the fold and each half got wider by the difference.
 */
export const PAGE_DEPTH = 0.738
/**
 * Half-width of the gap the *boards* leave for the spine.
 *
 * Floored by `SQUARE / 2`: a board is `0.5 - GUTTER + SQUARE` wide and sits
 * `SQUARE * 0.5` outboard of the gutter, so its inner edge lands at
 * `-GUTTER + SQUARE / 2` — take GUTTER below half a square and the two boards
 * cross the centre line and z-fight each other.
 */
export const GUTTER = 0.014
/**
 * Half-width of the gap between the two *page blocks* — a hairline, not the
 * board gutter.
 *
 * The blocks used to stop at GUTTER as well, which left 28mm of book between
 * them: from the reading pose that gap read as a blue channel down the middle
 * of the spread with two separate slabs of paper either side of it, and the
 * turning sheet crossed open air over it on every page flip. Real facing pages
 * meet at the fold. This closes them to a seam the gutter bridge (see
 * `buildGutter`) fills, and the boards stay where they are underneath.
 *
 * Not zero: at zero the blocks' spine faces are coplanar and z-fight.
 */
export const PAGE_GUTTER = 0.002
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

/**
 * Height of the paper *at the fold*, relative to the board — `pageLift` at the
 * spine end, past the crest and down in the gutter.
 *
 * This, not `PAGE_MAX_LIFT`, is where a turning sheet is hinged: the fold is
 * the edge it pivots on and the one part of it that never leaves the book.
 * Hinging at the crest instead left the sheet's inner edge standing
 * `PAGE_MAX_LIFT - FOLD_LIFT` — about 16mm of book — clear of the gutter
 * through the middle of every turn, which is the page seen floating off the
 * binding while the rest of it swings.
 */
export const FOLD_LIFT = /* @__PURE__ */ pageLift(1)

/** Height of the printed surface at a given x, on a given half. */
export function pageTopY(side: 'left' | 'right', x: number) {
  const xFore = side === 'left' ? -0.5 : 0.5
  const xSpine = side === 'left' ? -PAGE_GUTTER : PAGE_GUTTER
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
  const xSpine = side === 'left' ? -PAGE_GUTTER : PAGE_GUTTER
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
  /**
   * How far the bridge runs *under* each block past the seam.
   *
   * Was 0.009, which is enough to hide the seam on a shut-flat spread and not
   * enough for the swing. While the front board is lifting, the left half
   * rotates off the fold and briefly uncovers everything between its own spine
   * edge and the bridge's — a slot a few millimetres wide, straight through to
   * the tent floor, which from the reading pose is a red hairline drawn down
   * the middle of a half-open book. Running the bridge out past the *boards'*
   * gutter closes it: there is no longer anywhere the two halves can part and
   * show daylight.
   *
   * The cost of the wider span is that a flat bridge would now poke up through
   * the page blocks, which climb away from the fold — so past the seam the
   * bridge follows the block's own underside instead of running straight. See
   * `yAt` below.
   */
  const OVER = 0.026
  const xL = -(PAGE_GUTTER + OVER)
  const xR = PAGE_GUTTER + OVER
  const FOLD_TOP = pageTopY('right', PAGE_GUTTER)
  /**
   * Height of the bridge at a given x.
   *
   * Flat across the seam itself, and tucked a fraction under the paper either
   * side of it, so the wide overlap is hidden by the blocks rather than
   * standing proud of them.
   */
  const yAt = (x: number) => {
    if (Math.abs(x) <= PAGE_GUTTER) return FOLD_TOP
    return pageTopY(x < 0 ? 'left' : 'right', x) - 0.0008
  }
  /**
   * Sag across the seam.
   *
   * Zero. What was left of it was only visible near the head of the spread,
   * where the reading camera looks along the valley rather than across it —
   * and a valley seen end-on is exactly what made the seam appear to change
   * width a fifth of the way down the page. The fold is a seam, not a channel;
   * anything that varies its apparent width is a fault.
   */
  const dip = 0
  const SEG = 24
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
      const x = THREE.MathUtils.lerp(xL, xR, t)
      pos.push(x, yAt(x) - Math.sin(Math.PI * t) * dip, z)
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

  /*
    A skirt down each edge to the boards.

    The bridge is a single-sided surface floating five centimetres of book above
    the spine. Seen from the reading pose while one half is up in the air, the
    eye gets under its outer edge and looks straight past it at the table. Two
    short walls dropping to the board close that off, and both are buried under
    paper the moment the journal is flat.
  */
  const skirt = (x: number, flip: boolean) => {
    const yTop = yAt(x)
    const a = pos.length / 3
    pos.push(x, yTop, -d, x, yTop, d, x, COVER_T, d, x, COVER_T, -d)
    uv.push(0, 0, 1, 0, 1, 1, 0, 1)
    if (flip) idx.push(a, a + 1, a + 2, a, a + 2, a + 3)
    else idx.push(a, a + 2, a + 1, a, a + 3, a + 2)
  }
  skirt(xL, true)
  skirt(xR, false)

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/* ---------------------------------------------------------------- textures */

/**
 * How a journal is bound.
 *
 * The three tents used to hold the same object three times over — one hide,
 * one stamp, one silhouette — with only a four-millimetre coloured rule under
 * the title telling them apart, which at the distance the camp is read from is
 * nothing at all. These are three different books: a boarded leather journal,
 * a cloth-bound field book with metal corners, and a patinated copper-faced
 * ledger.
 */
export type Binding = 'leather' | 'cloth' | 'copper'

/**
 * Which binding each tent's journal is in, by book index.
 *
 * All three now. The cloth field book and the copper ledger each carried their
 * own mark, their own corner furniture and a treeline along the foot, and three
 * differently-furnished boards read as three unrelated props rather than as one
 * camp's journals. They are the same boarded, gold-ruled journal; only the
 * leather's colour changes. See `BOARD_GROUND`.
 *
 * The type and the branches are kept: they cost nothing, and the covers were
 * three separate objects recently enough that having the second and third
 * treatments recoverable is worth more than deleting them.
 */
export const BINDINGS: Binding[] = ['leather', 'leather', 'leather']

/**
 * The colour each tent's board is dyed, by book index.
 *
 * Deep and low-chroma. A board painted at mid value comes back out of a tent
 * flooded with one strong colour wearing the tent's own hue — a navy cover under
 * the red tent read as pink — so each of these sits a long way under the tent
 * tint it belongs to and is only pulled a few per cent toward it in
 * `makeLeatherMaps`.
 *
 * Wine, navy, bronze: About, Gameplay, Projects.
 */
export const BOARD_GROUND = ['#3a1218', '#1c2c50', '#33240c']

/**
 * Cover material: grain, a scatter of wear, and a rule inset from the edge.
 * The albedo doubles as the height field for the normal map, so anything drawn
 * here is felt in the relief as well as seen in the colour.
 */
export function makeLeatherMaps(
  accent: string,
  seed = 17,
  binding: Binding = 'leather',
  ground?: string
) {
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

  // Each binding starts from its own ground, pulled a little toward the tent's
  // own colour so the journal still belongs to the room it is sitting in.
  // Kept dark. Each tent floods its journal with a single strong colour, and a
  // board painted at mid value comes back out of that light washed to the
  // tent's own hue — a navy cover under the red tent read as pink. Pulled only
  // a few per cent toward the accent for the same reason.
  const GROUND: Record<Binding, string> = {
    leather: '#0e1630',
    cloth: '#14261c',
    copper: '#6b4526',
  }
  const base = new THREE.Color(ground ?? GROUND[binding]).lerp(new THREE.Color(accent), 0.07)
  ctx.fillStyle = `#${base.getHexString()}`
  ctx.fillRect(0, 0, size, size)

  if (binding === 'cloth') {
    // Book cloth is a weave, not a hide: a fine even cross-hatch, with the
    // threads catching light in one direction only.
    for (const [dx, dy, a] of [
      [1, 0, 0.05],
      [0, 1, 0.038],
    ] as [number, number, number][]) {
      const n = size / 3
      for (let i = 0; i < n; i++) {
        const t = (i / n) * size
        // Every thread the same value, give or take. The first version picked
        // black or white per line at three times this alpha, which at the
        // board's tiling came out as tartan rather than as book cloth.
        ctx.strokeStyle = `rgba(0,0,0,${a * (0.7 + rnd() * 0.6)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(dx ? 0 : t, dy ? 0 : t)
        ctx.lineTo(dx ? size : t, dy ? size : t)
        ctx.stroke()
      }
    }
  } else if (binding === 'copper') {
    // Verdigris: the patina comes in as pools that have run and dried, so it
    // is soft-edged and it collects rather than spreading evenly.
    for (let i = 0; i < 46; i++) {
      const x = rnd() * size
      const y = rnd() * size
      const r = 14 + rnd() * 54
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      const teal = rnd() > 0.55
      g.addColorStop(0, teal ? 'rgba(64,148,134,0.26)' : 'rgba(38,24,12,0.28)')
      g.addColorStop(1, 'rgba(74,160,146,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    // Then the metal underneath showing through where it has been handled.
    for (let i = 0; i < 900; i++) {
      const x = rnd() * size
      const y = rnd() * size
      ctx.fillStyle = `rgba(222,164,96,${0.05 + rnd() * 0.1})`
      ctx.fillRect(x, y, 1 + rnd() * 3, 1 + rnd() * 2)
    }
  } else {
    // Grain: overlapping soft cells, which is what leather actually is.
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * size
      const y = rnd() * size
      const r = 2 + rnd() * 9
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      const v = rnd() > 0.5 ? 255 : 0
      g.addColorStop(0, `rgba(${v},${v},${v},${0.03 + rnd() * 0.035})`)
      g.addColorStop(1, `rgba(${v},${v},${v},0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Creases: long faint lines running with the hide.
  ctx.lineCap = 'round'
  for (let i = 0; i < (binding === 'leather' ? 90 : 40); i++) {
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

  // The double rule inset from the edge. On the leather journal it is blind —
  // an impression, drawn as a dark stroke with a lit one offset out of it. The
  // cloth and copper boards carry it as gilt and as an oxidised line instead,
  // which is what those two materials actually take.
  const inset = 34
  const RULES: Record<Binding, [number, string, number][]> = {
    // Gilt, not blind. A blind rule is an impression, and an impression on a
    // board this small at this distance is a smudge — the border simply was not
    // there. Tooled in gold it is the one line that says "bound" rather than
    // "textured rectangle", and it is what the reference board carries.
    leather: [
      [0, 'rgba(18,10,4,0.55)', 6],
      [-2, 'rgba(214,172,96,0.85)', 3],
    ],
    cloth: [
      [0, 'rgba(0,0,0,0.45)', 5],
      [-1, 'rgba(214,170,98,0.62)', 2.4],
    ],
    copper: [
      [0, 'rgba(20,12,6,0.45)', 5],
      [-1, 'rgba(96,190,175,0.55)', 2.4],
    ],
  }
  for (const [off, col, wdt] of RULES[binding]) {
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

  /*
    Two brass clasp straps down one edge.

    The board's UVs are its own extent mapped onto 0..1 (see the repeat below),
    so u = 0 is one long edge of the board and u = 1 is the other; which of them
    ends up at the spine on the front cover is fixed by the extrude and the flip
    and was found by looking at the render rather than derived. They are drawn
    into the board map rather than into the title plate so they take the room's
    light like the rest of the leather — an unlit strap on a lit board reads as
    a sticker.
  */
  {
    const h = size * 0.052
    const w = size * 0.085
    const x = size - w
    for (const cy of [size * 0.26, size * 0.74]) {
      const y = cy - h / 2
      const g = ctx.createLinearGradient(x, y, x, y + h)
      g.addColorStop(0, '#e6c186')
      g.addColorStop(0.42, '#c39a53')
      g.addColorStop(1, '#8a6a33')
      ctx.fillStyle = g
      ctx.beginPath()
      // Rounded on the inboard end only; the outboard end runs off the edge of
      // the board the way a strap wrapping the spine does.
      const r = h * 0.35
      ctx.moveTo(x + r, y)
      ctx.lineTo(size, y)
      ctx.lineTo(size, y + h)
      ctx.lineTo(x + r, y + h)
      ctx.quadraticCurveTo(x, y + h, x, y + h - r)
      ctx.lineTo(x, y + r)
      ctx.quadraticCurveTo(x, y, x + r, y)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(38,24,10,0.55)'
      ctx.lineWidth = 2
      ctx.stroke()
      // A dark seam down the middle, so the strap has a fold rather than being
      // a flat lozenge.
      ctx.strokeStyle = 'rgba(46,30,12,0.35)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x + r, cy)
      ctx.lineTo(size, cy)
      ctx.stroke()
    }
  }

  // Metal corner protectors on the field book. All four, because the board's
  // UVs are mapped from its own extent and which corner of the texture ends up
  // where on the front board is not something this function gets to know.
  if (binding === 'cloth') {
    const arm = 64
    for (const [cx, cy, sx, sy] of [
      [0, 0, 1, 1],
      [size, 0, -1, 1],
      [0, size, 1, -1],
      [size, size, -1, -1],
    ] as [number, number, number, number][]) {
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(sx, sy)
      const g = ctx.createLinearGradient(0, 0, arm, arm)
      g.addColorStop(0, '#e0bb78')
      g.addColorStop(0.55, '#b98f4e')
      g.addColorStop(1, '#8d6a35')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(arm, 0)
      ctx.lineTo(arm * 0.62, arm * 0.38)
      ctx.lineTo(arm * 0.38, arm * 0.62)
      ctx.lineTo(0, arm)
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = 'rgba(40,26,10,0.5)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.restore()
    }
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
