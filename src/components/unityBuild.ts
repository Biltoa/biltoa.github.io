import { useCallback, useEffect, useRef, useState } from 'react'
import { campAudioContext } from '../lib/audio'
import { markProfileEvent } from '../lib/performanceProfile'

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

const loaderScriptPromises = new Map<string, Promise<void>>()
let unityPreloadPromise: Promise<void> | null = null

function unityScript(src: string) {
  return Array.from(document.scripts).find((script) => script.dataset.unity === src)
}

function forgetScript(src: string) {
  loaderScriptPromises.delete(src)
  unityScript(src)?.remove()
}

/**
 * Loads one Unity loader exactly once.
 *
 * Merely finding its tag is not enough: another host may have appended that
 * tag while it is still downloading. Cache the load promise itself so every
 * caller observes the same completion (or failure). A failed tag is discarded
 * as well, allowing a later retry instead of permanently caching the error.
 */
function loadScript(src: string): Promise<void> {
  const cached = loaderScriptPromises.get(src)
  if (cached) {
    markProfileEvent('loader-cache-hit', { category: 'unity', detail: src })
    return cached
  }

  const startedAt = performance.now()
  markProfileEvent('loader-requested', { category: 'unity', detail: src })

  let script = unityScript(src)
  if (script?.dataset.unityState === 'loaded' || (script && window.createUnityInstance)) {
    script.dataset.unityState = 'loaded'
    const loaded = Promise.resolve()
    loaderScriptPromises.set(src, loaded)
    return loaded
  }

  if (!script) {
    script = document.createElement('script')
    script.src = src
    script.async = true
    script.dataset.unity = src
    script.dataset.unityState = 'loading'
  }

  let promise: Promise<void>
  promise = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
    }
    const onLoad = () => {
      cleanup()
      script.dataset.unityState = 'loaded'
      markProfileEvent('loader-ready', {
        category: 'unity',
        detail: src,
        durationMs: performance.now() - startedAt,
      })
      resolve()
    }
    const onError = () => {
      cleanup()
      script.remove()
      markProfileEvent('loader-error', {
        category: 'unity',
        detail: src,
        durationMs: performance.now() - startedAt,
        severity: 'critical',
      })
      reject(new Error(`Failed to load ${src}`))
    }

    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })
    if (!script.isConnected) document.body.appendChild(script)
  }).catch((reason: unknown) => {
    if (loaderScriptPromises.get(src) === promise) loaderScriptPromises.delete(src)
    script.remove()
    throw reason
  })

  loaderScriptPromises.set(src, promise)
  return promise
}

/** Unity's loader and captured audio contexts are global, so lifecycle work is serial. */
let unityLifecycleQueue: Promise<void> = Promise.resolve()

function enqueueUnityOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = unityLifecycleQueue.then(operation)
  unityLifecycleQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
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

function profileUnityResourceTimings(s: string) {
  const paths = [
    `${BUILD_DIR}/${BUILD_NAME}.data${s}`,
    `${BUILD_DIR}/${BUILD_NAME}.framework.js${s}`,
    `${BUILD_DIR}/${BUILD_NAME}.wasm${s}`,
    `${BUILD_DIR}/${BUILD_NAME}.loader.js`,
  ]

  for (const path of paths) {
    const absolute = new URL(path, window.location.href).href
    const entries = performance.getEntriesByName(absolute, 'resource')
    const entry = entries[entries.length - 1] as PerformanceResourceTiming | undefined
    if (!entry) continue
    const source = entry.transferSize === 0 && entry.decodedBodySize > 0 ? 'cache' : 'network'
    markProfileEvent('resource-timing', {
      at: entry.startTime,
      category: 'unity',
      detail: `${path.split('/').pop()} · ${source} · transfer ${(entry.transferSize / 1048576).toFixed(2)}MB · decoded ${(entry.decodedBodySize / 1048576).toFixed(2)}MB`,
      durationMs: entry.duration,
    })
  }
}

/**
 * Starts the expensive Unity downloads while the reader is already engaging
 * with a journal, before they press its play link. `<link rel="preload">` lets
 * the browser stream into its HTTP cache without materialising the 255MB data
 * payload as another JavaScript ArrayBuffer on the page's main thread.
 */
