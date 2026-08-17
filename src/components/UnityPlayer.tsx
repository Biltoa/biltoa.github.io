import { useCallback, useEffect, useRef, useState } from 'react'

/* -------------------------------------------------------------------------- */
/*  Unity WebGL host.                                                          */
/*                                                                             */
/*  Drop your build output into  public/unity/Build/  and this page picks it up */
/*  on its own. Expected files (default Unity naming, BUILD_NAME below):        */
/*      <name>.loader.js  <name>.data  <name>.framework.js  <name>.wasm         */
/*  Compressed variants (.br / .gz) work too as long as the loader references   */
/*  them — that is Unity's job, not this component's.                           */
/* -------------------------------------------------------------------------- */

const BUILD_NAME = 'WebGL'
const BUILD_DIR = '/unity/Build'
const STREAMING = '/unity/StreamingAssets'

type Status = 'idle' | 'probing' | 'missing' | 'loading' | 'ready' | 'error'

interface UnityInstance {
  SetFullscreen: (on: number) => void
  Quit: () => Promise<void>
  Module?: {
    WEBAudio?: { audioContext?: AudioContext; audioWebEnabled?: number }
  }
  SendMessage: (obj: string, method: string, value?: string | number) => void
}

declare global {
  interface Window {
    createUnityInstance?: (
      canvas: HTMLCanvasElement,
      config: Record<string, unknown>,
      onProgress?: (p: number) => void
    ) => Promise<UnityInstance>
  }
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-unity="${src}"]`)
    if (existing) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.dataset.unity = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.body.appendChild(s)
  })
}

export default function UnityPlayer({ title }: { title: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instanceRef = useRef<UnityInstance | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState('')

  const loaderUrl = `${BUILD_DIR}/${BUILD_NAME}.loader.js`

  // Probe once so the "no build yet" state is honest rather than a guess.
  useEffect(() => {
    let cancelled = false
    setStatus('probing')
    fetch(loaderUrl, { method: 'HEAD' })
      .then((r) => {
        if (cancelled) return
        // A dev server that rewrites 404s to index.html will answer 200 with
        // text/html — treat that as missing, not as a build.
        const type = r.headers.get('content-type') ?? ''
        setStatus(r.ok && !type.includes('text/html') ? 'idle' : 'missing')
      })
      .catch(() => !cancelled && setStatus('missing'))
    return () => {
      cancelled = true
    }
  }, [loaderUrl])

  // Tear the instance down on unmount — a live Unity instance keeps a WebGL
  // context and an audio graph alive, and browsers cap contexts hard.
  useEffect(() => {
    return () => {
      instanceRef.current?.Quit().catch(() => {})
      instanceRef.current = null
    }
  }, [])

  const start = useCallback(async () => {
    if (!canvasRef.current || instanceRef.current) return
    setStatus('loading')
    setProgress(0)
    try {
      await loadScript(loaderUrl)
      if (!window.createUnityInstance) throw new Error('Unity loader did not register')

      const instance = await window.createUnityInstance(
        canvasRef.current,
        {
          dataUrl: `${BUILD_DIR}/${BUILD_NAME}.data`,
          frameworkUrl: `${BUILD_DIR}/${BUILD_NAME}.framework.js`,
          codeUrl: `${BUILD_DIR}/${BUILD_NAME}.wasm`,
          streamingAssetsUrl: STREAMING,
          companyName: 'Ahmad Bilto',
          productName: title,
          productVersion: '1.0',
        },
        (p) => setProgress(p)
      )

      instanceRef.current = instance
      setStatus('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }, [loaderUrl, title])

  const toggleMute = useCallback(() => {
    const ctx = instanceRef.current?.Module?.WEBAudio?.audioContext
    if (!ctx) return
    if (muted) {
      ctx.resume().catch(() => {})
    } else {
      ctx.suspend().catch(() => {})
    }
    setMuted((m) => !m)
  }, [muted])

  const fullscreen = useCallback(() => instanceRef.current?.SetFullscreen(1), [])

  const stop = useCallback(async () => {
    await instanceRef.current?.Quit().catch(() => {})
    instanceRef.current = null
    setStatus('idle')
    setProgress(0)
  }, [])

  const showOverlay = status !== 'ready'

  return (
    <div>
      <div className="player">
        <canvas ref={canvasRef} id="unity-canvas" tabIndex={-1} />

        {showOverlay && (
          <div className="player__overlay">
            {status === 'probing' && <p className="mono">Checking for build…</p>}

            {status === 'idle' && (
              <div>
                <h3>{title}</h3>
                <p>
                  Runs in the browser. Loading starts on click so the page does not pull tens of
                  megabytes at you unasked.
                </p>
                <button className="btn btn--solid" style={{ marginTop: 18 }} onClick={start}>
                  ▶ Launch build
                </button>
              </div>
            )}

            {status === 'loading' && (
              <div style={{ width: '100%' }}>
                <h3>Loading</h3>
                <p className="mono">{Math.round(progress * 100)}%</p>
                <div className="player__bar">
                  <i style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              </div>
            )}

            {status === 'missing' && (
              <div>
                <h3>No build installed yet</h3>
                <p>
                  This page is wired and waiting. Drop a Unity WebGL build into{' '}
                  <code>public/unity/Build/</code> and it appears here — no code change needed.
                </p>
                <p className="mono" style={{ marginTop: 14, color: 'var(--ink-3)' }}>
                  Expected: {BUILD_NAME}.loader.js · .data · .framework.js · .wasm
                </p>
              </div>
            )}

            {status === 'error' && (
              <div>
                <h3>Build failed to start</h3>
                <p>{error}</p>
                <button className="btn" style={{ marginTop: 16 }} onClick={start}>
                  Retry
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="player__controls">
        <button className="btn btn--ghost" onClick={fullscreen} disabled={status !== 'ready'}>
          ⛶ Fullscreen
        </button>
        <button className="btn btn--ghost" onClick={toggleMute} disabled={status !== 'ready'}>
          {muted ? '🔇 Unmute' : '🔊 Mute'}
        </button>
        <button className="btn btn--ghost" onClick={stop} disabled={status !== 'ready'}>
          ■ Stop
        </button>
        <span className="spacer" />
        <span className="player__hint">
          {status === 'ready' ? 'Click the canvas to capture input' : 'Desktop recommended'}
        </span>
      </div>
    </div>
  )
}
