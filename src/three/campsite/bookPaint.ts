import type { Line } from './bookContent'
import type { Binding } from './bookGeometry'

/* -------------------------------------------------------------------------- */
/*  Draws a journal page onto a canvas, which is then mapped onto the book's     */
/*  own page geometry. Doing it this way — rather than floating a DOM panel in   */
/*  front of the book — means the text bends with the paper, catches the same    */
/*  light, and disappears when the book closes, because it *is* the page.        */
/* -------------------------------------------------------------------------- */

/**
 * Canvas size for one page.
 *
 * The aspect has to match the page's real footprint (`PAGE_DEPTH` and the
 * half-width in bookGeometry.ts) or the type comes out stretched. It is the
 * *width* that was widened to make them agree rather than the height being
 * cut — shortening the canvas would have pushed the longer spreads past the
 * bottom margin and started dropping lines.
 */
export const PAGE_W = 796
export const PAGE_H = 1280

const MARGIN_X = 84
const MARGIN_TOP = 96
const MARGIN_BOTTOM = 104
const COL = PAGE_W - MARGIN_X * 2

/**
 * The page face.
 *
 * EB Garamond, and nothing else. The journal used to run a book serif for the
 * prose and a grotesque for the labels, kickers and page controls, which is a
 * document's habit rather than a journal's — one hand wrote all of this. The
 * whole book is set in the one face now, and the labels are separated from the
 * prose by weight and letter-spacing instead of by family.
 *
 * Garamond is an old-style face with a small x-height, so every size here is a
 * couple of points larger than the equivalent was: the page is read at a slant
 * through a curved surface at a couple of hundred pixels of texture per line,
 * and matching the old point sizes would have matched them at the cap height
 * rather than at the height the eye actually reads.
 */
const SERIF = "'EB Garamond', Georgia, 'Palatino Linotype', 'Times New Roman', serif"
/**
 * Kept as a name so the label voice stays visible in the code, but it is the
 * same face — see above.
 */
const SANS = SERIF

const INK = '#2b1a0e'
const INK_SOFT = '#3f2b1a'
// Warmer and a step darker than they were. The pages were coming out close
// enough to white that the spread glared under the candles, and paper this old
// has no business being brighter than the tent it is in.
const PAPER_A = '#d2c29c'
const PAPER_B = '#bda577'

/**
 * The tent's colour, darkened until it can be read as ink on this paper.
 *
 * The three journals take their accent from their tent's neon, and one of those
 * is `#ffc94a` — a yellow with almost exactly the luminance of the page it is
 * printed on, which makes every kicker in the projects journal invisible. Hue
 * is what identifies the tent, not brightness, so the hue is kept and the
 * luminance is pulled down until there is something to read.
 */
function inkAccent(accent: string, target = 0.34): string {
  const hex = accent.replace('#', '')
  if (hex.length !== 6) return accent

  let r = parseInt(hex.slice(0, 2), 16)
  let g = parseInt(hex.slice(2, 4), 16)
  let b = parseInt(hex.slice(4, 6), 16)

  // Rec. 709 luma, against paper that sits around 0.85.
  const luma = () => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  if (luma() > target) {
    const k = target / luma()
    r = Math.round(r * k)
    g = Math.round(g * k)
    b = Math.round(b * k)
  }

  return `rgb(${r}, ${g}, ${b})`
}

function mixInk(from: string, to: string, amount: number) {
  const parse = (value: string) => {
    const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1]
    if (hex) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ]
    }
    return (value.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number)
  }
  const a = parse(from)
  const b = parse(to)
  const t = Math.max(0, Math.min(1, amount))
  return `rgb(${a.map((channel, i) => Math.round(channel + (b[i] - channel) * t)).join(', ')})`
}

/** Normalised page rectangle, 0..1, origin top-left. */
export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Hit extends Rect {
  to: string
}

/** A print on the page, and what pressing it should do. */
export interface ImageHit extends Rect {
  src: string
  /** Where the plate links to, if it is a link. */
  to?: string
  /** Full-resolution file to open when the plate is pressed to look closer. */
  zoom?: string
}

export interface Painted {
  /** Clickable link rectangles found on the page. */
  hits: Hit[]
  /** Prints on the page. Every one of them is pressable. */
  images: ImageHit[]
  /** Footprint of the page-turn plate, if this page carries one. */
  turn: Rect | null
}

/* ------------------------------------------------------------------ prints */

/**
 * Images pasted into the journal.
 *
 * The painter is synchronous — it is called from a layout effect and from
 * inside a page turn, neither of which can wait on the network — so decoding
 * happens up front and the painter only ever reads this cache. A page painted
 * before its prints have landed draws their plates empty and is repainted once
 * `preloadBookImages` resolves.
 */
const prints = new Map<string, HTMLImageElement | null>()

/**
 * The decode still in flight for each source.
 *
 * Kept separately from `prints` and, crucially, handed back to later callers.
 * The first version claimed the source in `prints` with a null and then filtered
 * on `prints.has(src)`, so a second caller saw the source as already handled and
 * got an immediately-resolved promise — it repainted with nothing decoded, and
 * because nothing repainted again when the image finally landed, the plate
 * stayed empty for the life of the page. That is only visible if you turn to a
 * page while its print is still downloading, which is exactly what a reader
 * does and exactly what opening the page directly does not.
 */
