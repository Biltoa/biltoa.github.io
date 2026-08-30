import { useEffect, useState } from 'react'
import type { PageScreenRect } from '../three/campsite/Book'

/* -------------------------------------------------------------------------- */
/*  Leaning in on a picture in the journal.                                    */
/*                                                                            */
/*  A screenshot printed at the size a page allows is a picture of a tool, not  */
/*  a readable one. Pressing it moves in on the plate: the enlargement starts   */
/*  at the plate's own footprint on screen and opens out from there, so it      */
/*  reads as getting closer to the page rather than as a panel appearing over   */
/*  it. What it shows is the uncropped capture, not the printed crop.           */
/* -------------------------------------------------------------------------- */

type Phase = 'from-page' | 'open' | 'closing'

export default function BookZoom({
  src,
  from,
  onClose,
}: {
  src: string
  /** The plate's footprint on screen when it was pressed. */
  from: PageScreenRect
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('from-page')
  /** The picture's own pixel dimensions, once it has decoded. */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  // Both states have to be painted for the move to have anything to
  // interpolate; mounting straight into the open state just snaps.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')))
    return () => cancelAnimationFrame(id)
  }, [])

  const close = () => {
    if (phase === 'closing') return
    setPhase('closing')
    window.setTimeout(onClose, 560)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape belongs to the enlargement while it is up, or one press would
      // also walk the reader out of the tent behind it.
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  /**
   * Where the picture ends up.
   *
   * Sized to the picture rather than to a fixed box. A tool window is portrait
   * and a store icon is square; letterboxing either into one landscape frame
   * surrounds it with mount and wastes most of the screen on the thing the
   * reader pressed *away* from.
   */
  const openFrame = (): React.CSSProperties => {
    const pad = 16
    const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
    const vh = typeof window === 'undefined' ? 720 : window.innerHeight
    const maxW = Math.min(vw * 0.92, 1500) - pad
    const maxH = Math.min(vh * 0.84, 1040) - pad

    const nw = natural?.w ?? 16
    const nh = natural?.h ?? 9
    const scale = Math.min(maxW / nw, maxH / nh)
    const w = nw * scale
    const h = nh * scale

    return {
      left: `${(vw - w - pad) / 2}px`,
      top: `${(vh - h - pad) / 2}px`,
      width: `${w + pad}px`,
      height: `${h + pad}px`,
      opacity: 1,
    }
  }

  const onPage = phase !== 'open'
  const frame: React.CSSProperties = onPage
    ? {
        left: `${from.x}px`,
        top: `${from.y}px`,
        width: `${from.w}px`,
        height: `${from.h}px`,
        opacity: phase === 'closing' ? 0 : 1,
      }
    : openFrame()

  return (
    <div className="bookzoom" data-phase={phase}>
      {/* Pressing anywhere off the picture goes back, the way putting a page
          down does. The button is still there for anyone who wants a target. */}
      <button className="bookzoom__scrim" onClick={close} aria-label="Back to the page" />

      <figure className="bookzoom__frame" style={frame}>
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget
            setNatural({ w: img.naturalWidth, h: img.naturalHeight })
          }}
        />
      </figure>

      <button className="bookzoom__back" onClick={close}>
        ← Back to the page <kbd>Esc</kbd>
      </button>
    </div>
  )
}
