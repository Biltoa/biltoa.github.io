/**
 * Campsite audio built entirely from recorded CC0 samples.
 *
 * The sound files and their source/license record live in public/audio/camp.
 * Web Audio is retained only for decoding, mixing, fades, and lifecycle
 * control; no oscillator or generated-noise fallback is used.
 */

import { MOBILE_EXPERIENCE } from './graphics'

type Ctx = AudioContext
type UiSample = 'click' | 'toggle' | 'fullscreen' | 'back'
type SampleName =
  | 'ambienceNight'
  | 'ambienceFire'
  | 'tentHover'
  | 'tentEnter'
  | 'tentExit'
  | 'bookOpen'
  | 'bookClose'
  | 'pageDrag'
  | 'pageTurn'
  | 'pageLand'
  | 'pageCancel'
  | 'uiHover'
  | 'uiClick'
  | 'uiToggle'
  | 'uiFullscreen'
  | 'uiBack'

const SAMPLE_URLS: Record<SampleName, string> = {
  ambienceNight: '/audio/camp/ambience-night.mp3',
  ambienceFire: '/audio/camp/ambience-fire.mp3',
  tentHover: '/audio/camp/tent-hover.mp3',
  tentEnter: '/audio/camp/tent-enter.mp3',
  tentExit: '/audio/camp/tent-exit.mp3',
  bookOpen: '/audio/camp/book-open.mp3',
  bookClose: '/audio/camp/book-close.mp3',
  pageDrag: '/audio/camp/page-drag.mp3',
  pageTurn: '/audio/camp/page-turn.mp3',
  pageLand: '/audio/camp/page-land.mp3',
  pageCancel: '/audio/camp/page-cancel.mp3',
  uiHover: '/audio/camp/ui-hover.mp3',
  uiClick: '/audio/camp/ui-click.mp3',
  uiToggle: '/audio/camp/ui-toggle.mp3',
  uiFullscreen: '/audio/camp/ui-fullscreen.mp3',
  uiBack: '/audio/camp/ui-back.mp3',
}

const ALL_SAMPLES = Object.keys(SAMPLE_URLS) as SampleName[]
const UI_SAMPLES: Record<UiSample, SampleName> = {
  click: 'uiClick',
  toggle: 'uiToggle',
  fullscreen: 'uiFullscreen',
  back: 'uiBack',
}

let ctx: Ctx | null = null
let master: GainNode | null = null
let ambientGain: GainNode | null = null
let fireGain: GainNode | null = null
let nightSource: AudioBufferSourceNode | null = null
let fireSource: AudioBufferSourceNode | null = null
let started = false
let muted = false
let gestureSeen = false
let pageAudioActive = false
let campAudioSuppressed = false
let kickElement: HTMLAudioElement | null = null
let lastGestureClock = 0
let lastGestureAt = 0

const rawAssets = new Map<SampleName, ArrayBuffer>()
const rawLoads = new Map<SampleName, Promise<ArrayBuffer | null>>()
const buffers = new Map<SampleName, AudioBuffer>()
const bufferLoads = new Map<SampleName, Promise<AudioBuffer | null>>()
const listeners = new Set<(muted: boolean) => void>()

type DeferredSound = {
  name: SampleName
  gain: number
  playbackRate: number
  delay: number
}

const deferredSounds: DeferredSound[] = []
const audioDiagnostic = { deferred: 0, played: 0, kicks: 0, last: 'created' }

function configureAudioSession(type: 'auto' | 'playback') {
  if (typeof navigator === 'undefined') return
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (!session) return
  try {
    session.type = type
  } catch {
    /* AudioSession is best-effort on partial WebKit implementations. */
  }
}

