import type { Line } from './bookContent'

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
export const PAGE_H = 1180

const MARGIN_X = 84
const MARGIN_TOP = 96
const MARGIN_BOTTOM = 104
const COL = PAGE_W - MARGIN_X * 2

const SERIF = "Georgia, 'Palatino Linotype', 'Iowan Old Style', 'Times New Roman', serif"
const SANS = "'Archivo', 'Segoe UI', Helvetica, Arial, sans-serif"

const INK = '#3a2415'
const INK_SOFT = '#5b4230'
const PAPER_A = '#ded0ae'
const PAPER_B = '#c9b287'

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

export interface Painted {
  /** Clickable link rectangles found on the page. */
  hits: Hit[]
  /** Footprint of the page-turn plate, if this page carries one. */
  turn: Rect | null
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
  g.addColorStop(0.45, '#e8dab8')
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
  }
): Painted {
  const { side, accent, folio, seed } = opts
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
  let y = MARGIN_TOP
  ctx.textBaseline = 'alphabetic'

  const limit = PAGE_H - MARGIN_BOTTOM

  for (const line of lines) {
    if (y > limit) break

    switch (line.k) {
      case 'kicker': {
        ctx.font = `600 23px ${SANS}`
        ctx.fillStyle = accent
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
        ctx.fillStyle = accent
        ctx.save()
        ctx.translate(MARGIN_X + COL / 2, y + 6)
        ctx.rotate(Math.PI / 4)
        ctx.fillRect(-5, -5, 10, 10)
        ctx.restore()
        y += 30
        break
      }

      case 'para': {
        ctx.font = `400 29px ${SERIF}`
        ctx.fillStyle = INK_SOFT
        for (const l of wrap(ctx, line.text, COL)) {
          if (y > limit) break
          inkText(ctx, l, MARGIN_X, y + 24, 0.7, rnd)
          y += 41
        }
        y += 8
        break
      }

      case 'bullet': {
        ctx.font = `400 28px ${SERIF}`
        const wrapped = wrap(ctx, line.text, COL - 30)
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(MARGIN_X + 6, y + 14, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = INK_SOFT
        for (const l of wrapped) {
          inkText(ctx, l, MARGIN_X + 30, y + 24, 0.7, rnd)
          y += 39
        }
        y += 8
        break
      }

      case 'fact': {
        ctx.font = `600 19px ${SANS}`
        ctx.fillStyle = 'rgba(90,62,34,0.85)'
        ctx.letterSpacing = '2px'
        ctx.fillText(line.label.toUpperCase(), MARGIN_X, y + 14)
        ctx.letterSpacing = '0px'
        ctx.font = `400 27px ${SERIF}`
        ctx.fillStyle = INK
        const wrapped = wrap(ctx, line.value, COL)
        let vy = y + 47
        for (const l of wrapped) {
          inkText(ctx, l, MARGIN_X, vy, 0.6, rnd)
          vy += 34
        }
        y = vy + 11
        break
      }

      case 'link': {
        ctx.font = `500 30px ${SERIF}`
        const w = Math.min(ctx.measureText(line.text).width, COL)
        ctx.fillStyle = INK
        inkText(ctx, line.text, MARGIN_X + 26, y + 24, 0.6, rnd)
        // Marginal arrow instead of an underline: a link on paper is annotated,
        // not styled.
        ctx.strokeStyle = accent
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(MARGIN_X + 2, y + 16)
        ctx.lineTo(MARGIN_X + 16, y + 16)
        ctx.moveTo(MARGIN_X + 10, y + 10)
        ctx.lineTo(MARGIN_X + 16, y + 16)
        ctx.lineTo(MARGIN_X + 10, y + 22)
        ctx.stroke()
        ctx.strokeStyle = 'rgba(120,80,40,0.5)'
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

      case 'gap':
        y += line.h
        break
    }
  }

  // Folio, centred at the foot.
  ctx.font = `400 22px ${SERIF}`
  ctx.fillStyle = 'rgba(84,56,28,0.78)'
  ctx.textAlign = 'center'
  ctx.fillText(folio, PAGE_W / 2, PAGE_H - 52)
  ctx.textAlign = 'left'

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

    ctx.font = `600 27px ${SANS}`
    ctx.letterSpacing = '1px'
    const textW = ctx.measureText(label).width
    const padX = 22
    const arrowW = 34
    const plateW = textW + arrowW + padX * 2 + 8
    const plateH = 58
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

    ctx.globalAlpha = 0.3
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.roundRect(plateX, plateY, plateW, plateH, 9)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = accent
    ctx.lineWidth = 3
    ctx.stroke()

    // Text first, then the arrow after it — "Next page ->", reading order.
    const textX = next ? plateX + padX : plateX + padX + arrowW + 8
    ctx.fillStyle = INK
    ctx.textBaseline = 'middle'
    ctx.fillText(label, textX, cy + 1)
    ctx.letterSpacing = '0px'
    ctx.textBaseline = 'alphabetic'

    const ax = next ? textX + textW + 18 : plateX + padX + 16
    ctx.strokeStyle = accent
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
    turn = {
      x0: plateX / PAGE_W,
      y0: (plateY - 6) / PAGE_H,
      x1: (plateX + plateW) / PAGE_W,
      y1: (plateY + plateH + 6) / PAGE_H,
    }
  }

  return { hits, turn }
}

/**
 * The closed cover: a gilt title, stamped into the board.
 *
 * Lettering only. The board itself already carries a blind-stamped double rule
 * in its own texture (see `makeLeatherMaps`), and drawing a second painted
 * border on top of it gave the shut journal a grid of competing rectangles.
 *
 * The gilt is two passes — a dark impression offset down and right, then the
 * bright metal over it — because that is what stamped foil looks like: the
 * letter is *below* the surface and only its floor catches the light.
 */
export function paintCover(ctx: CanvasRenderingContext2D, title: string, accent: string) {
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

  stamp('THE CAMP JOURNAL', `600 26px ${SANS}`, '8px', PAGE_H * 0.42, '#d8b06a')
  stamp(title.toUpperCase(), `700 82px ${SERIF}`, '2px', PAGE_H * 0.54, '#f0d492')

  // A short rule under the title, in the tent's own colour — the one place the
  // journals are allowed to differ from each other at a glance.
  ctx.strokeStyle = accent
  ctx.globalAlpha = 0.8
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(PAGE_W / 2 - 90, PAGE_H * 0.585)
  ctx.lineTo(PAGE_W / 2 + 90, PAGE_H * 0.585)
  ctx.stroke()
  ctx.globalAlpha = 1

  ctx.textAlign = 'left'
}