const inflight = new Map<string, Promise<void>>()

function fetchPrint(src: string, onEach?: (src: string) => void): Promise<void> {
  const existing = inflight.get(src)
  // A second caller for the same source gets the decode already in flight, but
  // it still has to be told when that decode lands — the derived promise is
  // handed back rather than stored, so the cache keeps holding the bare one.
  //
  // Returning `existing` unchanged is what left plates blank: under StrictMode
  // the first mount claims every source and is then torn down, and the mount
  // that is actually on screen is the *second* caller. It never heard back, so
  // whatever had not decoded by its first synchronous paint stayed an empty
  // plate for the life of the page.
  if (existing) return onEach ? existing.then(() => onEach(src)) : existing

  const p = new Promise<void>((resolve) => {
    prints.set(src, null)
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      prints.set(src, img)
      resolve()
    }
    img.onerror = () => resolve()
    img.src = src
  }).then(() => {
    onEach?.(src)
  })

  inflight.set(src, p)
  return p
}

/**
 * Kicks off decoding for a set of sources; resolves when they have all settled.
 *
 * `onEach` fires as every individual print lands, so a page can put its plate up
 * the moment its own picture is ready rather than waiting on the eighteen behind
 * it in the queue.
 */
export function preloadBookImages(srcs: string[], onEach?: (src: string) => void): Promise<void> {
  return Promise.all(srcs.map((src) => fetchPrint(src, onEach))).then(() => undefined)
}

/** Waits for every journal print already requested by the mounted books. */
export function waitForBookImages(): Promise<void> {
  return Promise.all([...inflight.values()]).then(() => undefined)
}

/** Whether a print has finished decoding. */
export function printReady(src: string): boolean {
  return !!prints.get(src)
}

/** Every print referenced by a set of pages, in the order they appear. */
export function imagesIn(lines: Line[]): string[] {
  return lines.flatMap((l) => (l.k === 'image' ? [l.src] : l.k === 'snaps' ? [...l.srcs] : []))
}

/**
 * The lit play button, drawn over a print that opens the build.
 *
 * The plate on the gameplay page is a frame of the game, and a frame of the
 * game looks exactly like every other picture in the journal — which is a
 * problem when it is the one picture that is a button. This is the difference
 * between the two, and it is deliberately the loudest thing on the spread.
 */
function paintPlayOverlay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
) {
  // Enough to sit the white disc on, not enough to lose the picture.
  const veil = ctx.createRadialGradient(x + w / 2, y + h / 2, h * 0.1, x + w / 2, y + h / 2, h * 0.8)
  veil.addColorStop(0, 'rgba(9,14,28,0.10)')
  veil.addColorStop(1, 'rgba(9,14,28,0.34)')
  ctx.fillStyle = veil
  ctx.fillRect(x, y, w, h)

  const cx = x + w / 2
  const cy = y + h * 0.44
  const r = Math.min(h * 0.19, 62)

  // Halo, then the disc. Two passes rather than one wide shadow: a shadow that
  // reads at this size on paper is one that has swallowed the button.
  const halo = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 2.3)
  halo.addColorStop(0, 'rgba(226,240,255,0.55)')
  halo.addColorStop(1, 'rgba(226,240,255,0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(cx, cy, r * 2.3, 0, Math.PI * 2)
  ctx.fill()

  ctx.save()
  ctx.shadowColor = 'rgba(8,14,30,0.5)'
  ctx.shadowBlur = 18
  ctx.shadowOffsetY = 4
  ctx.fillStyle = '#f7f9ff'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // The triangle is nudged right by an eighth of its width: centred on its
  // bounding box it reads as leaning backwards.
  const t = r * 0.52
  ctx.fillStyle = '#16203c'
  ctx.beginPath()
  ctx.moveTo(cx - t * 0.72 + t * 0.18, cy - t)
  ctx.lineTo(cx + t + t * 0.18, cy)
  ctx.lineTo(cx - t * 0.72 + t * 0.18, cy + t)
  ctx.closePath()
  ctx.fill()

  // The tab under it, so the picture says what pressing it does.
  const label = 'CLICK TO PLAY'
  ctx.font = `700 26px ${SANS}`
  ctx.letterSpacing = '4px'
  const tw = ctx.measureText(label).width
  const padX = 26
  const tabW = tw + padX * 2
  const tabH = 46
  const tabX = cx - tabW / 2
  const tabY = cy + r + 22

  ctx.save()
  ctx.shadowColor = 'rgba(8,14,30,0.45)'
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 4
  ctx.fillStyle = 'rgba(14,20,38,0.88)'
  ctx.beginPath()
  ctx.roundRect(tabX, tabY, tabW, tabH, 10)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = 'rgba(226,240,255,0.55)'
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.fillStyle = '#f2f6ff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, cx, tabY + tabH / 2 + 1)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.letterSpacing = '0px'
}

/** Where each print in a `snaps` cluster sits, as fractions of the column. */
const SNAP_LAYOUT = [
  { x: 0.0, y: 0.0, w: 0.56, rot: -4.4 },
  // Pushed out to the right margin: sitting at a third of the column it was
  // covering most of the print above it and leaving a bare strip of paper down
  // the outside edge, so the stack read as a column rather than as a pile.
  { x: 0.41, y: 0.23, w: 0.54, rot: 5.2 },
  // Was -2.4, which is close enough to square that it looked placed rather
  // than dropped, and it was the only one of the three not obviously tilted.
  // Anticlockwise, to alternate against the print above it.
  { x: 0.02, y: 0.49, w: 0.58, rot: -6.5 },
]

