/**
 * Campsite audio, synthesised in the Web Audio API.
 *
 * Nothing is downloaded: fire, wind and grass are all filtered noise, and the
 * interface sounds are short FM blips. That keeps the page free of audio
 * licensing questions entirely, keeps the payload at zero bytes, and lets the
 * fire's crackle density track the same flicker value the light uses.
 *
 * Browsers block audio until a gesture, so nothing starts until `resume()` is
 * called from a real click, keypress or scroll.
 */

type Ctx = AudioContext & { __campNodes?: Record<string, AudioNode> }

let ctx: Ctx | null = null
let master: GainNode | null = null
let ambientGain: GainNode | null = null
let fireGain: GainNode | null = null
let transientNoise: AudioBuffer | null = null
let windGain: GainNode | null = null
let crackleTimer = 0
let started = false
let muted = false

const TRANSIENT_NOISE_SECONDS = 8

const listeners = new Set<(muted: boolean) => void>()

function noiseBuffer(context: AudioContext, seconds = 2) {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  // Brown-ish noise: integrating white noise gives the low rumble that reads as
  // wind rather than radio static.
  let last = 0
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = last * 3.5
  }
  return buffer
}

function transientNoiseSource(context: AudioContext, seconds: number) {
  transientNoise ??= noiseBuffer(context, TRANSIENT_NOISE_SECONDS)

  const source = context.createBufferSource()
  source.buffer = transientNoise

  // Every one-shot gets a different section of the same primed noise bed. The
  // requested duration remains identical to the old per-effect buffer length,
  // while the random offset keeps consecutive bursts from sounding repeated.
  const duration = Math.min(Math.max(seconds, 1 / context.sampleRate), transientNoise.duration)
  const availableOffset = transientNoise.duration - duration
  const offset = availableOffset > 0 ? Math.random() * availableOffset : 0

  return { source, offset, duration }
}

function ensure(): Ctx | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  try {
    ctx = new AC() as Ctx
  } catch {
    return null
  }
  master = ctx.createGain()
  master.gain.value = 0.0001
  master.connect(ctx.destination)
  return ctx
}

/**
 * Builds the suspended Web Audio graph while the loading curtain is present.
 * Browsers still require a gesture before `resume()`, but graph construction
 * and the four noise buffers do not. Keeping that work off the first tent click
 * removes an otherwise visible main-thread pause from the camera transition.
 */
export function primeAudio() {
  const c = ensure()
  if (!c) return
  startAmbient()
}

/** Builds the looping ambience. Safe to call repeatedly. */
function startAmbient() {
  const c = ensure()
  if (!c || !master) return

  // Prime the reusable one-shot reservoir during the loading screen. Calling
  // this again is intentionally cheap, and preserves a lazy fallback when
  // primeAudio() was skipped and audio first starts from a user gesture.
  transientNoise ??= noiseBuffer(c, TRANSIENT_NOISE_SECONDS)

  if (started) return
  started = true

  ambientGain = c.createGain()
  ambientGain.gain.value = 1
  ambientGain.connect(master)

  /* ------------------------------------------------------------------ wind */
  const windSource = c.createBufferSource()
  windSource.buffer = noiseBuffer(c, 4)
  windSource.loop = true

  const windFilter = c.createBiquadFilter()
  windFilter.type = 'bandpass'
  windFilter.frequency.value = 420
  windFilter.Q.value = 0.7

  windGain = c.createGain()
  windGain.gain.value = 0.16

  windSource.connect(windFilter).connect(windGain).connect(ambientGain)
  windSource.start()

  // Slow gusts: an LFO on both the filter and the level, so gusts brighten as
  // well as swell.
  const gust = c.createOscillator()
  gust.frequency.value = 0.06
  const gustDepth = c.createGain()
  gustDepth.gain.value = 240
  gust.connect(gustDepth).connect(windFilter.frequency)
  const gustLevel = c.createGain()
  gustLevel.gain.value = 0.08
  gust.connect(gustLevel).connect(windGain.gain)
  gust.start()

  /* ------------------------------------------------------- grass / foliage */
  const grassSource = c.createBufferSource()
  grassSource.buffer = noiseBuffer(c, 3)
  grassSource.loop = true
  const grassFilter = c.createBiquadFilter()
  grassFilter.type = 'highpass'
  grassFilter.frequency.value = 2600
  const grassGain = c.createGain()
  grassGain.gain.value = 0.035
  grassSource.connect(grassFilter).connect(grassGain).connect(ambientGain)
  grassSource.start()

  const rustle = c.createOscillator()
  rustle.frequency.value = 0.13
  const rustleDepth = c.createGain()
  rustleDepth.gain.value = 0.028
  rustle.connect(rustleDepth).connect(grassGain.gain)
  rustle.start()

  /* ------------------------------------------------------------------ fire */
  const fireSource = c.createBufferSource()
  fireSource.buffer = noiseBuffer(c, 3)
  fireSource.loop = true
  const fireFilter = c.createBiquadFilter()
  fireFilter.type = 'lowpass'
  fireFilter.frequency.value = 900
  fireGain = c.createGain()
  fireGain.gain.value = 0.11
  fireSource.connect(fireFilter).connect(fireGain).connect(ambientGain)
  fireSource.start()
}

