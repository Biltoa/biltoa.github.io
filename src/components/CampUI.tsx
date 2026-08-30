import { useEffect, useRef, useState } from 'react'
import { profile } from '../data/profile'

/* -------------------------------------------------------------------------- */
/*  DOM layer for the campsite concept: the name block with its ember drift,    */
/*  the click hint, and the ember cursor.                                       */
/*                                                                              */
/*  All of it is one canvas plus a little markup rather than DOM particles —    */
/*  a few hundred embers as elements would thrash layout, and the cursor trail  */
/*  has to keep up with pointermove.                                            */
/* -------------------------------------------------------------------------- */

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  hue: number
}

const CURSOR_COLORS = [42, 30, 18] // amber → orange → ember red, as HSL hues

/**
 * Frame-time readout in the top right corner, so "does it feel smooth" can be
 * answered with a number instead of an opinion.
 *
 * On by default, in the shipped build as much as in dev — `?fps=0` turns it
 * off. A dev-only meter cannot measure the build that is actually slow: the
 * production bundle is a different program, with different React, no
 * StrictMode and minified everything.
 *
 * Three figures, and the third is the one to watch. A scene that averages sixty
 * but drops a forty-millisecond frame every second feels far worse than one
 * sitting steadily at forty-five, and an average alone hides exactly that.
 */
const FPS_WINDOW_MS = 500