/** A strip of masking tape, drawn across a corner of a print. */
function paintTape(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate((rot * Math.PI) / 180)
  const g = ctx.createLinearGradient(0, -13, 0, 13)
  g.addColorStop(0, 'rgba(232,214,170,0.62)')
  g.addColorStop(0.5, 'rgba(244,228,188,0.80)')
  g.addColorStop(1, 'rgba(214,192,146,0.62)')
  ctx.fillStyle = g
  ctx.fillRect(-46, -13, 92, 26)
  ctx.strokeStyle = 'rgba(140,110,64,0.28)'
  ctx.lineWidth = 1
  ctx.strokeRect(-46, -13, 92, 26)
  ctx.restore()
}

/**
 * Pulls the page face down before anything is painted with it.
 *
 * A canvas asking for a web font is not a use the browser counts: nothing in
 * the document is set in Source Serif, so the face sits at status "unloaded"
 * for the life of the page, `document.fonts.ready` resolves immediately, and
 * every page comes out in the fallback with nothing to say it went wrong.
 * Naming the sizes actually used is what triggers the fetch.
 */
export function loadBookFonts(): Promise<unknown> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
  if (!fonts) return Promise.resolve()
  const wanted = [
    `500 29px ${SERIF}`,
    `600 31px ${SERIF}`,
    `600 26px ${SERIF}`,
    `700 66px ${SERIF}`,
    `italic 500 23px ${SERIF}`,
    `700 30px ${SERIF}`,
  ]
  return Promise.all(wanted.map((f) => fonts.load(f).catch(() => undefined))).then(() =>
    fonts.ready
  )
}

/** Greedy wrap. Returns the lines, measured against the current ctx font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const words = text.split(/\s+/)
  const out: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width > width && line) {
      out.push(line)
      line = w
    } else {
      line = next
    }
  }
  if (line) out.push(line)
  return out
}

/** Paper: a warm wash, a vignette toward the spine, fibre speckle and foxing. */
export function paintPaper(ctx: CanvasRenderingContext2D, side: 'left' | 'right', seed: number) {
  const g = ctx.createLinearGradient(0, 0, PAGE_W, PAGE_H)
  g.addColorStop(0, side === 'left' ? PAPER_B : PAPER_A)
  g.addColorStop(0.45, '#ddcda6')
  g.addColorStop(1, side === 'left' ? PAPER_A : PAPER_B)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)

  // Gutter shadow on the spine edge, so the two pages read as one open book
  // rather than two separate cards.
  const spineAtLeft = side === 'right'
  const sg = ctx.createLinearGradient(spineAtLeft ? 0 : PAGE_W, 0, spineAtLeft ? 190 : PAGE_W - 190, 0)
  sg.addColorStop(0, 'rgba(60,36,18,0.42)')
  sg.addColorStop(0.35, 'rgba(60,36,18,0.12)')
  sg.addColorStop(1, 'rgba(60,36,18,0)')
  ctx.fillStyle = sg
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)

  // Edge darkening all round — paper that stops at a clean rectangle looks
  // like a screenshot of paper.
  const eg = ctx.createRadialGradient(PAGE_W / 2, PAGE_H / 2, PAGE_H * 0.28, PAGE_W / 2, PAGE_H / 2, PAGE_H * 0.72)
  eg.addColorStop(0, 'rgba(70,44,20,0)')
  eg.addColorStop(1, 'rgba(70,44,20,0.30)')
  ctx.fillStyle = eg
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)

  let s = seed >>> 0 || 7
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)

  ctx.globalAlpha = 0.05
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = rnd() > 0.5 ? '#8a6a3f' : '#fff8e6'
    ctx.fillRect(rnd() * PAGE_W, rnd() * PAGE_H, 1.4, 1.4)
  }
  // Foxing: a handful of soft brown blooms.
  for (let i = 0; i < 14; i++) {
    const x = rnd() * PAGE_W
    const y = rnd() * PAGE_H
    const r = 12 + rnd() * 46
    const fg = ctx.createRadialGradient(x, y, 0, x, y, r)
    fg.addColorStop(0, 'rgba(140,96,44,0.5)')
    fg.addColorStop(1, 'rgba(140,96,44,0)')
    ctx.globalAlpha = 0.16
    ctx.fillStyle = fg
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** Slight per-glyph jitter, so a rendered line is not laser-straight. */
function inkText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  jitter: number,
  rnd: () => number
) {
  if (jitter <= 0) {
    ctx.fillText(text, x, y)
    return
  }
  let cx = x
  for (const ch of text) {
    ctx.fillText(ch, cx, y + (rnd() - 0.5) * jitter)
    cx += ctx.measureText(ch).width
  }
}