export function preloadUnityBuild(): Promise<void> {
  if (unityPreloadPromise) {
    markProfileEvent('preload-reused', { category: 'unity' })
    return unityPreloadPromise
  }

  const startedAt = performance.now()
  markProfileEvent('preload-started', { category: 'unity' })
  const task = (async () => {
    const s = await suffix()
    if (s === null) {
      markProfileEvent('preload-missing', { category: 'unity', severity: 'warning' })
      return
    }

    const resources = [
      { href: `${BUILD_DIR}/${BUILD_NAME}.data${s}`, type: 'application/octet-stream' },
      { href: `${BUILD_DIR}/${BUILD_NAME}.framework.js${s}`, type: 'application/javascript' },
      { href: `${BUILD_DIR}/${BUILD_NAME}.wasm${s}`, type: 'application/wasm' },
    ]

    for (const { href, type } of resources) {
      if (document.head.querySelector(`link[data-unity-preload="${href}"]`)) {
        markProfileEvent('preload-resource-reused', { category: 'unity', detail: href })
        continue
      }
      const resourceStartedAt = performance.now()
      const link = document.createElement('link')
      link.rel = 'preload'
      link.as = 'fetch'
      link.href = href
      link.type = type
      link.crossOrigin = 'anonymous'
      link.dataset.unityPreload = href
      link.addEventListener(
        'load',
        () => {
          markProfileEvent('preload-resource-ready', {
            category: 'unity',
            detail: href,
            durationMs: performance.now() - resourceStartedAt,
          })
        },
        { once: true },
      )
      link.addEventListener(
        'error',
        () => {
          markProfileEvent('preload-resource-error', {
            category: 'unity',
            detail: href,
            durationMs: performance.now() - resourceStartedAt,
            severity: 'warning',
          })
        },
        { once: true },
      )
      document.head.appendChild(link)
    }
    markProfileEvent('preload-resources-queued', {
      category: 'unity',
      detail: resources.map((resource) => resource.href).join(' | '),
    })

    // Compilation is normally deferred until createUnityInstance(), where an
    // eight-megabyte engine module competes with the first visible player
    // frames. Let the browser compile it off the critical click path; engines
    // can reuse their compiled-code cache when Unity requests the same URL.
    const wasmUrl = resources[2].href
    if (typeof WebAssembly.compileStreaming === 'function') {
      const compileStartedAt = performance.now()
      void WebAssembly.compileStreaming(fetch(wasmUrl, { cache: 'force-cache' })).then(
        () => {
          markProfileEvent('wasm-precompile-ready', {
            category: 'unity',
            durationMs: performance.now() - compileStartedAt,
          })
        },
        () => {
          // Prewarming is opportunistic. Unity's loader remains the
          // authoritative error path and will retry normally if needed.
          markProfileEvent('wasm-precompile-skipped', {
            category: 'unity',
            durationMs: performance.now() - compileStartedAt,
            severity: 'warning',
          })
        },
      )
    }

    await loadScript(`${BUILD_DIR}/${BUILD_NAME}.loader.js`)
    markProfileEvent('preload-loader-ready', {
      category: 'unity',
      durationMs: performance.now() - startedAt,
    })
  })()

  unityPreloadPromise = task.catch((error: unknown) => {
    unityPreloadPromise = null
    markProfileEvent('preload-error', {
      category: 'unity',
      detail: error instanceof Error ? error.message : String(error),
      durationMs: performance.now() - startedAt,
      severity: 'critical',
    })
    console.warn('[unity] Build preload could not start', error)
  })
  return unityPreloadPromise
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
async function silenceEngine(contexts: Iterable<AudioContext> = engineContexts) {
  const camp = campAudioContext()

  for (const c of Array.from(contexts)) {
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
async function teardown(
  instance: UnityInstance | null,
  preserveContexts?: ReadonlySet<AudioContext>
) {
  if (!instance) return
  const startedAt = performance.now()
  markProfileEvent('teardown-started', { category: 'unity' })

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
  await silenceEngine(
    preserveContexts
      ? Array.from(engineContexts).filter((context) => !preserveContexts.has(context))
      : engineContexts
  )
  markProfileEvent('teardown-finished', {
    category: 'unity',
    durationMs: performance.now() - startedAt,
  })
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
  const audioContextsRef = useRef<Set<AudioContext>>(new Set())
  const suffixRef = useRef<string | null>(null)
  const startPromiseRef = useRef<Promise<void> | null>(null)
  const stopPromiseRef = useRef<Promise<void> | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(false)
  const progressFrameRef = useRef<number | null>(null)
  const pendingProgressPctRef = useRef<number | null>(null)
  const committedProgressPctRef = useRef(0)
  const nextProfileProgressRef = useRef(10)
  const [status, setStatus] = useState<UnityStatus>('probing')
  const [progress, setProgress] = useState(0)
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState('')

  const cancelQueuedProgress = useCallback(() => {
    if (progressFrameRef.current !== null) cancelAnimationFrame(progressFrameRef.current)
    progressFrameRef.current = null
    pendingProgressPctRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false
    const probeStartedAt = performance.now()
    markProfileEvent('build-probe-started', { category: 'unity' })
    suffix().then((s) => {
      if (cancelled) return
      suffixRef.current = s
      setStatus(s === null ? 'missing' : 'idle')
      markProfileEvent(s === null ? 'build-missing' : 'build-found', {
        category: 'unity',
        detail: s ?? '',
        durationMs: performance.now() - probeStartedAt,
        severity: s === null ? 'warning' : 'info',
      })
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
    mountedRef.current = true
    hookAudioContext()
    return () => {
      mountedRef.current = false
      generationRef.current++
      cancelQueuedProgress()

      const start = startPromiseRef.current
      const stop = stopPromiseRef.current
      const instance = instanceRef.current
      instanceRef.current = null
      audioContextsRef.current.clear()

      // Keep the constructor hook installed until both an in-flight start and
      // its possible stale-instance teardown have settled. Otherwise Unity can
      // create an uncaptured AudioContext after this host has disappeared.
      const instanceTeardown = instance
        ? enqueueUnityOperation(() => teardown(instance))
        : Promise.resolve()
      const work = [start, stop, instanceTeardown].filter(
        (item): item is Promise<void> => item !== null
      )
      void Promise.allSettled(work).then(() => unhookAudioContext())
    }
  }, [cancelQueuedProgress])

  const start = useCallback(() => {
    if (
      !mountedRef.current ||
      !canvasRef.current ||
      instanceRef.current ||
      startPromiseRef.current ||
      stopPromiseRef.current
    ) {
      return
    }
    const s = suffixRef.current
    if (s === null) return

    const canvas = canvasRef.current
    const generation = ++generationRef.current
    const loaderSrc = `${BUILD_DIR}/${BUILD_NAME}.loader.js`

    cancelQueuedProgress()
    committedProgressPctRef.current = 0
    nextProfileProgressRef.current = 10
    setStatus('loading')
    setProgress(0)
    setError('')
    const loadStartedAt = performance.now()
    markProfileEvent('load-started', { category: 'unity', detail: title })

    const isCurrent = () =>
      mountedRef.current && generationRef.current === generation && canvasRef.current === canvas

    const reportProgress = (value: number) => {
      if (!isCurrent() || !Number.isFinite(value)) return
      const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
      const milestones = [10, 25, 50, 75, 90, 100]
      while (pct >= nextProfileProgressRef.current) {
        const milestone = nextProfileProgressRef.current
        markProfileEvent('load-progress', { category: 'unity', detail: `${milestone}%` })
        const nextIndex = milestones.indexOf(milestone) + 1
        nextProfileProgressRef.current = milestones[nextIndex] ?? 101
      }
      if (pct === committedProgressPctRef.current && pendingProgressPctRef.current === null) return

      pendingProgressPctRef.current = pct
      if (progressFrameRef.current !== null) return
      progressFrameRef.current = requestAnimationFrame(() => {
        progressFrameRef.current = null
        const next = pendingProgressPctRef.current
        pendingProgressPctRef.current = null
        if (next === null || !isCurrent() || next === committedProgressPctRef.current) return
        committedProgressPctRef.current = next
        setProgress(next / 100)
      })
    }

    const task = (async () => {
      try {
        await loadScript(loaderSrc)
        if (!window.createUnityInstance) {
          forgetScript(loaderSrc)
          throw new Error('Unity loader did not register')
        }

        const instance = await enqueueUnityOperation(async () => {
          // This host may have closed while waiting behind an older instance.
          if (!isCurrent()) return null

          // The constructor hook records contexts globally. Preserve any that
          // belonged to an older live host if this initialization fails or is
          // invalidated; only this attempt's newly-created contexts are ours.
          const priorContexts = new Set(engineContexts)
          const createStartedAt = performance.now()
          markProfileEvent('create-instance-started', { category: 'unity', detail: title })
          try {
            const created = await window.createUnityInstance!(
              canvas,
              {
                dataUrl: `${BUILD_DIR}/${BUILD_NAME}.data${s}`,
                frameworkUrl: `${BUILD_DIR}/${BUILD_NAME}.framework.js${s}`,
                codeUrl: `${BUILD_DIR}/${BUILD_NAME}.wasm${s}`,
                streamingAssetsUrl: STREAMING,
                companyName: 'Ahmad Bilto',
                productName: title,
                productVersion: '1.0',
              },
              reportProgress
            )
            markProfileEvent('create-instance-resolved', {
              category: 'unity',
              detail: title,
              durationMs: performance.now() - createStartedAt,
            })

            // Unity downloads cannot be aborted. If the host disappeared
            // during that download, release the just-created WebGL/audio
            // resources here before the next queued player can initialize.
            if (!isCurrent()) {
              await teardown(created, priorContexts)
              return null
            }
            const ownedContexts = Array.from(engineContexts).filter(
              (context) => !priorContexts.has(context) && context !== campAudioContext()
            )
            const knownContext = created.Module?.WEBAudio?.audioContext
            if (knownContext && knownContext !== campAudioContext()) ownedContexts.push(knownContext)
            audioContextsRef.current = new Set(ownedContexts)
            if (import.meta.env.DEV) {
              canvas.dataset.unityAudioCaptured = String(ownedContexts.length)
              canvas.dataset.unityAudioModule = String(Boolean(knownContext))
            }
            return created
          } catch (reason) {
            await silenceEngine(
              Array.from(engineContexts).filter((context) => !priorContexts.has(context))
            )
            throw reason
          }
        })

        if (!instance) return
        if (!isCurrent()) {
          await enqueueUnityOperation(() => teardown(instance))
          return
        }

        instanceRef.current = instance
        reportProgress(1)
        setStatus('ready')
        markProfileEvent('ready', {
          category: 'unity',
          detail: title,
          durationMs: performance.now() - loadStartedAt,
        })
        profileUnityResourceTimings(s)
      } catch (e) {
        if (!isCurrent()) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
        markProfileEvent('load-error', {
          category: 'unity',
          detail: e instanceof Error ? e.message : String(e),
          durationMs: performance.now() - loadStartedAt,
          severity: 'critical',
        })
      }
    })()

    startPromiseRef.current = task
    const clear = () => {
      if (startPromiseRef.current === task) startPromiseRef.current = null
    }
    void task.then(clear, clear)
  }, [cancelQueuedProgress, canvasRef, title])

  useEffect(() => {
    if (autoStart && status === 'idle') void start()
  }, [autoStart, status, start])

  const toggleMute = useCallback(() => {
    const contexts = new Set(audioContextsRef.current)
    const knownContext = instanceRef.current?.Module?.WEBAudio?.audioContext
    if (knownContext && knownContext !== campAudioContext()) contexts.add(knownContext)
    // Some Unity versions build their graph before the instance object is
    // populated. The constructor hook still captures those contexts globally.
    if (contexts.size === 0) {
      for (const context of engineContexts) {
        if (context !== campAudioContext()) contexts.add(context)
      }
    }
    if (contexts.size === 0) return
    const operations = Array.from(contexts, (context) =>
      muted ? context.resume().catch(() => {}) : context.suspend().catch(() => {})
    )
    if (import.meta.env.DEV) {
      void Promise.allSettled(operations).then(() => {
        if (canvasRef.current) {
          canvasRef.current.dataset.unityAudioStates = Array.from(
            contexts,
            (context) => context.state
          ).join(',')
        }
      })
    }
    markProfileEvent(muted ? 'audio-resumed' : 'audio-suspended', { category: 'unity' })
    setMuted((m) => !m)
  }, [muted])

  const fullscreen = useCallback(() => {
    markProfileEvent('fullscreen-requested', { category: 'unity' })
    instanceRef.current?.SetFullscreen(1)
  }, [])

  const stop = useCallback((): Promise<void> => {
    if (stopPromiseRef.current) return stopPromiseRef.current
    markProfileEvent('stop-requested', { category: 'unity' })

    const generation = ++generationRef.current
    cancelQueuedProgress()

    const start = startPromiseRef.current
    const instance = instanceRef.current
    instanceRef.current = null
    audioContextsRef.current.clear()

    const instanceTeardown = instance
      ? enqueueUnityOperation(() => teardown(instance))
      : Promise.resolve()
    const task = (async () => {
      await Promise.allSettled([start ?? Promise.resolve(), instanceTeardown])
      if (!mountedRef.current || generationRef.current !== generation) return
      committedProgressPctRef.current = 0
      setStatus(suffixRef.current === null ? 'missing' : 'idle')
      setProgress(0)
    })()

    stopPromiseRef.current = task
    const clear = () => {
      if (stopPromiseRef.current === task) stopPromiseRef.current = null
    }
    void task.then(clear, clear)
    return task
  }, [cancelQueuedProgress])

  return { status, progress, error, muted, start, stop, fullscreen, toggleMute }
}