/** One crackle: a short filtered noise burst with a snappy envelope. */
function crackle(strength: number) {
  const c = ctx
  if (!c || !ambientGain) return
  const now = c.currentTime
  const { source: src, offset, duration } = transientNoiseSource(c, 0.12)

  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 900 + Math.random() * 2600
  filter.Q.value = 1.4

  const gain = c.createGain()
  const peak = 0.05 + Math.random() * 0.1 * strength
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06 + Math.random() * 0.1)

  src.connect(filter).connect(gain).connect(ambientGain)
  src.start(now, offset, duration)
  src.stop(now + 0.25)
}

/** Called every frame from the scene with the fire's current flicker value. */
export function tickAudio(elapsed: number, flicker: number) {
  if (!ctx || !started || muted) return
  if (fireGain) fireGain.gain.value = 0.09 + flicker * 0.05
  // Crackle density rises with the flare-ups.
  if (elapsed > crackleTimer) {
    crackle(flicker)
    crackleTimer = elapsed + 0.08 + Math.random() * 0.5
  }
}

/* ---------------------------------------------------------------- one-shots */

function blip({
  freq,
  to,
  duration,
  type = 'sine',
  gain = 0.08,
}: {
  freq: number
  to?: number
  duration: number
  type?: OscillatorType
  gain?: number
}) {
  const c = ctx
  if (!c || !master || muted) return
  const now = c.currentTime
  const osc = c.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, now)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, now + duration)

  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, now)
  g.gain.exponentialRampToValueAtTime(gain, now + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration)

  osc.connect(g).connect(master)
  osc.start(now)
  osc.stop(now + duration + 0.05)
}

/** Soft wooden chime when a tent takes focus. */
export function sfxHover() {
  blip({ freq: 520, to: 780, duration: 0.18, type: 'triangle', gain: 0.05 })
  blip({ freq: 1040, to: 1560, duration: 0.12, type: 'sine', gain: 0.02 })
}

/** Low whoosh as the camera walks in. */
export function sfxEnter() {
  const c = ctx
  if (!c || !master || muted) return
  const now = c.currentTime
  const { source: src, offset, duration } = transientNoiseSource(c, 1.6)
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(300, now)
  filter.frequency.exponentialRampToValueAtTime(1800, now + 0.9)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, now)
  g.gain.exponentialRampToValueAtTime(0.13, now + 0.35)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 1.5)
  src.connect(filter).connect(g).connect(master)
  src.start(now, offset, duration)
  src.stop(now + 1.7)

  blip({ freq: 180, to: 90, duration: 0.7, type: 'sine', gain: 0.06 })
}