export function paintPage(
  ctx: CanvasRenderingContext2D,
  lines: Line[],
  opts: {
    side: 'left' | 'right'
    accent: string
    folio: string
    seed: number
    paper?: boolean
    /** Link whose glyphs should use the interactive hover ink. */
    hoveredLink?: string | null
    /** Image whose paper mount should use the interactive hover ink. */
    hoveredImage?: string | null
    linkHoverMix?: number
    imageHoverMix?: number
    /** Optional hover ink override; headers continue to use the base accent. */
    hoverColor?: string
    /** Optional brighter ink ceiling for books whose accent needs more lift. */
    accentLuma?: number
    /**
     * Seed for the paper, when it is painted here.
     *
     * Separate from `seed` because the turning sheet has to be the same sheet
     * of paper as the block it lands on, and the block's paper was painted with
     * its own seed. Left to default, the fibre, the foxing and the edge wear
     * all changed the moment the leaf came down — the page arrived as a
     * different piece of paper from the one it settled into.
     */
    paperSeed?: number
    /** Draws a page-turn control in the outer bottom corner. */
    arrow?: 'prev' | 'next'
    /** Draws a compact jump-to-first/last control beside the folio. */
    jump?: { kind: 'first' | 'last'; to: string }
  }
): Painted {
  const { side, accent, folio, seed } = opts
  // Everything printed *as ink* uses the darkened accent; the page-turn plate
  // keeps the bright one, because it is drawn as a tinted block rather than as
  // a letterform and needs to stay visible as a control.
  const ink = inkAccent(accent, opts.accentLuma)
  const hoverInk = opts.hoverColor ?? ink
  let turn: Rect | null = null
  ctx.clearRect(0, 0, PAGE_W, PAGE_H)
  // The paper is a separate layer from the writing, so the sheet can be there
  // from the moment the cover lifts while the ink still arrives line by line.
  // Painted together, the reveal wiped the page itself away and left the bare
  // model showing through underneath.
  if (opts.paper) paintPaper(ctx, side, opts.paperSeed ?? seed)

  let s = (seed * 2654435761) >>> 0 || 13
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)

  const hits: Hit[] = []
  const images: ImageHit[] = []
  let y = MARGIN_TOP
  ctx.textBaseline = 'alphabetic'

  // The page-turn plate sits at PAGE_H - 122 with a rule 20px above it, so the
  // body has to stop before that or the last paragraph is written straight
  // through the control.
  const limit = PAGE_H - MARGIN_BOTTOM - (opts.arrow ? 92 : 0)

  for (const line of lines) {
    if (y > limit) break

    switch (line.k) {
      case 'kicker': {
        ctx.font = `600 25px ${SANS}`
        ctx.fillStyle = ink
        ctx.letterSpacing = '3px'
        ctx.fillText(line.text.toUpperCase(), MARGIN_X, y)
        ctx.letterSpacing = '0px'
        y += 32
        break
      }

      case 'title': {
        ctx.font = `700 66px ${SERIF}`
        ctx.fillStyle = INK
        const wrapped = wrap(ctx, line.text, COL)
        for (const l of wrapped) {
          inkText(ctx, l, MARGIN_X, y + 48, 1.1, rnd)
          y += 70
        }
        y += 6
        break
      }

      case 'rule': {
        ctx.strokeStyle = 'rgba(80,52,26,0.45)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(MARGIN_X, y + 6)
        ctx.lineTo(MARGIN_X + COL, y + 6)
        ctx.stroke()
        // Diamond pip on the rule — a plain hairline reads as a UI divider.
        ctx.fillStyle = ink
        ctx.save()
        ctx.translate(MARGIN_X + COL / 2, y + 6)
        ctx.rotate(Math.PI / 4)
        ctx.fillRect(-5, -5, 10, 10)
        ctx.restore()
        // 44, not 30. At 30 the next line's *baseline* sat 24px under the
        // rule, which for a kicker put its cap height six pixels below the
        // hairline — the heading looked stuck to the divider rather than set
        // under it. A rule is a break; it has to be followed by the space that
        // makes it one.
        y += 44
        break
      }

      case 'para': {
        // 27, not 29. Lora sets wider than the face it replaced — the same
        // paragraph gained two lines and the tools half of the What I build
        // page ran off the bottom margin mid-sentence.
        ctx.font = `500 29px ${SERIF}`
        ctx.fillStyle = INK_SOFT
        for (const l of wrap(ctx, line.text, COL)) {
          if (y > limit) break
          inkText(ctx, l, MARGIN_X, y + 22, 0.7, rnd)
          y += 36
        }
        y += 8
        break
      }

      case 'bullet': {
        // Same reason as the paragraphs above: Lora is a wider set, and the
        // tool pages are the longest copy in the book.
        ctx.font = `500 28px ${SERIF}`
        const wrapped = wrap(ctx, line.text, COL - 30)
        ctx.fillStyle = ink
        ctx.beginPath()
        ctx.arc(MARGIN_X + 6, y + 14, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = INK_SOFT
        for (const l of wrapped) {
          if (y > limit) break
          inkText(ctx, l, MARGIN_X + 30, y + 22, 0.7, rnd)
          y += 34
        }
        y += 7
        break
      }

      case 'fact': {
        ctx.font = `600 21px ${SANS}`
        ctx.fillStyle = 'rgba(64,44,24,0.92)'
        ctx.letterSpacing = '2px'
        ctx.fillText(line.label.toUpperCase(), MARGIN_X, y + 14)
        ctx.letterSpacing = '0px'
        // A fact set by hand is a list, and a list is set a step smaller and
        // a step tighter than a wrapped sentence — otherwise four broken-out
        // groups do not fit on the page they were broken out for.
        const hand = line.lines !== undefined && line.lines.length > 0
        ctx.font = `500 ${hand ? 27 : 29}px ${SERIF}`
        ctx.fillStyle = INK
        const wrapped = hand ? line.lines! : wrap(ctx, line.value, COL)
        const lead = hand ? 31 : 34
        let vy = y + 47
        for (const l of wrapped) {
          inkText(ctx, l, MARGIN_X, vy, 0.6, rnd)
          vy += lead
        }
        y = vy + (hand ? 8 : 11)
        break
      }

      case 'link': {
        ctx.font = `600 31px ${SERIF}`
        const w = Math.min(ctx.measureText(line.text).width, COL)
        const linkInk =
          opts.hoveredLink === line.to ? mixInk(INK, hoverInk, opts.linkHoverMix ?? 0) : INK
        ctx.fillStyle = linkInk
        inkText(ctx, line.text, MARGIN_X + 26, y + 24, 0.6, rnd)
        // Marginal arrow instead of an underline: a link on paper is annotated,
        // not styled.
        ctx.strokeStyle = linkInk
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(MARGIN_X + 2, y + 16)
        ctx.lineTo(MARGIN_X + 16, y + 16)
        ctx.moveTo(MARGIN_X + 10, y + 10)
        ctx.lineTo(MARGIN_X + 16, y + 16)
        ctx.lineTo(MARGIN_X + 10, y + 22)
        ctx.stroke()
        ctx.strokeStyle = opts.hoveredLink === line.to ? linkInk : 'rgba(120,80,40,0.5)'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(MARGIN_X + 26, y + 33)
        ctx.lineTo(MARGIN_X + 26 + w, y + 33)
        ctx.stroke()
        // Generous vertically: the target is a 3cm-tall strip on a page a
        // half-metre wide, so a couple of millimetres of slop is the difference
        // between a link that works and one that does not.
        hits.push({
          to: line.to,
          x0: (MARGIN_X - 8) / PAGE_W,
          y0: (y - 14) / PAGE_H,
          x1: (MARGIN_X + 36 + w) / PAGE_W,
          y1: (y + 50) / PAGE_H,
        })
        y += 54
        break
      }

      case 'links': {
        // Two to a row. Same annotated-margin treatment as a single link, in
        // half the column.
        const half = COL / 2
        ctx.font = `600 31px ${SERIF}`
        for (let i = 0; i < line.items.length; i++) {
          const item = line.items[i]
          const lx = MARGIN_X + (i % 2) * half
          const ly = y + Math.floor(i / 2) * 54
          if (ly > limit) break
          const w = Math.min(ctx.measureText(item.text).width, half - 40)
          const linkInk =
            opts.hoveredLink === item.to ? mixInk(INK, hoverInk, opts.linkHoverMix ?? 0) : INK
          ctx.fillStyle = linkInk
          inkText(ctx, item.text, lx + 26, ly + 24, 0.6, rnd)
          ctx.strokeStyle = linkInk
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.moveTo(lx + 2, ly + 16)
          ctx.lineTo(lx + 16, ly + 16)
          ctx.moveTo(lx + 10, ly + 10)
          ctx.lineTo(lx + 16, ly + 16)
          ctx.lineTo(lx + 10, ly + 22)
          ctx.stroke()
          ctx.strokeStyle = opts.hoveredLink === item.to ? linkInk : 'rgba(120,80,40,0.5)'
          ctx.lineWidth = 1.6
          ctx.beginPath()
          ctx.moveTo(lx + 26, ly + 33)
          ctx.lineTo(lx + 26 + w, ly + 33)
          ctx.stroke()
          hits.push({
            to: item.to,
            x0: (lx - 8) / PAGE_W,
            y0: (ly - 12) / PAGE_H,
            x1: (lx + 36 + w) / PAGE_W,
            y1: (ly + 46) / PAGE_H,
          })
        }
        y += Math.ceil(line.items.length / 2) * 54
        break
      }

      case 'image': {
        const plateW = COL
        const plateH = Math.min(line.h, limit - y - (line.caption ? 34 : 0))
        if (plateH < 40) {
          y = limit + 1
          break
        }

        const x = MARGIN_X
        const img = prints.get(line.src)

        // The mount first: a slightly oversized cream plate with a soft cast
        // shadow, so the print reads as pasted onto the sheet rather than
        // printed into it.
        ctx.save()
        ctx.shadowColor = 'rgba(48,28,10,0.42)'
        ctx.shadowBlur = 16
        ctx.shadowOffsetY = 6
        ctx.fillStyle =
          opts.hoveredImage === line.src
            ? mixInk('#efe4c8', hoverInk, opts.imageHoverMix ?? 0)
            : '#efe4c8'
        ctx.fillRect(x - 8, y - 8, plateW + 16, plateH + 16)
        ctx.restore()

        ctx.save()
        ctx.beginPath()
        ctx.rect(x, y, plateW, plateH)
        ctx.clip()

        if (img && img.naturalWidth > 0) {
          const scale =
            line.fit === 'contain'
              ? Math.min(plateW / img.naturalWidth, plateH / img.naturalHeight)
              : Math.max(plateW / img.naturalWidth, plateH / img.naturalHeight)
          const dw = img.naturalWidth * scale
          const dh = img.naturalHeight * scale

          // 'contain' leaves margins, and a transparent margin would show the
          // paper through the middle of a plate — fill it first.
          if (line.fit === 'contain') {
            ctx.fillStyle = '#2b2724'
            ctx.fillRect(x, y, plateW, plateH)
          }
          ctx.drawImage(img, x + (plateW - dw) / 2, y + (plateH - dh) / 2, dw, dh)

          // No wash over the print. There used to be a warm `overlay` pass and
          // a brown veil here to marry the picture to the sheet, and between
          // them they lifted every plate a stop: the same screenshot opened
          // full-screen was visibly darker and more saturated than the one
          // printed on the page, which reads as the book being wrong rather
          // than as the book being paper.

          // The overlay is not part of the picture, so it goes on top.
          // that it is *not* part of the picture.
          if (line.overlay === 'play') paintPlayOverlay(ctx, x, y, plateW, plateH)
        } else {
          // Not landed yet, or gone. A ruled blank, not a broken box.
          ctx.fillStyle = 'rgba(120,92,54,0.16)'
          ctx.fillRect(x, y, plateW, plateH)
          ctx.strokeStyle = 'rgba(96,66,34,0.34)'
          ctx.lineWidth = 1.4
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + plateW, y + plateH)
          ctx.moveTo(x + plateW, y)
          ctx.lineTo(x, y + plateH)
          ctx.stroke()
        }
        ctx.restore()

        ctx.strokeStyle = 'rgba(70,46,22,0.55)'
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, plateW, plateH)

        // Reported so the 3D side can put a hit target on exactly what was
        // drawn — the plate's height is clamped against the page's remaining
        // room, which only the painter knows.
        images.push({
          src: line.src,
          to: line.to,
          zoom: line.zoom,
          x0: x / PAGE_W,
          y0: y / PAGE_H,
          x1: (x + plateW) / PAGE_W,
          y1: (y + plateH) / PAGE_H,
        })

        y += plateH + 12

        if (line.caption) {
          // The caption under a plate is a note about a picture and is set as
          // one — small, italic, out of the way. The caption under the *play*
          // plate is an instruction about the only interactive thing in the
          // book, and set that way nobody read it: it is upright, heavier and
          // a size larger, so it looks like something to do rather than
          // something to skim.
          const isCall = line.overlay === 'play'
          // A heavier line needs the air to go with it, or it reads as part of
          // the picture's own bottom edge.
          if (isCall) y += 8
          ctx.font = isCall ? `700 26px ${SERIF}` : `italic 500 23px ${SERIF}`
          ctx.fillStyle = isCall ? 'rgba(48,30,14,0.96)' : 'rgba(62,42,22,0.9)'
          const step = isCall ? 33 : 29
          for (const l of wrap(ctx, line.caption, COL)) {
            if (y > limit) break
            ctx.fillText(l, MARGIN_X, y + 17)
            y += step
          }
          y += 8
        }
        y += 16
        break
      }

      case 'snaps': {
        const clusterH = Math.min(line.h, limit - y)
        if (clusterH < 120) {
          y = limit + 1
          break
        }

        line.srcs.slice(0, SNAP_LAYOUT.length).forEach((src, i) => {
          const s = SNAP_LAYOUT[i]
          const w = COL * s.w
          // A fixed 3:2 frame rather than the file's own aspect: the prints
          // come off different captures, and a row of mismatched rectangles
          // reads as a contact sheet rather than as photographs.
          const ph = w / 1.5
          const px = MARGIN_X + COL * s.x
          const py = y + clusterH * s.y
          const cx = px + w / 2
          const cy = py + ph / 2
          const rad = (s.rot * Math.PI) / 180
          const border = 11
          const img = prints.get(src)

          ctx.save()
          ctx.translate(cx, cy)
          ctx.rotate(rad)

          // The white border first, with its own shadow, so the print sits
          // above the sheet and above whatever it is lying on.
          ctx.save()
          ctx.shadowColor = 'rgba(40,24,8,0.45)'
          ctx.shadowBlur = 18
          ctx.shadowOffsetY = 7
          ctx.fillStyle =
            opts.hoveredImage === src
              ? mixInk('#f4ecd8', hoverInk, opts.imageHoverMix ?? 0)
              : '#f4ecd8'
          ctx.fillRect(-w / 2 - border, -ph / 2 - border, w + border * 2, ph + border * 2)
          ctx.restore()

          ctx.save()
          ctx.beginPath()
          ctx.rect(-w / 2, -ph / 2, w, ph)
          ctx.clip()
          if (img && img.naturalWidth > 0) {
            const scale = Math.max(w / img.naturalWidth, ph / img.naturalHeight)
            const dw = img.naturalWidth * scale
            const dh = img.naturalHeight * scale
            // Straight down, unwashed — see the note on the image plate.
            ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
          } else {
            ctx.fillStyle = 'rgba(120,92,54,0.18)'
            ctx.fillRect(-w / 2, -ph / 2, w, ph)
          }
          ctx.restore()

          ctx.strokeStyle = 'rgba(70,46,22,0.4)'
          ctx.lineWidth = 1.6
          ctx.strokeRect(-w / 2, -ph / 2, w, ph)

          // Tape across two opposite corners, angled against the print's own
          // tilt so it reads as stuck down rather than drawn on.
          paintTape(ctx, -w / 2 - border + 6, -ph / 2 - border + 4, -38 - s.rot)
          paintTape(ctx, w / 2 + border - 6, ph / 2 + border - 4, -38 - s.rot)
          ctx.restore()

          // Axis-aligned bounds of the tilted print, so the 3D side can put a
          // target on it. A rotated rectangle's half-extents are the projection
          // of both of its own axes onto the page's.
          const c = Math.abs(Math.cos(rad))
          const sn = Math.abs(Math.sin(rad))
          const hw = ((w + border * 2) * c + (ph + border * 2) * sn) / 2
          const hh = ((w + border * 2) * sn + (ph + border * 2) * c) / 2
          images.push({
            src,
            zoom: src,
            x0: (cx - hw) / PAGE_W,
            y0: (cy - hh) / PAGE_H,
            x1: (cx + hw) / PAGE_W,
            y1: (cy + hh) / PAGE_H,
          })
        })

        y += clusterH + 10
        break
      }

      case 'delta': {
        // A before/after pair drawn as two stacked bars. The whole point of the
        // tool pages is the number on the right, so it gets the accent and the
        // longer look.
        ctx.font = `600 21px ${SANS}`
        ctx.fillStyle = 'rgba(64,44,24,0.92)'
        ctx.letterSpacing = '2px'
        ctx.fillText(line.label.toUpperCase(), MARGIN_X, y + 14)
        ctx.letterSpacing = '0px'

        const barY = y + 30
        const barW = COL - 240
        const ratio = Math.max(0.015, Math.min(1, line.ratio))

        // Two bars, same origin: the full one is what it cost before, the short
        // one what it costs now. Reading the pair is the whole point, so they
        // are stacked rather than set side by side.
        ctx.fillStyle = 'rgba(96,66,34,0.28)'
        ctx.fillRect(MARGIN_X, barY, barW, 11)
        ctx.fillStyle = ink
        ctx.fillRect(MARGIN_X, barY + 20, Math.max(3, barW * ratio), 11)

        ctx.font = `500 24px ${SERIF}`
        ctx.textAlign = 'right'
        ctx.fillStyle = 'rgba(91,66,48,0.72)'
        ctx.fillText(line.before, MARGIN_X + COL, barY + 11)
        ctx.font = `600 26px ${SERIF}`
        ctx.fillStyle = INK
        ctx.fillText(line.after, MARGIN_X + COL, barY + 33)
        ctx.textAlign = 'left'

        y = barY + 54
        break
      }

      case 'gap':
        y += line.h
        break
    }
  }

  // Folio, centred at the foot. Set at close to full ink: at the reading
  // camera's distance the old 80%-opacity brown was the same value as the
  // foxing around it, and a page number nobody can read is not a page number.
  ctx.font = `500 27px ${SERIF}`
  ctx.fillStyle = 'rgba(34,20,8,0.95)'
  ctx.textAlign = 'center'
  ctx.fillText(folio, PAGE_W / 2, PAGE_H - 52)
  ctx.textAlign = 'left'

  // A small double-arrow beside the folio jumps across the journal. It mirrors
  // across the gutter: back-to-first sits to the left of the left folio, while
  // forward-to-last sits to the right of the right folio. The first and last
  // pages omit it entirely (the caller decides that with `jump`).
  if (opts.jump) {
    const first = opts.jump.kind === 'first'
    const cx = PAGE_W / 2 + (first ? -116 : 116)
    const cy = PAGE_H - 62
    const w = 66
    const h = 44
    const hovered = opts.hoveredLink === opts.jump.to
    const mix = hovered ? opts.linkHoverMix ?? 0 : 0
    const glyph = mixInk(INK, hoverInk, mix)

    ctx.save()
    ctx.fillStyle = hovered ? mixInk('rgba(120, 80, 40)', hoverInk, mix * 0.55) : 'rgba(120,80,40,0.1)'
    ctx.strokeStyle = hovered ? glyph : 'rgba(90,60,30,0.38)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 8)
    ctx.fill()
    ctx.stroke()

    const direction = first ? -1 : 1
    ctx.fillStyle = glyph
    for (const offset of [-9, 9]) {
      const tipX = cx + offset + direction * 9
      const baseX = cx + offset - direction * 8
      ctx.beginPath()
      ctx.moveTo(tipX, cy)
      ctx.lineTo(baseX, cy - 10)
      ctx.lineTo(baseX, cy + 10)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()

    hits.push({
      to: opts.jump.to,
      x0: (cx - w / 2 - 8) / PAGE_W,
      y0: (cy - h / 2 - 8) / PAGE_H,
      x1: (cx + w / 2 + 8) / PAGE_W,
      y1: (cy + h / 2 + 8) / PAGE_H,
    })
  }

  // Page-turn control, inked in the outer bottom corner.
  //
  // This was a bare chevron in a thin circle, and nobody found it: at the read
  // camera's distance it was a few pixels of low-contrast line work in the one
  // part of the page the eye never goes. It says what it does now, on a tinted
  // plate with a rule above it, which is about as loud as a thing drawn on
  // paper can be without stopping being paper.
  if (opts.arrow) {
    const next = opts.arrow === 'next'
    const label = next ? 'Next page' : 'Back'
    const dir = next ? 1 : -1
    // Clear of the foot. The painted sheet grades down into the block over the
    // last few percent of the page, so a control sitting at the very bottom
    // came out dimmed to about the contrast of the foxing.
    const cy = PAGE_H - 122

    ctx.font = `700 30px ${SANS}`
    ctx.letterSpacing = '1px'
    const textW = ctx.measureText(label).width
    // The tinted plate and its outline are gone: on a sheet of paper a boxed
    // button reads as a sticker somebody stuck on the page, and the two of
    // them were the loudest rectangles in the whole book. What is left is the
    // words and the arrow, which is what anybody was reading anyway. The hover
    // highlight still comes up under it — that mark is what the control was
    // borrowing the box for.
    const arrowW = 34
    const gap = 14
    const plateW = textW + gap + arrowW
    const plateH = 46
    const plateX = next ? PAGE_W - MARGIN_X - plateW : MARGIN_X
    const plateY = cy - plateH / 2

    // Rule above it, so the control is separated from the body of the page
    // rather than reading as another line of the text.
    ctx.strokeStyle = 'rgba(90,60,30,0.34)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(MARGIN_X, plateY - 20)
    ctx.lineTo(MARGIN_X + COL, plateY - 20)
    ctx.stroke()

    // Text first, then the arrow after it — "Next page ->", reading order.
    const textX = next ? plateX : plateX + arrowW + gap
    ctx.fillStyle = INK
    ctx.textBaseline = 'middle'
    ctx.fillText(label, textX, cy + 1)
    ctx.letterSpacing = '0px'
    ctx.textBaseline = 'alphabetic'

    // Inked, not accented. The arrow is part of the label rather than a second
    // element next to it, so it takes the label's colour.
    const ax = next ? textX + textW + gap + arrowW / 2 : plateX + arrowW / 2
    ctx.strokeStyle = INK
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(ax - dir * 13, cy)
    ctx.lineTo(ax + dir * 13, cy)
    ctx.moveTo(ax + dir * 4, cy - 9)
    ctx.lineTo(ax + dir * 13, cy)
    ctx.lineTo(ax + dir * 4, cy + 9)
    ctx.stroke()

    // Reported back so the 3D hit target can be sized to what was drawn
    // instead of to a guess — the plate's width depends on how wide the label
    // measured, which only the painter knows.
    const pad = 12
    turn = {
      x0: (plateX - pad) / PAGE_W,
      y0: (plateY - 4) / PAGE_H,
      x1: (plateX + plateW + pad) / PAGE_W,
      y1: (plateY + plateH + 4) / PAGE_H,
    }
  }

  return { hits, images, turn }
}
/**
 * The closed cover: a restrained gilt title stamped into the board.
 *
 * The board itself already carries its inset double rule in its own texture
 * (see `makeLeatherMaps`), so nothing here draws a second border — that gave
 * the shut journal a grid of competing rectangles the first time round.
 *
 * The title block sits around the optical centre of the board. The former icon,
 * underline, and volume code made the cover read like an interface card rather
 * than a physical journal, so the shared design now keeps only the collection
 * name and each tent's title.
 *
 * The gilt is two passes — a dark impression offset down and right, then the
 * bright metal over it — because that is what stamped foil looks like: the
 * letter is *below* the surface and only its floor catches the light.
 */
