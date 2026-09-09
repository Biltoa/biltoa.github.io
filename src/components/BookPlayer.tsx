import { useEffect, useRef, useState } from 'react'
import type { PageScreenRect } from '../three/campsite/Book'
import { MOBILE_EXPERIENCE } from '../lib/graphics'
import { markProfileEvent } from '../lib/performanceProfile'
import { useUnityHost } from './unityBuild'

export { preloadUnityBuild } from './unityBuild'

/* -------------------------------------------------------------------------- */
/*  The build, growing out of the page it was printed on.                      */
/*                                                                             */
/*  Pressing "Play it here" in the gameplay journal does not navigate. The      */
/*  right-hand page reports where it is on screen, the sheet whitens as though  */
/*  the ink had been overexposed, and the player opens out of that exact        */
/*  rectangle to fill the frame. Closing runs it backwards, so the reader is    */
/*  put back on the page they left rather than somewhere new.                   */
/* -------------------------------------------------------------------------- */

type Phase = 'from-page' | 'open' | 'closing'

export default function BookPlayer({
  from,
  autoStart = true,
  onClose,
}: {
  /** The page's footprint on screen when it was pressed. */
  from: PageScreenRect
  /** Delays engine allocation until a previous WebGL stage has been released. */
  autoStart?: boolean
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playerScrollYRef = useRef(typeof window === 'undefined' ? 0 : window.scrollY)
  const [phase, setPhase] = useState<Phase>('from-page')
  const [closeError, setCloseError] = useState('')
  const [mobilePortrait, setMobilePortrait] = useState(
    () => MOBILE_EXPERIENCE && window.matchMedia('(orientation: portrait)').matches,
  )

  const unity = useUnityHost(canvasRef, {
    title: 'Gameplay Demo',
    autoStart: autoStart && (!MOBILE_EXPERIENCE || (phase !== 'closing' && !mobilePortrait)),
  })

  useEffect(() => {
    markProfileEvent('mounted', { category: 'player' })
    return () => {
      if (MOBILE_EXPERIENCE) window.scrollTo({ top: playerScrollYRef.current, behavior: 'auto' })
      markProfileEvent('unmounted', { category: 'player' })
    }
  }, [])

  useEffect(() => {
    if (!MOBILE_EXPERIENCE) return
    const portrait = window.matchMedia('(orientation: portrait)')
    const update = () => setMobilePortrait(portrait.matches)
    update()
    portrait.addEventListener('change', update)
    return () => portrait.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    markProfileEvent('transition-phase', { category: 'player', detail: phase })
  }, [phase])

  useEffect(() => {
    markProfileEvent('status', {
      category: 'unity',
      detail: unity.error ? `${unity.status}: ${unity.error}` : unity.status,
      severity: unity.status === 'error' ? 'critical' : 'info',
    })
  }, [unity.error, unity.status])

  // One frame on the page's own rectangle, then out to the full frame. Both
  // states have to be painted for the transition to have anything to
  // interpolate — mounting straight into the open state just snaps.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')))
    return () => cancelAnimationFrame(id)
  }, [])

  const close = () => {
    if (phase === 'closing') return
    markProfileEvent('close-requested', { category: 'player' })
    setPhase('closing')
    // Long enough for the frame to land back on the page before the element
    // goes; matches the transition below.
    window.setTimeout(() => {
      if (!MOBILE_EXPERIENCE) {
        onClose()
        return
      }
      markProfileEvent('close-animation-finished', { category: 'player' })
      void unity.stop().then(async () => {
        // Keep Three unmounted until Unity has actually finished, including
        // a pending startup. Give the browser time to retire its resources.
        markProfileEvent('mobile-quit-settled', { category: 'player' })
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250))
        window.scrollTo({ top: playerScrollYRef.current, behavior: 'auto' })
        markProfileEvent('mobile-camp-return-allowed', { category: 'player' })
        onClose()
      }).catch((reason: unknown) => {
        setCloseError(reason instanceof Error ? reason.message : 'Unable to close Unity. Please reload this page.')
      })
    }, 620)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape belongs to the player while it is open — the campsite's own
      // Escape handler would otherwise walk the reader out of the tent from
      // underneath it.
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const onPage = phase !== 'open' && !(MOBILE_EXPERIENCE && phase === 'closing')
  const frame: React.CSSProperties = onPage
    ? {
        left: `${from.x}px`,
        top: `${from.y}px`,
        width: `${from.w}px`,
        height: `${from.h}px`,
        opacity: phase === 'closing' ? 0 : 1,
      }
    : { left: '0px', top: '0px', width: '100%', height: '100%', opacity: phase === 'closing' ? 0 : 1 }

  const pct = Math.round(unity.progress * 100)
  const fullscreenDocument = document as Document & { webkitFullscreenEnabled?: boolean }
  const fullscreenAvailable =
    document.fullscreenEnabled || Boolean(fullscreenDocument.webkitFullscreenEnabled)
  const requestFullscreen = async () => {
    await unity.fullscreen()
  }

  return (
    <div className="bookplayer" data-phase={phase} aria-live="polite">
      {closeError && <p role="alert" style={{ position: 'fixed', inset: '40% 10% auto', zIndex: 10 }}>{closeError}</p>}
      {/* The page whitening out. Behind the frame, so the frame appears to be
          what is left once the ink has gone. */}
      <div
        className="bookplayer__flash"
        style={{
          left: `${from.x}px`,
          top: `${from.y}px`,
          width: `${from.w}px`,
          height: `${from.h}px`,
        }}
      />

      <div className="bookplayer__frame" style={frame}>
        <canvas ref={canvasRef} id="unity-canvas" tabIndex={-1} />

        {mobilePortrait && (
          <div className="bookplayer__rotate" role="status">
            <span className="bookplayer__rotate-phone" aria-hidden="true" />
            <strong>Rotate your phone</strong>
            <small>The gameplay demo opens in landscape.</small>
          </div>
        )}

        {!mobilePortrait && <div className="bookplayer__veil" data-hidden={unity.status === 'ready' && !unity.rotating}>
          {unity.rotating ? (
            <div>
              <p className="mono bookplayer__label">Adjusting the view</p>
            </div>
          ) : unity.status !== 'ready' && (
            <>
              {unity.status === 'missing' && (
                <div>
                  <h3>No build installed</h3>
                  <p>
                    Drop a Unity WebGL build into <code>public/unity/Build/</code> and this page
                    picks it up.
                  </p>
                </div>
              )}

              {(unity.status === 'probing' ||
                unity.status === 'idle' ||
                unity.status === 'loading') && (
                <div style={{ width: 'min(420px, 74%)' }}>
                  <p className="mono bookplayer__label">Loading the build</p>
                  <div className="bookplayer__bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mono bookplayer__pct">{pct}%</p>
                </div>
              )}

              {unity.status === 'error' && (
                <div>
                  <h3>Build failed to start</h3>
                  <p>{unity.error}</p>
                </div>
              )}
            </>
          )}
        </div>}

        <div className="bookplayer__controls" data-portrait={mobilePortrait || undefined}>
          <button className="btn btn--ghost bookplayer__back" data-sfx="back" onClick={close}>
            ← Back to the fire {!MOBILE_EXPERIENCE && <kbd>Esc</kbd>}
          </button>
          {!mobilePortrait && !MOBILE_EXPERIENCE && <button
            className="btn btn--ghost"
            data-sfx="toggle"
            onClick={unity.toggleMute}
            disabled={unity.status !== 'ready'}
          >
            {unity.muted ? '🔇 Unmute' : '🔊 Mute'}
          </button>}
          {!mobilePortrait && (!MOBILE_EXPERIENCE || fullscreenAvailable) && <button
            className="btn btn--ghost"
            data-sfx="fullscreen"
            onClick={requestFullscreen}
            disabled={unity.status !== 'ready'}
          >
            ⛶ Fullscreen
          </button>}
        </div>
      </div>
    </div>
  )
}
