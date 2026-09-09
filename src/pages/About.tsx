import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { attachScrollDriver } from '../lib/scroll'
import {
  isMuted,
  resumeAudio,
  setCampAudioSuppressed,
  setMuted,
  subscribeAudio,
} from '../lib/audio'
import { markProfileEvent } from '../lib/performanceProfile'
import { MOBILE_EXPERIENCE } from '../lib/graphics'
import CampLoader, { type LoadStage } from '../components/CampLoader'
import type { PageScreenRect, PageSide } from '../three/campsite/Book'

const CampHero = lazy(() => import('../three/CampHero'))
const CampUI = lazy(() => import('../components/CampUI'))

type BookPlayerModule = typeof import('../components/BookPlayer')
type BookZoomModule = typeof import('../components/BookZoom')
let bookPlayerModule: Promise<BookPlayerModule> | undefined
let bookZoomModule: Promise<BookZoomModule> | undefined
const loadBookPlayer = () =>
  (bookPlayerModule ??= import('../components/BookPlayer').catch((error) => {
    bookPlayerModule = undefined
    throw error
  }))
const loadBookZoom = () =>
  (bookZoomModule ??= import('../components/BookZoom').catch((error) => {
    bookZoomModule = undefined
    throw error
  }))

const BookPlayer = lazy(loadBookPlayer)
const BookZoom = lazy(loadBookZoom)

/**
 * Longest the curtain is allowed to stay up.
 *
 * If WebGL is unavailable, a texture 404s, or a driver takes an implausible
 * time over a shader, the reader still gets the page. A loading screen that can
 * hang forever is worse than no loading screen.
 */
const LOADER_TIMEOUT_MS = 20000