export function paintCover(
  ctx: CanvasRenderingContext2D,
  title: string,
  subtitle: string,
  binding: Binding = 'leather'
) {
  ctx.clearRect(0, 0, PAGE_W, PAGE_H)
  ctx.textAlign = 'center'

  const stamp = (text: string, font: string, spacing: string, y: number, gold: string) => {
    ctx.font = font
    ctx.letterSpacing = spacing
    ctx.fillStyle = 'rgba(14,7,4,0.75)'
    ctx.fillText(text, PAGE_W / 2 + 2.5, y + 2.5)
    ctx.fillStyle = gold
    ctx.fillText(text, PAGE_W / 2, y)
    ctx.letterSpacing = '0px'
  }

  const metal = binding === 'cloth' ? '#c8d7d2' : binding === 'copper' ? '#d3a457' : '#d9b875'
  const titleMetal = binding === 'cloth' ? '#e7eee8' : '#f0d492'
  const insetX = 56
  const insetY = 68

  // One coordinate system for every piece of cover furniture. Both frames are
  // mathematically concentric and stay safely inside the front board.
  ctx.save()
  ctx.strokeStyle = metal
  ctx.lineWidth = binding === 'cloth' ? 2.5 : 2
  if (binding === 'cloth') ctx.setLineDash([8, 11])
  ctx.strokeRect(insetX, insetY, PAGE_W - insetX * 2, PAGE_H - insetY * 2)
  ctx.setLineDash([])
  if (binding !== 'cloth') {
    ctx.globalAlpha = 0.58
    ctx.lineWidth = 1.2
    ctx.strokeRect(insetX + 14, insetY + 14, PAGE_W - (insetX + 14) * 2, PAGE_H - (insetY + 14) * 2)
  }
  ctx.restore()

  stamp(subtitle.toUpperCase(), `700 38px ${SANS}`, '5px', PAGE_H * 0.43, metal)
  stamp(title.toUpperCase(), `700 108px ${SERIF}`, '2px', PAGE_H * 0.57, titleMetal)

  ctx.textAlign = 'left'
}