function FpsMeter() {
  const ref = useRef<HTMLDivElement>(null)
  const on =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('fps') !== '0'

  useEffect(() => {
    if (!on) return
    let raf = 0
    let last = performance.now()
    let frames = 0
    let elapsed = 0
    let worst = 0
    const tick = (now: number) => {
      const dt = now - last
      last = now
      frames++
      elapsed += dt
      if (dt > worst) worst = dt
      if (elapsed > FPS_WINDOW_MS) {
        if (ref.current) {
          // Written straight to textContent rather than through state: this
          // runs twice a second for the life of the page, and re-rendering the
          // whole overlay to move three numbers is the sort of thing a frame
          // meter should be the last component in the tree to do.
          ref.current.textContent = `${Math.round((frames * 1000) / elapsed)} fps · ${(
            elapsed / frames
          ).toFixed(1)}ms avg · ${worst.toFixed(1)}ms worst`
        }
        frames = 0
        elapsed = 0
        worst = 0
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [on])

  if (!on) return null
  return <div className="fpsmeter" ref={ref} aria-hidden="true" />
}

export default function CampUI({
  active,
  inRoom = false,
  showBookHint = false,
}: {
  active: boolean
  inRoom?: boolean
  /** True once inside a tent whose journal hasn't been opened yet. */
  showBookHint?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLSpanElement>(null)
  const bookHintRef = useRef<HTMLSpanElement>(null)

  /**
   * Sequences the name/tent-hint group against the book hint so exactly one
   * of them is ever visible — hide whichever is showing, wait out its fade
   * (the 0.45s in `.campui__name, .campui__hint`), *then* bring the other
   * in. Both used to key off `inRoom`/`showBookHint` directly, which flip in
   * the same commit when a tent is entered: one faded out while the other
   * faded in, and for a beat both were half-visible over each other.
   */
  type Label = 'name' | 'book' | null
  const target: Label = !inRoom ? 'name' : showBookHint ? 'book' : null
  const [label, setLabel] = useState<Label>(target)
  useEffect(() => {
    if (label === target) return
    setLabel(null)
    const id = window.setTimeout(() => setLabel(target), 460)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    const cursor = cursorRef.current
    if (!canvas || !cursor) return

    const ctx = canvas.getContext('2d')!
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    let dpr = 1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const cursorParticles: Particle[] = []
    const nameEmbers: Particle[] = []
    const hintEmbers: Particle[] = []
    const labelEmbers: Particle[] = []

    const pointer = { x: -999, y: -999, px: -999, py: -999, down: false }
    let raf = 0

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      cursor.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`
      cursor.style.opacity = '1'
    }
    const onLeave = () => {
      cursor.style.opacity = '0'
      pointer.x = -999
      pointer.y = -999
    }
    const onDown = () => cursor.classList.add('is-down')
    const onUp = () => cursor.classList.remove('is-down')

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)

    const spawnCursor = (count: number) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 0.2 + Math.random() * 1.1
        cursorParticles.push({
          x: pointer.x + (Math.random() - 0.5) * 10,
          y: pointer.y + (Math.random() - 0.5) * 10,
          vx: Math.cos(angle) * speed,
          // Embers rise.
          vy: Math.sin(angle) * speed - 0.55,
          life: 0,
          maxLife: 40 + Math.random() * 45,
          size: 0.8 + Math.random() * 2.2,
          hue: CURSOR_COLORS[(Math.random() * CURSOR_COLORS.length) | 0],
        })
      }
    }

    /**
     * Every corner informer that gets the name block's ember drift behind it.
     *
     * Queried per spawn rather than held as refs: two of these three are
     * rendered by the page rather than by this component (the sound toggle and
     * the way out of a tent both belong to the room's controls), and a lookup
     * eight times a second is cheaper than threading refs through two more
     * component boundaries to reach them.
     */
    const LABELS = '.campui__hint, .audioswitch, .doorback'

    /** Embers off a whole label, the way the name block sheds them. */
    const spawnLabelEmber = (el: Element) => {
      if (el.closest('[data-hidden="true"]')) return
      const r = el.getBoundingClientRect()
      if (r.width < 1) return
      labelEmbers.push({
        x: r.left + Math.random() * r.width,
        y: r.top + Math.random() * r.height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -0.16 - Math.random() * 0.3,
        life: 0,
        maxLife: 90 + Math.random() * 110,
        size: 0.6 + Math.random() * 1.5,
        hue: CURSOR_COLORS[(Math.random() * CURSOR_COLORS.length) | 0],
      })
    }

    const spawnNameEmber = () => {
      const el = nameRef.current
      if (!el || el.closest('[data-hidden="true"]')) return
      const r = el.getBoundingClientRect()
      nameEmbers.push({
        x: r.left + Math.random() * r.width,
        y: r.top + Math.random() * r.height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: -0.18 - Math.random() * 0.35,
        life: 0,
        maxLife: 120 + Math.random() * 140,
        size: 0.7 + Math.random() * 1.8,
        hue: CURSOR_COLORS[(Math.random() * CURSOR_COLORS.length) | 0],
      })
    }

    /**
     * The hint glyph sheds the same embers the live cursor does, from a tight
     * spawn radius so they read as coming off the ring rather than off the
     * whole label. Skipped while the element is faded out — the hint hides
     * itself inside a tent, and embers pouring out of nothing is worse than no
     * embers at all.
     */
    const spawnHintEmber = (ref: React.RefObject<HTMLSpanElement | null>) => {
      const el = ref.current
      if (!el || el.closest('[data-hidden="true"]')) return
      const r = el.getBoundingClientRect()
      const a = Math.random() * Math.PI * 2
      const rad = 6 + Math.random() * 7
      hintEmbers.push({
        x: r.left + r.width / 2 + Math.cos(a) * rad,
        y: r.top + r.height / 2 + Math.sin(a) * rad,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.2 - Math.random() * 0.4,
        life: 0,
        maxLife: 55 + Math.random() * 70,
        size: 0.6 + Math.random() * 1.5,
        hue: CURSOR_COLORS[(Math.random() * CURSOR_COLORS.length) | 0],
      })
    }

    const draw = (list: Particle[]) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i]
        p.life++
        p.x += p.vx
        p.y += p.vy
        p.vy -= 0.004
        p.vx *= 0.985
        if (p.life > p.maxLife) {
          list.splice(i, 1)
          continue
        }
        const t = p.life / p.maxLife
        const alpha = (1 - t) * (t < 0.15 ? t / 0.15 : 1)
        ctx.beginPath()
        ctx.fillStyle = `hsla(${p.hue}, 100%, ${58 + (1 - t) * 20}%, ${alpha})`
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.45), 0, Math.PI * 2)
        ctx.fill()
      }
    }

    let nameTimer = 0

    const tick = () => {
      ctx.clearRect(0, 0, width, height)
      // Additive so overlapping embers build into a glow instead of flat dots.
      ctx.globalCompositeOperation = 'lighter'

      const moved = Math.hypot(pointer.x - pointer.px, pointer.y - pointer.py)
      pointer.px = pointer.x
      pointer.py = pointer.y
      if (pointer.x > -100) spawnCursor(moved > 2 ? 2 : Math.random() > 0.72 ? 1 : 0)

      nameTimer++
      if (nameTimer % 4 === 0) spawnNameEmber()
      if (nameTimer % 7 === 0) {
        spawnHintEmber(hintRef)
        spawnHintEmber(bookHintRef)
        document.querySelectorAll(LABELS).forEach(spawnLabelEmber)
      }

      draw(cursorParticles)
      draw(nameEmbers)
      draw(hintEmbers)
      draw(labelEmbers)

      ctx.globalCompositeOperation = 'source-over'
      raf = requestAnimationFrame(tick)
    }

    if (!reduced) raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
    }
  }, [active])

  if (!active) return null

  return (
    <>
      <FpsMeter />
      <canvas ref={canvasRef} className="campui__particles" aria-hidden="true" />

      <div className="campui__cursor" ref={cursorRef} aria-hidden="true">
        <span className="campui__cursor-ring" />
        <span className="campui__cursor-dot" />
      </div>

      {/* The cursor and its trail stay alive inside a tent — only the landing
          copy steps aside. */}
      <div className="campui__name" ref={nameRef} data-hidden={label !== 'name'}>
        <h1 className="campui__title">
          {profile.name.split(' ')[0]}
          <br />
          {profile.name.split(' ')[1]}
        </h1>
        <div className="campui__rule" aria-hidden="true">
          <i />
          <span />
          <i />
        </div>
        <p className="campui__role">{profile.role}</p>
      </div>

      <div className="campui__hint" aria-hidden="true" data-hidden={label !== 'name'}>
        {/* The same glyph as the live cursor, with the same embers coming off
            it — so the hint points at the thing the reader is holding. */}
        <span className="campui__hintcursor" ref={hintRef}>
          <i className="campui__hintcursor-ring" />
          <i className="campui__hintcursor-dot" />
        </span>
        <span>Click a tent to explore</span>
      </div>

      <div className="campui__hint" aria-hidden="true" data-hidden={label !== 'book'}>
        <span className="campui__hintcursor" ref={bookHintRef}>
          <i className="campui__hintcursor-ring" />
          <i className="campui__hintcursor-dot" />
        </span>
        <span>Click on the book to open</span>
      </div>
    </>
  )
}