/* --------------------------------------------------------------- the book */

/**
 * A sheet of paper moving.
 *
 * Filtered noise with a fast attack and a swept band, which is most of what a
 * page turn is: a broadband rustle whose centre frequency rises as the sheet
 * comes up off the block and falls again as it lands. Two of them, offset, so
 * it reads as paper against paper rather than as one hiss.
 */
function paper({
  duration = 0.42,
  from = 900,
  to = 2600,
  gain = 0.11,
  q = 0.9,
  delay = 0,
}: {
  duration?: number
  from?: number
  to?: number
  gain?: number
  q?: number
  delay?: number
} = {}) {
  const c = ctx
  if (!c || !master || muted) return

  const now = c.currentTime + delay
  const noiseDuration = Math.max(duration + 0.2, 0.6)
  const { source: src, offset, duration: sourceDuration } = transientNoiseSource(c, noiseDuration)

  // Brown noise is too dark on its own for paper — the band-pass is what puts
  // the sibilance back without making it sound like tape hiss.
  const band = c.createBiquadFilter()
  band.type = 'bandpass'
  band.Q.value = q
  band.frequency.setValueAtTime(from, now)
  band.frequency.exponentialRampToValueAtTime(to, now + duration * 0.55)
  band.frequency.exponentialRampToValueAtTime(from * 0.7, now + duration)

  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, now)
  g.gain.exponentialRampToValueAtTime(gain, now + 0.045)
  g.gain.exponentialRampToValueAtTime(0.0001, now + duration)

  src.connect(band).connect(g).connect(master)
  src.start(now, offset, sourceDuration)
  src.stop(now + duration + 0.1)
}

/** A leaf going over. */
export function sfxPageTurn() {
  paper({ duration: 0.40, from: 800, to: 2500, gain: 0.10 })
  paper({ duration: 0.26, from: 1600, to: 3400, gain: 0.05, q: 1.6, delay: 0.06 })
}

/**
 * The cover lifting.
 *
 * Leather and board rather than paper, so the sweep runs the other way and a
 * low body note sits underneath it — a heavy thing being moved, followed by the
 * block of pages settling open.
 */
export function sfxBookOpen() {
  paper({ duration: 0.55, from: 2200, to: 700, gain: 0.09, q: 0.7 })
  blip({ freq: 120, to: 74, duration: 0.5, type: 'sine', gain: 0.05 })
  paper({ duration: 0.3, from: 900, to: 1800, gain: 0.05, delay: 0.22 })
}

/** The covers meeting. A softer, deader version of the same thing. */
export function sfxBookClose() {
  paper({ duration: 0.34, from: 1800, to: 600, gain: 0.10, q: 0.7 })
  blip({ freq: 96, to: 58, duration: 0.34, type: 'sine', gain: 0.07 })
}

export function sfxExit() {
  blip({ freq: 320, to: 180, duration: 0.4, type: 'sine', gain: 0.05 })
}

/* ------------------------------------------------------------------ control */

/**
 * The campsite's own audio context, if one has been created.
 *
 * Exposed so the Unity host can tell the camp's context apart from the ones the
 * engine opens — it closes everything it finds except this.
 */
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
  const c = ctx
  if (!c || !master) return
  const now = c.currentTime
  master.gain.cancelScheduledValues(now)
  master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now)
  master.gain.exponentialRampToValueAtTime(Math.max(to, 0.0001), now + 0.8)
}

/** Call from a user gesture. Starts the graph and fades the ambience in. */
export function resumeAudio() {
  const c = ensure()
  if (!c) return
  startAmbient()
  if (c.state === 'suspended') void c.resume()
  if (!muted) fadeMaster(0.9)
}

export function setMuted(next: boolean) {
  muted = next
  fadeMaster(next ? 0.0001 : 0.9)
  listeners.forEach((fn) => fn(next))
}

export function stopAudio() {
  fadeMaster(0.0001)
}