function PageZoomGlyph({ mode }: { mode: 'in' | 'out' }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="13.5" cy="13.5" r="8.5" />
      <path d="m20 20 8 8" />
      <path d="M9.5 13.5h8" />
      {mode === 'in' && <path d="M13.5 9.5v8" />}
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/*  Landing page. The campsite and its journals are the complete experience.   */
/* -------------------------------------------------------------------------- */

export default function About() {
  const navigate = useNavigate()
  const impostorInspection =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has('impostors')

  // ?room=1 deep-links straight inside a tent, which is also how the interiors
  // get screenshotted without waiting out the whole walk-in.
  const [entered, setEntered] = useState<number | null>(() => {
    const room = new URLSearchParams(window.location.search).get('room')
    const i = room === null ? NaN : Number(room)
    return i >= 0 && i <= 2 ? i : null
  })
  const [mobilePageZoom, setMobilePageZoom] = useState<PageSide | null>(null)
  const [audioMuted, setAudioMuted] = useState(isMuted())
  const [mobileLandscape, setMobileLandscape] = useState(
    () => MOBILE_EXPERIENCE && window.matchMedia('(orientation: landscape)').matches
  )

  useEffect(() => {
    if (!MOBILE_EXPERIENCE) return
    const orientation = window.matchMedia('(orientation: landscape)')
    const syncOrientation = () => setMobileLandscape(orientation.matches)
    syncOrientation()
    orientation.addEventListener('change', syncOrientation)
    return () => orientation.removeEventListener('change', syncOrientation)
  }, [])

  /*
    Loading state.

    Three stages, because there are three genuinely different waits and only the
    middle one can be measured: the code chunks arriving, the kit and its
    textures downloading, and the driver compiling the scene's shaders. See
    CampLoader for how they are budgeted onto one bar.
  */
  const [stage, setStage] = useState<LoadStage>('boot')
  const [assetProgress, setAssetProgress] = useState(0)
  // Unlike `stage`, this is not advanced by the loader's escape-hatch timeout.
  // It stays false until CampHero has really finished shader/texture prewarm,
  // so an offscreen or background load cannot pause halfway through preparing
  // the first interactive frame.
  const [campReady, setCampReady] = useState(false)
  const loaderStartedAt = useRef(performance.now())

  const handleProgress = useCallback((p: number) => {
    setAssetProgress(p)
    // The tracker only exists once the CampHero chunk has run, so the first
    // report is also the signal that the boot stage is over.
    setStage((s) => (s === 'boot' ? 'assets' : s))
  }, [])

  const handleReady = useCallback(() => {
    setCampReady(true)
    setStage('ready')
  }, [])

  // Assets are in but the shaders are not compiled yet — the gap between
  // Suspense resolving and Warmup finishing.
  useEffect(() => {
    if (stage === 'assets' && assetProgress >= 1) setStage('compile')
  }, [stage, assetProgress])

  useEffect(() => {
    if (stage === 'ready') return
    // One absolute deadline for the whole load. Restarting a fresh 20-second
    // timer at every stage could leave a failed boot/assets/compile sequence
    // behind the curtain for close to a minute.
    const remaining = Math.max(0, loaderStartedAt.current + LOADER_TIMEOUT_MS - performance.now())
    const t = setTimeout(() => setStage('ready'), remaining)
    return () => clearTimeout(t)
  }, [stage])

  useEffect(() => {
    markProfileEvent('load-stage', { category: 'camp', detail: stage })
  }, [stage])

  /*
    Nothing scrolls while the curtain is up.

    The hero is 260vh of sticky stage, so a reader who flicks the wheel during
    the load gets the curtain lifted on the middle of the page rather than on
    the camp. Held on the documentElement rather than the body, because the
    tent-entry effect below owns `body.style.overflow` and the two would
    otherwise restore over each other.
  */
  useEffect(() => {
    const loading = stage !== 'ready'
    document.documentElement.classList.toggle('is-loading', loading)
    return () => document.documentElement.classList.remove('is-loading')
  }, [stage])

  const heroRef = useRef<HTMLDivElement>(null)
  const [heroVisible, setHeroVisible] = useState(true)
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  )

  // Stop the expensive camp loops only when none of the hero can be seen. The
  // section, rather than the sticky child, is observed so it remains active for
  // the complete 260vh scroll-driven composition.
  useEffect(() => {
    const hero = heroRef.current
    if (!hero || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => {
      setHeroVisible(entry.isIntersecting)
    })
    observer.observe(hero)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onVisibilityChange = () => {
      setDocumentVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  // The activity gate must never interrupt loading/prewarm. In particular,
  // LOADER_TIMEOUT_MS may reveal the page before a slow driver's real warmup
  // finishes; `campReady`, unlike `stage`, only changes on Warmup's callback.
  // Mobile is a locked, single-viewport experience: the camp cannot actually
  // leave the screen. iOS Safari can nevertheless report the sticky section as
  // non-intersecting while its address bars resize the visual viewport. That
  // false negative used to remove CampUI (name + tap hint), pause the renderer,
  // and leave its tent hit targets inert. Visibility alone is the correct
  // mobile activity gate; desktop keeps its scroll/intersection optimization.
  const campActive = MOBILE_EXPERIENCE
    ? documentVisible
    : !campReady || (heroVisible && documentVisible)

  // CampHero's first progress report proves its own large chunk has already
  // arrived. Only then, and in an idle slice behind the opaque curtain, fetch
  // the two tiny journal-overlay chunks. Their promises are shared with lazy(),
  // so the first play/zoom gesture cannot introduce a new module wait.
  const coreCampScheduled = stage !== 'boot'
  useEffect(() => {
    if (!coreCampScheduled) return
    const preloadJournalOverlays = () => {
      void Promise.allSettled([loadBookPlayer(), loadBookZoom()])
    }
    const w = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(preloadJournalOverlays, { timeout: 2000 })
      return () => w.cancelIdleCallback?.(id)
    }
    const id = window.setTimeout(preloadJournalOverlays, 250)
    return () => window.clearTimeout(id)
  }, [coreCampScheduled])

  useEffect(() => {
    const off = subscribeAudio(setAudioMuted)
    return () => {
      off()
    }
  }, [])

  // Browsers refuse to start audio without a gesture, so the ambience waits for
  // the first real interaction and then fades itself in.
  useEffect(() => {
    const start = () => resumeAudio()
    const opts = { once: true } as const
    window.addEventListener('pointerdown', start, opts)
    window.addEventListener('keydown', start, opts)
    window.addEventListener('wheel', start, opts)
    return () => {
      window.removeEventListener('pointerdown', start)
      window.removeEventListener('keydown', start)
      window.removeEventListener('wheel', start)
    }
  }, [])

  // Drives the three.js scene without re-rendering React.
  useEffect(() => attachScrollDriver(() => heroRef.current), [])

  const inRoom = entered !== null

  // Absorb only a rapid repeat press on the Back-to-fire control while that
  // control fades away. This prevents the second click falling through to the
  // canvas without changing the campsite's existing hover/re-entry timing.
  const [guardingBackClick, setGuardingBackClick] = useState(false)
  const backClickTimer = useRef<number | null>(null)
  const handleBackToFire = useCallback(() => {
    if (entered === null || guardingBackClick) return
    setGuardingBackClick(true)
    setMobilePageZoom(null)
    setEntered(null)
    if (backClickTimer.current !== null) window.clearTimeout(backClickTimer.current)
    backClickTimer.current = window.setTimeout(() => {
      backClickTimer.current = null
      setGuardingBackClick(false)
    }, 360)
  }, [entered, guardingBackClick])
  useEffect(
    () => () => {
      if (backClickTimer.current !== null) window.clearTimeout(backClickTimer.current)
    },
    []
  )

  useEffect(() => {
    markProfileEvent(entered === null ? 'tent-exited' : 'tent-entered', {
      category: 'navigation',
      detail: entered === null ? 'camp' : `tent-${entered}`,
    })
  }, [entered])

  /** Mirrors `playingFrom` for handlers that must not re-bind when it changes. */
  const playingRef = useRef<PageScreenRect | null>(null)
  /** Same, for the picture overlay. */
  const zoomRef = useRef(false)

  // Whether the journal in the current tent has been clicked open yet. Reset
  // the moment `entered` clears — CampHero only ever sets this to true (on the
  // click), so this is also what makes it false again for the next tent.
  const [bookRequested, setBookRequested] = useState(false)
  useEffect(() => {
    if (entered === null) {
      setBookRequested(false)
      setMobilePageZoom(null)
    }
  }, [entered])

  // Opening a journal is a strong signal that its playable build may be next.
  // Start the browser-level preload here so the 255MB payload can overlap the
  // reader's page turns instead of beginning on the final Play click.
  useEffect(() => {
    if (!bookRequested) return
    markProfileEvent('journal-opened', { category: 'navigation', detail: `tent-${entered}` })
    void loadBookPlayer().then(({ preloadUnityBuild }) => preloadUnityBuild())
  }, [bookRequested, entered])

  /**
   * Where the gameplay build is playing from, or null if it is not.
   *
   * Holds the journal page's footprint on screen at the moment it was pressed,
   * because the player opens out of that rectangle rather than out of nowhere.
   * Leaving the tent puts it away — the page it grew from is no longer there.
   */
  /** A picture in the journal being read closer, or null. */
  const [zoomed, setZoomed] = useState<{ src: string; from: PageScreenRect } | null>(null)
  useEffect(() => {
    if (entered === null) setZoomed(null)
  }, [entered])

  const [playingFrom, setPlayingFrom] = useState<PageScreenRect | null>(
    // Dev-only: `?play=1` opens the build straight away, from a rectangle where
    // the right-hand page usually lands. The transition and the loader are
    // otherwise only reachable by walking in, opening the journal, turning to
    // the page and pressing it — which is four animations to look at one.
    () => {
      if (!import.meta.env.DEV) return null
      if (new URLSearchParams(window.location.search).get('play') !== '1') return null
      const w = window.innerWidth
      const h = window.innerHeight
      return { x: w * 0.52, y: h * 0.24, w: w * 0.29, h: h * 0.62 }
    }
  )
  const [mobilePlayerReady, setMobilePlayerReady] = useState(!MOBILE_EXPERIENCE)
  useEffect(() => {
    playingRef.current = playingFrom
    markProfileEvent(playingFrom === null ? 'player-closed' : 'player-requested', {
      category: 'player',
    })
  }, [playingFrom])

  useEffect(() => {
    if (playingFrom === null) return
    setCampAudioSuppressed(true)
    return () => setCampAudioSuppressed(false)
  }, [playingFrom])

  useEffect(() => {
    if (!MOBILE_EXPERIENCE) return
    if (playingFrom === null) {
      setMobilePlayerReady(false)
      return
    }

    // Let React remove the Three canvas first, then release drei/Three loader
    // caches before Unity reserves its WASM heap and creates a second WebGL
    // context. R3F schedules its final root disposal 500ms after unmount.
    // Wait beyond that callback rather than assuming two frames dispose it.
    let cancelled = false
    let secondFrame = 0
    let timer = 0
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          void import('../three/CampHero').then(({ releaseCampAssetCaches }) => {
            if (cancelled) return
            releaseCampAssetCaches()
            markProfileEvent('mobile-camp-released', { category: 'camp' })
            setMobilePlayerReady(true)
          })
        }, 650)
      })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(firstFrame)
      if (secondFrame) cancelAnimationFrame(secondFrame)
      if (timer) window.clearTimeout(timer)
    }
  }, [playingFrom])

  useEffect(() => {
    zoomRef.current = zoomed !== null
  }, [zoomed])

  useEffect(() => {
    if (entered === null) setPlayingFrom(null)
  }, [entered])

  // Unity owns the entire visible stage while its player is mounted. Desktop
  // keeps the campsite alive for the page-to-player transition. Mobile fully
  // unmounts it so Safari never has two large WebGL contexts resident at once.
  const campRenderActive =
    !campReady ||
    (campActive && playingFrom === null && (!MOBILE_EXPERIENCE || !mobileLandscape))
  const campMounted = !MOBILE_EXPERIENCE || playingFrom === null

  useEffect(() => {
    markProfileEvent(campRenderActive ? 'renderer-resumed' : 'renderer-paused', {
      category: 'camp',
      detail: playingFrom === null ? 'camp owns stage' : 'Unity owns stage',
    })
  }, [campRenderActive, playingFrom])

  // Walking into a tent takes over the viewport, so the page must not scroll
  // underneath it. Restore the exact position on the way out.
  useEffect(() => {
    if (!inRoom) return
    const y = window.scrollY
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      // The player owns Escape while it is open; it closes itself and hands the
      // key back. Without this, one press did both and the reader was outside
      // the tent before the build had finished putting itself away.
      //
      // Read through a ref, not through the closure: this effect also takes the
      // scroll position over, and re-running it whenever the player opens or
      // closes puts a scrollTo into the middle of the transition.
      if (e.key === 'Escape' && playingRef.current === null && !zoomRef.current) setEntered(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.scrollTo(0, y)
      window.removeEventListener('keydown', onKey)
    }
  }, [inRoom])

  return (
    <div className="page page--flush">
      <CampLoader
        stage={stage}
        progress={stage === 'assets' ? assetProgress : stage === 'boot' ? 0.5 : 1}
      />

      {/* --------------------------------------------------------------- hero */}
      <section className="hero hero--camp" id="main" ref={heroRef} aria-label="Campsite">
        <div className="hero__stage">
          {campMounted && (
            <Suspense fallback={<div className="hero__canvas" />}>
              <CampHero
              active={campRenderActive}
              entered={entered}
              onEnter={setEntered}
              onNavigate={(to, from) => {
                // Not a route. The build opens out of the page inside the tent,
                // so the campsite stays exactly where it is.
                if (to.startsWith('play:')) {
                  if (from) {
                    // Unity owns audible output from the initiating click until
                    // its player closes. The persistent audio gate also blocks
                    // the app-wide gesture unlockers while the canvas is open.
                    setCampAudioSuppressed(true)
                    if (MOBILE_EXPERIENCE) {
                      void import('../three/CampHero').then(({ retireMobileCampRenderer }) => {
                        retireMobileCampRenderer()
                        setPlayingFrom(from)
                      })
                    } else setPlayingFrom(from)
                  }
                  return
                }
                setEntered(null)
                navigate(to)
              }}
              onZoom={(src, from) => setZoomed({ src, from })}
              pageZoom={mobilePageZoom}
              onPageZoom={setMobilePageZoom}
              onBookOpenRequest={() => setBookRequested(true)}
              onBookClose={() => {
                setBookRequested(false)
                setMobilePageZoom(null)
              }}
              onProgress={handleProgress}
              onReady={handleReady}
              />
            </Suspense>
          )}

          {MOBILE_EXPERIENCE && mobileLandscape && playingFrom === null && (
            <div className="camp-orientation" role="status" aria-live="polite">
              <span className="camp-orientation__phone" aria-hidden="true" />
              <strong>Rotate your phone upright</strong>
              <small>The campsite and journal are designed for portrait</small>
            </div>
          )}

          {MOBILE_EXPERIENCE && !mobileLandscape && inRoom && bookRequested && playingFrom === null && zoomed === null && (
            <div className="book-page-zoom" data-zoomed={mobilePageZoom !== null}>
              {mobilePageZoom === null ? (
                <>
                  <button type="button" className="book-page-zoom__button book-page-zoom__button--left" onClick={() => setMobilePageZoom('left')} aria-label="Zoom in on left journal page">
                    <PageZoomGlyph mode="in" />
                    <span>Read left</span>
                  </button>
                  <button type="button" className="book-page-zoom__button book-page-zoom__button--right" onClick={() => setMobilePageZoom('right')} aria-label="Zoom in on right journal page">
                    <PageZoomGlyph mode="in" />
                    <span>Read right</span>
                  </button>
                </>
              ) : (
                <button type="button" className="book-page-zoom__button book-page-zoom__button--out" onClick={() => setMobilePageZoom(null)} aria-label="Zoom out to the full journal">
                  <PageZoomGlyph mode="out" />
                  <span>Full book</span>
                </button>
              )}
            </div>
          )}

          {!impostorInspection && campMounted && (!MOBILE_EXPERIENCE || !mobileLandscape) && (
            <Suspense fallback={null}>
              <CampUI
                active={campActive}
                particlesActive={campRenderActive}
                inRoom={inRoom}
                showBookHint={inRoom && !bookRequested && playingFrom === null}
                showPageHint={
                  inRoom && bookRequested && playingFrom === null && zoomed === null && mobilePageZoom === null
                }
              />
            </Suspense>
          )}

          {playingFrom && (
            <Suspense fallback={null}>
              <BookPlayer
                from={playingFrom}
                autoStart={mobilePlayerReady}
                onClose={() => {
                  if (MOBILE_EXPERIENCE) {
                    // Quit() has completed, but Safari can retain Unity's
                    // WebAssembly/WebGL allocations until the document is
                    // replaced. Reload immediately without mounting Three in
                    // this document, preserving the crash fix without an
                    // unnecessary confirmation screen.
                    markProfileEvent('camp-reload-requested', { category: 'camp' })
                    window.requestAnimationFrame(() => window.location.reload())
                    return
                  }
                  setCampAudioSuppressed(false)
                  resumeAudio()
                  setPlayingFrom(null)
                }}
              />
            </Suspense>
          )}

          {zoomed && (
            <Suspense fallback={null}>
              <BookZoom src={zoomed.src} from={zoomed.from} onClose={() => setZoomed(null)} />
            </Suspense>
          )}

          {!impostorInspection && (!MOBILE_EXPERIENCE || !mobileLandscape) && (
            <>
              <button
                className="tentswitch audioswitch"
                data-sfx="toggle"
                onClick={() => setMuted(!audioMuted)}
                aria-pressed={!audioMuted}
                aria-label={audioMuted ? 'Unmute ambience' : 'Mute ambience'}
              >
                <span className="audioswitch__icon" aria-hidden="true">{audioMuted ? '🔇' : '🔊'}</span>
                <span>{audioMuted ? 'Sound off' : 'Sound on'}</span>
              </button>

              <button
                className="doorback"
                data-sfx="back"
                data-hidden={!inRoom || playingFrom !== null || zoomed !== null}
                data-guarding={guardingBackClick}
                onClick={handleBackToFire}
                tabIndex={inRoom && playingFrom === null && zoomed === null ? 0 : -1}
              >
                ← Back to the fire
              </button>

              <div className="hero__overlay" data-dim={inRoom} />
            </>
          )}
        </div>
      </section>

    </div>
  )
}
