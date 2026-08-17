/**
 * Shared scroll driver for the three.js hero scenes.
 *
 * The scenes read this every frame inside useFrame, so it deliberately lives
 * outside React state — driving a 60fps re-render through the component tree
 * to move a domino would be silly.
 *
 * `target`   raw 0..1 progress through the hero's scroll length
 * `smooth`   critically-damped follow of target (what the scenes actually use)
 * `velocity` smooth delta per frame; sign tells the scene which way we're going
 */
export const scrollDriver = {
  target: 0,
  smooth: 0,
  velocity: 0,
  /** Set true once the user has scrolled at all — used to hide the scroll hint. */
  engaged: false,
}

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as unknown as { __scrollDriver?: typeof scrollDriver }).__scrollDriver = scrollDriver
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Attaches scroll tracking for a hero element and runs the damping loop.
 * Returns a disposer. `onFrame` gets the smoothed value for cheap DOM updates
 * (progress bar width) without React re-renders.
 */
export function attachScrollDriver(
  getElement: () => HTMLElement | null,
  onFrame?: (smooth: number, target: number) => void
) {
  let raf = 0
  let running = true
  const reduced = prefersReducedMotion()

  const measure = () => {
    const el = getElement()
    if (!el) return 0
    const total = el.offsetHeight - window.innerHeight
    if (total <= 0) return 0
    const scrolled = -el.getBoundingClientRect().top
    return Math.min(1, Math.max(0, scrolled / total))
  }

  const onScroll = () => {
    const t = measure()
    if (t > 0.002) scrollDriver.engaged = true
    scrollDriver.target = t
  }

  const tick = () => {
    if (!running) return
    const prev = scrollDriver.smooth
    // Snappier when reduced motion is requested — no easing theatre.
    const k = reduced ? 1 : 0.11
    scrollDriver.smooth += (scrollDriver.target - scrollDriver.smooth) * k
    scrollDriver.velocity = scrollDriver.smooth - prev
    onFrame?.(scrollDriver.smooth, scrollDriver.target)
    raf = requestAnimationFrame(tick)
  }

  onScroll()
  scrollDriver.smooth = scrollDriver.target
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
  raf = requestAnimationFrame(tick)

  return () => {
    running = false
    cancelAnimationFrame(raf)
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onScroll)
    scrollDriver.target = 0
    scrollDriver.smooth = 0
    scrollDriver.velocity = 0
    scrollDriver.engaged = false
  }
}

/* ------------------------------------------------------------------- easing */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * Frame-rate independent lerp factor.
 *
 * `x += (target - x) * k` with a constant `k` is a different filter at every
 * frame rate: at 30fps it lags twice as far behind as at 60, which is why a
 * scene that drops frames also feels *mushier* rather than merely slower. This
 * converts a rate (roughly 60 × the old per-frame constant) into the factor for
 * however long the frame actually took.
 *
 * `dt` is clamped so a backgrounded tab does not resume by teleporting.
 */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * (dt > 0.1 ? 0.1 : dt))

export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

