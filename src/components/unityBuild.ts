import { useCallback, useEffect, useRef, useState } from 'react'
import { campAudioContext } from '../lib/audio'

/* -------------------------------------------------------------------------- */
/*  Loading the Unity WebGL player.                                            */
/*                                                                             */
/*  Shared by the full-page player and by the one that grows out of the         */
/*  journal, so there is one answer to "is there a build, and how is it named"  */
/*  rather than two that drift apart.                                          */
/* -------------------------------------------------------------------------- */

const BUILD_NAME = 'WebGL'
const BUILD_DIR = '/unity/Build'
const STREAMING = '/unity/StreamingAssets'

export type UnityStatus = 'probing' | 'missing' | 'idle' | 'loading' | 'ready' | 'error'

export interface UnityInstance {
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
    if (document.querySelector<HTMLScriptElement>(`script[data-unity="${src}"]`)) {
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

/**
 * Whether the build was published with compression and the decompression
 * fallback on.
 *
 * Unity names those files `.data.unityweb` rather than `.data`, and the loader
 * is handed whichever set actually exists. Guessing wrong is a 404 several
 * hundred megabytes into a page load, which is a bad place to find out.
 */
async function suffix(): Promise<string | null> {
  for (const s of ['.unityweb', '']) {
    try {
      const r = await fetch(`${BUILD_DIR}/${BUILD_NAME}.data${s}`, { method: 'HEAD' })
      // A dev server that rewrites 404s to index.html answers 200 with
      // text/html — that is a missing build, not a found one.
      const type = r.headers.get('content-type') ?? ''
      if (r.ok && !type.includes('text/html')) return s
    } catch {
      /* fall through to the next candidate */
    }
  }
  return null
}

/* ------------------------------------------------------------ engine audio */

/**
 * Every AudioContext opened while a Unity host is alive.
 *
 * `instance.Module.WEBAudio.audioContext` is the documented way to reach the
 * engine's audio, and on this build it is not there — `Quit()` returned, the
 * player went away, and the car was still audible. So the context is caught at
 * the moment it is constructed instead, which does not depend on the shape of
 * the object the loader hands back.
 */
const engineContexts = new Set<AudioContext>()

let nativeAudioContext: typeof AudioContext | null = null
let hostsAlive = 0

function hookAudioContext() {
  if (typeof window === 'undefined') return
  hostsAlive++
  if (nativeAudioContext) return

  nativeAudioContext = window.AudioContext
  const Native = nativeAudioContext

  window.AudioContext = class extends Native {
    constructor(...args: ConstructorParameters<typeof AudioContext>) {
      super(...args)
      engineContexts.add(this)
    }
  } as typeof AudioContext
}

function unhookAudioContext() {
  hostsAlive = Math.max(0, hostsAlive - 1)
  if (hostsAlive > 0 || !nativeAudioContext) return
  window.AudioContext = nativeAudioContext
  nativeAudioContext = null
}

/**
 * Silences and releases every context the engine opened.
 *
 * The camp has a context of its own and it is emphatically not ours to close —
 * it is excluded by identity rather than by heuristic.
 */
async function silenceEngine() {
  const camp = campAudioContext()

  for (const c of Array.from(engineContexts)) {
    engineContexts.delete(c)
    if (c === camp) continue
    try {
      await c.suspend()
    } catch {
      /* already suspended */
    }
    if (c.state !== 'closed') {
      try {
        await c.close()
      } catch {
        /* nothing else to try */
      }
    }
  }
}

/**
 * Shuts an instance down, audio first.
 *
 * `Quit()` alone leaves the engine still audible. It tears down the module, but
 * the WebAudio graph it built lives on the page's AudioContext, and that
 * context keeps running with whatever was in flight when the module went — so
 * walking out of the tent left the car still idling somewhere off-screen. The
 * context has to be stopped explicitly, and stopped *before* Quit, because
 * afterwards there is no longer a module to reach it through.
 */
async function teardown(instance: UnityInstance | null) {
  if (!instance) return

  // Suspend first, so nothing is mid-buffer while the module is torn down.
  const known = instance.Module?.WEBAudio?.audioContext
  if (known) {
    try {
      await known.suspend()
    } catch {
      /* already suspended, or never started */
    }
  }

  try {
    await instance.Quit()
  } catch {
    /* the module may already be gone */
  }

  // Closed after Quit: a closed context makes the engine's own teardown throw,
  // and this is the last chance to release the hardware.
  await silenceEngine()
}

export interface UnityHost {
  status: UnityStatus
  progress: number
  error: string
  muted: boolean
  /** Starts the download. Safe to call more than once. */
  start: () => void
  stop: () => Promise<void>
  fullscreen: () => void
  toggleMute: () => void
}

/**
 * Drives one Unity instance on the given canvas.
 *
 * `autoStart` is for the journal: the reader has already committed by pressing
 * the page, so making them press a second button inside the transition would be
 * a worse experience than simply starting.
 */
export function useUnityHost(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  { title, autoStart = false }: { title: string; autoStart?: boolean }
): UnityHost {
  const instanceRef = useRef<UnityInstance | null>(null)
  const suffixRef = useRef<string | null>(null)
  const [status, setStatus] = useState<UnityStatus>('probing')
  const [progress, setProgress] = useState(0)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    suffix().then((s) => {
      if (cancelled) return
      suffixRef.current = s
      setStatus(s === null ? 'missing' : 'idle')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // A live instance holds a WebGL context and an audio graph, and browsers cap
  // contexts hard — so it goes when the host does. The constructor hook has to
  // be in place before the engine ever runs, which is why it is installed with
  // the host rather than with the instance.
  useEffect(() => {
    hookAudioContext()
    return () => {
      void teardown(instanceRef.current).finally(unhookAudioContext)
      instanceRef.current = null
    }
  }, [])

  const start = useCallback(async () => {
    if (!canvasRef.current || instanceRef.current) return
    const s = suffixRef.current
    if (s === null) return

    setStatus('loading')
    setProgress(0)
    try {
      await loadScript(`${BUILD_DIR}/${BUILD_NAME}.loader.js`)
      if (!window.createUnityInstance) throw new Error('Unity loader did not register')

      const instance = await window.createUnityInstance(
        canvasRef.current,
        {
          dataUrl: `${BUILD_DIR}/${BUILD_NAME}.data${s}`,
          frameworkUrl: `${BUILD_DIR}/${BUILD_NAME}.framework.js${s}`,
          codeUrl: `${BUILD_DIR}/${BUILD_NAME}.wasm${s}`,
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
  }, [canvasRef, title])

  useEffect(() => {
    if (autoStart && status === 'idle') void start()
  }, [autoStart, status, start])

  const toggleMute = useCallback(() => {
    const ctx = instanceRef.current?.Module?.WEBAudio?.audioContext
    if (!ctx) return
    if (muted) ctx.resume().catch(() => {})
    else ctx.suspend().catch(() => {})
    setMuted((m) => !m)
  }, [muted])

  const fullscreen = useCallback(() => instanceRef.current?.SetFullscreen(1), [])

  const stop = useCallback(async () => {
    await teardown(instanceRef.current)
    instanceRef.current = null
    setStatus(suffixRef.current === null ? 'missing' : 'idle')
    setProgress(0)
  }, [])

  return { status, progress, error, muted, start, stop, fullscreen, toggleMute }
}
