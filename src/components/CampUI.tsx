import { useEffect, useRef, useState } from 'react'
import { profile } from '../data/profile'
import { GRAPHICS_DPR } from '../lib/graphics'

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

const PARTICLES_ENABLED =
  !import.meta.env.DEV ||
  typeof window === 'undefined' ||
  new URLSearchParams(window.location.search).get('particles') !== '0'

export default function CampUI({
  active,
  particlesActive = true,
  inRoom = false,
  showBookHint = false,
  showPageHint = false,
}: {
  active: boolean
  /** False while another full-stage renderer (the Unity player) owns the view. */
  particlesActive?: boolean
  inRoom?: boolean
  /** True once inside a tent whose journal hasn't been opened yet. */
  showBookHint?: boolean
  /** True while the journal is open and its full-page gestures are active. */
  showPageHint?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLSpanElement>(null)
  const bookHintRef = useRef<HTMLSpanElement>(null)
  const pageHintRef = useRef<HTMLSpanElement>(null)
  const particlesActiveRef = useRef(particlesActive)

  useEffect(() => {
    particlesActiveRef.current = particlesActive
  }, [particlesActive])

  /**
   * Sequences the name/tent-hint group against the book hint so exactly one
   * of them is ever visible — hide whichever is showing, wait out its fade
   * (the 0.45s in `.campui__name, .campui__hint`), *then* bring the other
   * in. Both used to key off `inRoom`/`showBookHint` directly, which flip in
   * the same commit when a tent is entered: one faded out while the other
   * faded in, and for a beat both were half-visible over each other.
   */
  type Label = 'name' | 'book' | 'pages' | null
  const target: Label = !inRoom
    ? 'name'
    : showBookHint
      ? 'book'
      : showPageHint
        ? 'pages'
        : null
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
    const resize = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.floor(width * GRAPHICS_DPR)
      canvas.height = Math.floor(height * GRAPHICS_DPR)
      ctx.setTransform(GRAPHICS_DPR, 0, 0, GRAPHICS_DPR, 0, 0)
    }
    resize()

    const cursorParticles: Particle[] = []
    const nameEmbers: Particle[] = []
    const hintEmbers: Particle[] = []
    const labelEmbers: Particle[] = []
    const particlePool: Particle[] = []

    const spawn = (
      list: Particle[],
      x: number,
      y: number,
      vx: number,
      vy: number,
      maxLife: number,
      size: number,
      hue: number
    ) => {
      const particle = particlePool.pop()
      if (particle) {
        particle.x = x
        particle.y = y
        particle.vx = vx
        particle.vy = vy
        particle.life = 0
        particle.maxLife = maxLife
        particle.size = size
        particle.hue = hue
        list.push(particle)
      } else {
        list.push({ x, y, vx, vy, life: 0, maxLife, size, hue })
      }
    }

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
        spawn(
          cursorParticles,
          pointer.x + (Math.random() - 0.5) * 10,
          pointer.y + (Math.random() - 0.5) * 10,
          Math.cos(angle) * speed,
          // Embers rise.
          Math.sin(angle) * speed - 0.55,
          40 + Math.random() * 45,
          0.8 + Math.random() * 2.2,
          CURSOR_COLORS[(Math.random() * CURSOR_COLORS.length) | 0]
        )
      }
    }

    /**
     * Every corner informer that gets the name block's ember drift behind it.
     *
     * Two of these three are rendered by the page rather than by this component
     * (the sound toggle and the way out of a tent both belong to the room's
     * controls), so resolve them when an ember is due. In particular, the back
     * control does not exist until a tent is entered.
     */
    const LABELS = '.campui__hint, .audioswitch, .doorback'
    const EMITTERS = `.campui__name, ${LABELS}`

    interface CachedEmitter {
      element: Element
      rect: DOMRect
    }

    let nameEmitter: CachedEmitter | null = null
    let hintEmitters: CachedEmitter[] = []
    let labelEmitters: CachedEmitter[] = []
    let emittersDirty = true
    const movingEmitters = new Map<Element, Set<string>>()

    const cached = (element: Element | null): CachedEmitter | null =>
      element ? { element, rect: element.getBoundingClientRect() } : null

    /**
     * Resolve the handful of DOM emitters once, then keep their rectangles hot.
     * getBoundingClientRect/querySelectorAll in the permanent particle loop
     * forced a synchronous layout several times a second even when the page was
     * perfectly still.
     */
    const refreshEmitters = () => {
      nameEmitter = cached(nameRef.current)
      hintEmitters = [hintRef.current, bookHintRef.current, pageHintRef.current]
        .map(cached)
        .filter((emitter): emitter is CachedEmitter => emitter !== null)
      labelEmitters = Array.from(document.querySelectorAll(LABELS))
        .map(cached)
        .filter((emitter): emitter is CachedEmitter => emitter !== null)
      emittersDirty = false
    }

    const everyEmitter = () =>
      nameEmitter ? [nameEmitter, ...hintEmitters, ...labelEmitters] : [...hintEmitters, ...labelEmitters]

    // A hidden/visible label and a hovered button translate while transitioning.
    // Re-read only those moving roots (and their cursor-glyph descendants), and
    // only on a frame where an ember will actually use the rectangle.
    const refreshMovingEmitterRects = () => {
      if (movingEmitters.size === 0) return
      for (const emitter of everyEmitter()) {
        for (const root of movingEmitters.keys()) {
          if (root === emitter.element || root.contains(emitter.element)) {
            emitter.rect = emitter.element.getBoundingClientRect()
            break
          }
        }
      }
    }

    const onResize = () => {
      resize()
      emittersDirty = true
    }
    const onScroll = () => {
      emittersDirty = true
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, { passive: true })

    const transitionRoot = (target: EventTarget | null) => {
      if (!(target instanceof Element) || !target.matches(EMITTERS)) return null
      return target
    }
    const onTransitionRun = (event: TransitionEvent) => {
      const root = transitionRoot(event.target)
      if (!root) return
      const properties = movingEmitters.get(root) ?? new Set<string>()
      properties.add(event.propertyName)
      movingEmitters.set(root, properties)
    }
    const onTransitionFinish = (event: TransitionEvent) => {
      const root = transitionRoot(event.target)
      if (!root) return
      const properties = movingEmitters.get(root)
      properties?.delete(event.propertyName)
      if (!properties?.size) movingEmitters.delete(root)
      emittersDirty = true
    }
    document.addEventListener('transitionrun', onTransitionRun)
    document.addEventListener('transitionend', onTransitionFinish)
    document.addEventListener('transitioncancel', onTransitionFinish)

    const mutationTouchesEmitter = (mutation: MutationRecord) => {
      const target =
        mutation.target instanceof Element ? mutation.target : mutation.target.parentElement
      if (target?.closest(EMITTERS)) return true
      if (mutation.type !== 'childList') return false
      return [...mutation.addedNodes, ...mutation.removedNodes].some(
        (node) => node instanceof Element && (node.matches(EMITTERS) || node.querySelector(EMITTERS))
      )
    }
    const mutationObserver = new MutationObserver((mutations) => {
      if (mutations.some(mutationTouchesEmitter)) emittersDirty = true
    })
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'data-hidden'],
    })

    let disposed = false
    const onFontsLoaded = () => {
      emittersDirty = true
    }
    document.fonts.addEventListener('loadingdone', onFontsLoaded)
    void document.fonts.ready.then(() => {
      if (!disposed) emittersDirty = true
    })
    refreshEmitters()

    /** Embers off a whole label, the way the name block sheds them. */
    const spawnLabelEmber = ({ element: el, rect: r }: CachedEmitter) => {
      if (el.closest('[data-hidden="true"]')) return
      if (r.width < 1) return
      spawn(
        labelEmbers,
        r.left + Math.random() * r.width,
        r.top + Math.random() * r.height,
        (Math.random() - 0.5) * 0.25,
        -0.16 - Math.random() * 0.3,
        90 + Math.random() * 110,
        0.6 + Math.random() * 1.5,
        CURSOR_COLORS[(Math.random() * CURSOR_COLORS.length) | 0]
      )
    }

    const spawnNameEmber = () => {
      if (!nameEmitter || nameEmitter.element.closest('[data-hidden="true"]')) return
      const r = nameEmitter.rect
      spawn(
        nameEmbers,
        r.left + Math.random() * r.width,
        r.top + Math.random() * r.height,
        (Math.random() - 0.5) * 0.25,
        -0.18 - Math.random() * 0.35,
        120 + Math.random() * 140,
        0.7 + Math.random() * 1.8,
        CURSOR_COLORS[(Math.random() * CURSOR_COLORS.length) | 0]
      )
    }

    /**
     * The hint glyph sheds the same embers the live cursor does, from a tight
     * spawn radius so they read as coming off the ring rather than off the
     * whole label. Skipped while the element is faded out — the hint hides
     * itself inside a tent, and embers pouring out of nothing is worse than no
     * embers at all.
     */
    const spawnHintEmber = ({ element: el, rect: r }: CachedEmitter) => {
      if (!el || el.closest('[data-hidden="true"]')) return
      const a = Math.random() * Math.PI * 2
      const rad = 6 + Math.random() * 7
      spawn(
        hintEmbers,
        r.left + r.width / 2 + Math.cos(a) * rad,
        r.top + r.height / 2 + Math.sin(a) * rad,
        (Math.random() - 0.5) * 0.3,
        -0.2 - Math.random() * 0.4,
        55 + Math.random() * 70,
        0.6 + Math.random() * 1.5,
        CURSOR_COLORS[(Math.random() * CURSOR_COLORS.length) | 0]
      )
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
          particlePool.push(p)
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
      if (PARTICLES_ENABLED && !reduced && particlesActiveRef.current) {
        ctx.clearRect(0, 0, width, height)
        // Additive so overlapping embers build into a glow instead of flat dots.
        ctx.globalCompositeOperation = 'lighter'

        const moved = Math.hypot(pointer.x - pointer.px, pointer.y - pointer.py)
        pointer.px = pointer.x
        pointer.py = pointer.y
        if (pointer.x > -100) spawnCursor(moved > 2 ? 2 : Math.random() > 0.72 ? 1 : 0)

        nameTimer++
        const nameDue = nameTimer % 4 === 0
        const labelsDue = nameTimer % 7 === 0
        if (nameDue || labelsDue) {
          if (emittersDirty) refreshEmitters()
          else refreshMovingEmitterRects()
        }
        if (nameDue) spawnNameEmber()
        if (labelsDue) {
          hintEmitters.forEach(spawnHintEmber)
          labelEmitters.forEach(spawnLabelEmber)
        }

        draw(cursorParticles)
        draw(nameEmbers)
        draw(hintEmbers)
        draw(labelEmbers)

        ctx.globalCompositeOperation = 'source-over'
      }
      raf = requestAnimationFrame(tick)
    }

    if (PARTICLES_ENABLED && !reduced) raf = requestAnimationFrame(tick)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      mutationObserver.disconnect()
      document.fonts.removeEventListener('loadingdone', onFontsLoaded)
      document.removeEventListener('transitionrun', onTransitionRun)
      document.removeEventListener('transitionend', onTransitionFinish)
      document.removeEventListener('transitioncancel', onTransitionFinish)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
    }
  }, [active])

  if (!active) return null

  return (
    <>
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

      <div className="campui__hint" aria-hidden="true" data-hidden={label !== 'pages'}>
        <span className="campui__hintcursor" ref={pageHintRef}>
          <i className="campui__hintcursor-ring" />
          <i className="campui__hintcursor-dot" />
        </span>
        <span>Click a page or drag it to turn</span>
      </div>
    </>
  )
}
