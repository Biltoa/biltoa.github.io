import { useEffect, useRef, useState } from 'react'
import { profile } from '../data/profile'

/* -------------------------------------------------------------------------- */
/*  The screen the site opens on, and the reason the camp can be warmed up      */
/*  before anybody looks at it.                                                 */
/*                                                                              */
/*  Nothing in this file imports three or drei. It has to be on screen while     */
/*  those chunks are still downloading, so pulling either of them in here would  */
/*  make the loading screen wait for the thing it exists to cover.               */
/* -------------------------------------------------------------------------- */

export type LoadStage = 'boot' | 'assets' | 'compile' | 'ready'

const CAPTION: Record<LoadStage, string> = {
  boot: 'Walking out to the clearing',
  assets: 'Pitching the tents',
  compile: 'Lighting the fire',
  ready: 'Ready',
}

/**
 * Bar position each stage is worth, before the stage's own progress is added.
 *
 * The three stages take wildly different amounts of time and none of them can
 * be measured in the same unit, so the bar is a schedule rather than a
 * measurement: fixed budgets, filled from inside. What it must never do is
 * stall — a bar that sits still reads as a hang even when work is happening.
 */
const BUDGET: Record<LoadStage, [number, number]> = {
  boot: [0, 0.18],
  assets: [0.18, 0.86],
  compile: [0.86, 1],
  ready: [1, 1],
}

/**
 * How long the curtain stays after the scene says it is ready.
 *
 * Long enough for the fade to play over a camp that is already rendering, so
 * the first thing the reader sees is a live frame rather than the first frame.
 */
const FADE_MS = 620

export default function CampLoader({
  stage,
  progress,
}: {
  stage: LoadStage
  /** 0-1 within the current stage. */
  progress: number
}) {
  const [gone, setGone] = useState(false)
  const barRef = useRef<HTMLElement>(null)
  const shown = useRef(0)

  useEffect(() => {
    if (stage !== 'ready') return
    // Full, immediately. A bar that is still filling while the curtain fades
    // says the thing behind it is not finished, which is the opposite of true.
    shown.current = 1
    if (barRef.current) barRef.current.style.transform = 'scaleX(1)'
    const t = setTimeout(() => setGone(true), FADE_MS)
    return () => clearTimeout(t)
  }, [stage])

  /*
    The bar is driven straight from a rAF loop rather than from React state.

    Everything else on this screen is static, and the whole point of the screen
    is that the main thread is busy: parsing three, decoding a 2.7MB glTF,
    compiling thirty shader programs. A progress bar that needs a render pass to
    move is a progress bar that freezes exactly when it is meant to be
    reassuring. One ref, one style write, no reconciliation.
  */
  const target = useRef(0)
  useEffect(() => {
    const [from, to] = BUDGET[stage]
    target.current = from + (to - from) * Math.min(1, Math.max(0, progress))
  }, [stage, progress])

  useEffect(() => {
    if (gone) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      // Eased follow, so a stage that completes in one jump still reads as
      // filling rather than teleporting — but eased against *time*, not against
      // frames. Frames during a load are exactly the thing that is not
      // arriving on schedule, and a per-frame constant here means the bar
      // crawls precisely when the page is busiest, which is the impression the
      // bar exists to avoid. Roughly a third of a second to converge.
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      shown.current += (target.current - shown.current) * (1 - Math.exp(-9 * dt))
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${Math.min(1, shown.current + 0.004)})`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [gone])

  if (gone) return null

  return (
    <div className="camploader" data-done={stage === 'ready'} role="status" aria-live="polite">
      <div className="camploader__inner">
        {/* The same ember diamond and hairline the landing copy uses, so the
            curtain and what is behind it are visibly the same site. */}
        <div className="camploader__fire" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>

        <h1 className="camploader__title">
          {profile.name.split(' ')[0]}
          <br />
          {profile.name.split(' ')[1]}
        </h1>

        <div className="camploader__rail" aria-hidden="true">
          <i ref={barRef} className="camploader__bar" />
        </div>

        <p className="camploader__caption">{CAPTION[stage]}</p>
      </div>
    </div>
  )
}
