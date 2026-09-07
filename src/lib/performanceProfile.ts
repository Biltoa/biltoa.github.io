export type ProfileEventSeverity = 'info' | 'warning' | 'severe' | 'critical'

export interface ProfileEvent {
  at: number
  category: string
  label: string
  detail: string
  durationMs: number
  severity: ProfileEventSeverity
}

interface ProfileEventOptions {
  at?: number
  category?: string
  detail?: string | number | boolean | null
  durationMs?: number
  severity?: ProfileEventSeverity
}

type ProfileEventSink = (event: ProfileEvent) => void

const PROFILE_EVENTS_ENABLED =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('fps') === '1'

const MAX_PENDING_EVENTS = 256
let sink: ProfileEventSink | null = null
const pending: ProfileEvent[] = []

/**
 * Adds a cheap point or duration marker to the local FPS capture.
 *
 * Calls are a complete no-op outside an explicitly enabled development profile. Events emitted
 * before CampUI's recorder mounts are retained in a small bounded queue, which
 * lets early loader stages appear on the same timeline as later Unity work.
 */
export function markProfileEvent(label: string, options: ProfileEventOptions = {}) {
  if (!PROFILE_EVENTS_ENABLED) return

  const durationMs = Number.isFinite(options.durationMs) ? Math.max(0, options.durationMs ?? 0) : 0
  const event: ProfileEvent = {
    at: Number.isFinite(options.at) ? (options.at ?? performance.now()) : performance.now(),
    category: (options.category ?? 'app').slice(0, 48),
    label: label.slice(0, 96),
    detail: options.detail === undefined || options.detail === null ? '' : String(options.detail).slice(0, 512),
    durationMs,
    severity: options.severity ?? 'info',
  }

  if (sink) {
    sink(event)
    return
  }

  if (pending.length === MAX_PENDING_EVENTS) pending.shift()
  pending.push(event)
}

/** Installs the single session recorder and drains any early lifecycle marks. */
export function attachProfileEventSink(next: ProfileEventSink) {
  sink = next
  if (pending.length) {
    const early = pending.splice(0)
    for (const event of early) next(event)
  }

  return () => {
    if (sink === next) sink = null
  }
}