function publishAudioDiagnostic(last: string) {
  audioDiagnostic.last = last
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  const snapshot = {
    state: ctx?.state ?? 'missing',
    master: master?.gain.value ?? 0,
    ambience: ambientGain?.gain.value ?? 0,
    queued: deferredSounds.length,
    loaded: buffers.size,
    deferred: audioDiagnostic.deferred,
    played: audioDiagnostic.played,
    kicks: audioDiagnostic.kicks,
    clock: ctx?.currentTime ?? 0,
    session:
      typeof navigator === 'undefined'
        ? 'missing'
        : (navigator as Navigator & { audioSession?: { type: string } }).audioSession?.type ??
          'unsupported',
    playerSuppressed: campAudioSuppressed,
    last,
  }
  ;(window as unknown as { __audioDiag?: unknown }).__audioDiag = snapshot
  document.documentElement.dataset.audioDiag = JSON.stringify(snapshot)
}

function fetchSample(name: SampleName) {
  const cached = rawAssets.get(name)
  if (cached) return Promise.resolve(cached)

  const pending = rawLoads.get(name)
  if (pending) return pending

  const load = fetch(SAMPLE_URLS[name])
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load ${SAMPLE_URLS[name]}`)
      return response.arrayBuffer()
    })
    .then((data) => {
      rawAssets.set(name, data)
      return data
    })
    .catch(() => null)
    .finally(() => rawLoads.delete(name))
  rawLoads.set(name, load)
  return load
}

function warmAssetBytes() {
  return Promise.allSettled(ALL_SAMPLES.map(fetchSample))
}

function resetClosedContext() {
  ctx = null
  master = null
  ambientGain = null
  fireGain = null
  nightSource = null
  fireSource = null
  started = false
  buffers.clear()
  bufferLoads.clear()
}

function ensure(): Ctx | null {
  if (typeof window === 'undefined') return null
  if (ctx?.state === 'closed') resetClosedContext()
  if (ctx) return ctx

  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null

  try {
    ctx = new AC()
  } catch {
    return null
  }

  master = ctx.createGain()
  master.gain.value = muted ? 0.0001 : 0.9
  master.connect(ctx.destination)

  const created = ctx
  created.addEventListener('statechange', () => {
    if (created.state === 'running') activateMix(created)
    else publishAudioDiagnostic(`state:${created.state}`)
  })
  return ctx
}

function decodeSample(name: SampleName, context: Ctx) {
  const cached = buffers.get(name)
  if (cached) return Promise.resolve(cached)

  const pending = bufferLoads.get(name)
  if (pending) return pending

  const load = fetchSample(name)
    .then((data) => (data ? context.decodeAudioData(data.slice(0)) : null))
    .then((buffer) => {
      if (buffer && ctx === context && context.state !== 'closed') buffers.set(name, buffer)
      return buffer
    })
    .catch(() => null)
    .finally(() => bufferLoads.delete(name))
  bufferLoads.set(name, load)
  return load
}

async function playSampleNow(
  context: Ctx,
  name: SampleName,
  gainValue: number,
  playbackRate: number,
  delay: number
) {
  const buffer = await decodeSample(name, context)
  if (
    !buffer ||
    !master ||
    muted ||
    !pageAudioActive ||
    ctx !== context ||
    context.state !== 'running'
  ) {
    return
  }

  const source = context.createBufferSource()
  const gain = context.createGain()
  source.buffer = buffer
  source.playbackRate.value = playbackRate
  gain.gain.value = gainValue
  source.connect(gain).connect(master)
  source.start(context.currentTime + delay)
  audioDiagnostic.played += 1
  publishAudioDiagnostic(`played:${name}`)
}

function playSample(name: SampleName, gain = 1, playbackRate = 1, delay = 0.015) {
  if (!gestureSeen || !pageAudioActive || muted) return
  const context = ensure()
  if (!context || !master) return

  if (context.state === 'running') {
    void playSampleNow(context, name, gain, playbackRate, delay)
    return
  }

  if (deferredSounds.length >= 24) deferredSounds.shift()
  deferredSounds.push({ name, gain, playbackRate, delay })
  audioDiagnostic.deferred += 1
  publishAudioDiagnostic(`deferred:${name}`)
}

function flushDeferredSounds() {
  const context = ctx
  if (!context || !master || muted || context.state !== 'running') return
  const sounds = deferredSounds.splice(0)
  for (const sound of sounds) {
    void playSampleNow(
      context,
      sound.name,
      sound.gain,
      sound.playbackRate,
      sound.delay
    )
  }
}

function resumeContext(context: Ctx) {
  if (context.state === 'running') return Promise.resolve()
  const attempt = context.resume().then(
    () => undefined,
    () => undefined
  )
  void attempt.finally(() => {
    if (!pageAudioActive && context.state === 'running') {
      void context.suspend().finally(() => publishAudioDiagnostic(`lifecycle:${context.state}`))
      return
    }
    publishAudioDiagnostic(`resume:${context.state}`)
  })
  return attempt
}

/** Opens iOS's media output with a real sample while the gesture is trusted. */
function kickOutput(context: Ctx) {
  if (muted || typeof Audio === 'undefined') return
  const gestureAt = performance.now()
  const elapsed = gestureAt - lastGestureAt
  const clockAdvanced = context.currentTime > lastGestureClock + 0.002
  const needsKick = context.state !== 'running' || (elapsed > 70 && !clockAdvanced)
  lastGestureAt = gestureAt
  lastGestureClock = context.currentTime
  if (!needsKick) return

  kickElement ??= new Audio(SAMPLE_URLS.uiClick)
  kickElement.preload = 'auto'
  kickElement.volume = 0.04
  kickElement.currentTime = 0
  void kickElement.play().catch(() => undefined)
  audioDiagnostic.kicks += 1
  publishAudioDiagnostic(`output-kick:${context.state}`)
}

function startAmbient() {
  const context = ensure()
  if (!context || !master) return
  if (started) return

  started = true
  ambientGain = context.createGain()
  ambientGain.gain.value = MOBILE_EXPERIENCE ? 0.5 : 0.65
  ambientGain.connect(master)

  void Promise.all([
    decodeSample('ambienceNight', context),
    decodeSample('ambienceFire', context),
  ]).then(([nightBuffer, fireBuffer]) => {
    if (!nightBuffer || !fireBuffer || !ambientGain || ctx !== context) return

    nightSource = context.createBufferSource()
    nightSource.buffer = nightBuffer
    nightSource.loop = true
    const nightGain = context.createGain()
    nightGain.gain.value = 0.34
    nightSource.connect(nightGain).connect(ambientGain)
    nightSource.start()

    fireSource = context.createBufferSource()
    fireSource.buffer = fireBuffer
    fireSource.loop = true
    fireGain = context.createGain()
    fireGain.gain.value = 0.28
    fireSource.connect(fireGain).connect(ambientGain)
    fireSource.start()

    publishAudioDiagnostic('ambience:recordings-ready')
  })
}

/** Called every frame from the scene with the fire's current flicker value. */
export function tickAudio(_elapsed: number, flicker: number) {
  if (!ctx || ctx.state !== 'running' || !started || muted) return
  if (fireGain) fireGain.gain.value = 0.24 + flicker * 0.09
}

/** Recorded soft cloth movement when a tent takes focus. */
export function sfxHover() {
  playSample('tentHover', 0.34)
}

/** Recorded cloth movement as the camera walks into a tent. */
export function sfxEnter() {
  playSample('tentEnter', 0.58)
}

export function sfxUiHover() {
  playSample('uiHover', 0.32)
}

export function sfxUiClick(kind: UiSample = 'click') {
  playSample(UI_SAMPLES[kind], kind === 'click' ? 0.48 : 0.42)
}

export function sfxPageTurn() {
  playSample('pageTurn', MOBILE_EXPERIENCE ? 0.82 : 0.68)
}

export function sfxPageDrag() {
  playSample('pageDrag', MOBILE_EXPERIENCE ? 0.72 : 0.58)
}

export function sfxPageLand(committed: boolean) {
  playSample(committed ? 'pageLand' : 'pageCancel', committed ? 0.72 : 0.5)
}

export function sfxBookOpen() {
  playSample('bookOpen', MOBILE_EXPERIENCE ? 0.72 : 0.6)
}

export function sfxBookClose() {
  playSample('bookClose', MOBILE_EXPERIENCE ? 0.68 : 0.56)
}

export function sfxExit() {
  playSample('tentExit', 0.5)
}

export function campAudioContext(): AudioContext | null {
  return ctx
}

export function isMuted() {
  return muted
}

export function subscribeAudio(fn: (m: boolean) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function fadeMaster(to: number) {
  const context = ctx
  if (!context || !master) return
  const now = context.currentTime
  master.gain.cancelScheduledValues(now)
  master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now)
  master.gain.exponentialRampToValueAtTime(Math.max(to, 0.0001), now + 0.45)
}

function activateMix(context: Ctx) {
  if (
    campAudioSuppressed ||
    !pageAudioActive ||
    !master ||
    muted ||
    context.state !== 'running'
  ) {
    return
  }
  const now = context.currentTime
  master.gain.cancelScheduledValues(now)
  master.gain.setValueAtTime(0.9, now)
  flushDeferredSounds()
  publishAudioDiagnostic('mix:running')
}

/** Call from a user gesture. Starts recorded ambience and interaction sounds. */
export function resumeAudio() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  if (campAudioSuppressed) return
  gestureSeen = true
  pageAudioActive = true
  configureAudioSession('playback')
  const context = ensure()
  if (!context) return
  const resumed = context.state === 'running' ? Promise.resolve() : resumeContext(context)
  kickOutput(context)
  startAmbient()
  void warmAssetBytes()
  if (!muted && master) master.gain.setValueAtTime(0.9, context.currentTime)
  if (context.state === 'running') activateMix(context)
  else void resumed.then(() => activateMix(context))
}

/** Unlock interaction samples without constructing a new ambience graph. */
export function resumeInteractionAudio() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  if (campAudioSuppressed) return
  gestureSeen = true
  pageAudioActive = true
  configureAudioSession('playback')
  const context = ensure()
  if (!context) return
  const resumed = context.state === 'running' ? Promise.resolve() : resumeContext(context)
  kickOutput(context)
  void warmAssetBytes()
  if (context.state === 'running') activateMix(context)
  else void resumed.then(() => activateMix(context))
}

export function setMuted(next: boolean) {
  const wasMuted = muted
  muted = next
  fadeMaster(next ? 0.0001 : 0.9)
  if (wasMuted && !next) sfxUiClick('toggle')
  listeners.forEach((fn) => fn(next))
}

/** Relinquish audio promptly when Safari backgrounds or locks the page. */
export function suspendAudio() {
  pageAudioActive = false
  deferredSounds.length = 0

  const context = ctx
  if (context && master && context.state !== 'closed') {
    const now = context.currentTime
    master.gain.cancelScheduledValues(now)
    master.gain.setValueAtTime(0.0001, now)
  }

  configureAudioSession('auto')
  if (!context || context.state === 'closed' || context.state === 'suspended') {
    publishAudioDiagnostic('lifecycle:suspended')
    return
  }
  void context.suspend().then(
    () => publishAudioDiagnostic('lifecycle:suspended'),
    () => publishAudioDiagnostic(`lifecycle:${context.state}`)
  )
}

/**
 * Gives an embedded player exclusive ownership of audible output.
 *
 * This is a persistent gate rather than a one-shot suspend: pointer and key
 * handlers elsewhere keep trying to unlock campsite audio, including while a
 * Unity canvas owns the page. Those attempts must remain inert until the
 * player closes.
 */
export function setCampAudioSuppressed(next: boolean) {
  if (campAudioSuppressed === next) return
  campAudioSuppressed = next
  publishAudioDiagnostic(next ? 'player:suppressed' : 'player:released')
  if (next) suspendAudio()
}

export function stopAudio() {
  fadeMaster(0.0001)
  publishAudioDiagnostic('mix:stopped')
}

// Download compressed bytes early without creating an AudioContext. This lets
// the first trusted mobile gesture decode and play real samples immediately.
if (typeof window !== 'undefined') {
  window.setTimeout(() => void warmAssetBytes(), 0)
}
