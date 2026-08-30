import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { profile } from '../data/profile'
import { projects } from '../data/projects'
import { useReveal } from '../lib/hooks'
import { attachScrollDriver } from '../lib/scroll'
import { isMuted, resumeAudio, setMuted, stopAudio, subscribeAudio } from '../lib/audio'
import CampLoader, { type LoadStage } from '../components/CampLoader'
import type { PageScreenRect } from '../three/campsite/Book'

const CampHero = lazy(() => import('../three/CampHero'))
const CampUI = lazy(() => import('../components/CampUI'))
const BookPlayer = lazy(() => import('../components/BookPlayer'))
const BookZoom = lazy(() => import('../components/BookZoom'))

/**
 * Longest the curtain is allowed to stay up.
 *
 * If WebGL is unavailable, a texture 404s, or a driver takes an implausible
 * time over a shader, the reader still gets the page. A loading screen that can
 * hang forever is worse than no loading screen.
 */
const LOADER_TIMEOUT_MS = 20000

/* -------------------------------------------------------------------------- */
/*  Landing page. The hero is the campsite scene; everything below it is the    */
/*  plain-HTML version of the same material for anyone who scrolls past.        */
/* -------------------------------------------------------------------------- */

export default function About() {
  const navigate = useNavigate()

  // ?room=1 deep-links straight inside a tent, which is also how the interiors
  // get screenshotted without waiting out the whole walk-in.
  const [entered, setEntered] = useState<number | null>(() => {
    const room = new URLSearchParams(window.location.search).get('room')
    const i = room === null ? NaN : Number(room)
    return i >= 0 && i <= 2 ? i : null
  })
  const [audioMuted, setAudioMuted] = useState(isMuted())

  /*
    Loading state.

    Three stages, because there are three genuinely different waits and only the
    middle one can be measured: the code chunks arriving, the kit and its
    textures downloading, and the driver compiling the scene's shaders. See
    CampLoader for how they are budgeted onto one bar.
  */
  const [stage, setStage] = useState<LoadStage>('boot')
  const [assetProgress, setAssetProgress] = useState(0)

  const handleProgress = useCallback((p: number) => {
    setAssetProgress(p)
    // The tracker only exists once the CampHero chunk has run, so the first
    // report is also the signal that the boot stage is over.
    setStage((s) => (s === 'boot' ? 'assets' : s))
  }, [])

  const handleReady = useCallback(() => {
    setStage('ready')
  }, [])

  // Assets are in but the shaders are not compiled yet — the gap between
  // Suspense resolving and Warmup finishing.
  useEffect(() => {
    if (stage === 'assets' && assetProgress >= 1) setStage('compile')
  }, [stage, assetProgress])

  useEffect(() => {
    if (stage === 'ready') return
    const t = setTimeout(() => setStage('ready'), LOADER_TIMEOUT_MS)
    return () => clearTimeout(t)
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
      stopAudio()
    }
  }, [])

  // Drives the three.js scene without re-rendering React.
  useEffect(() => attachScrollDriver(() => heroRef.current), [])

  const introRef = useReveal<HTMLDivElement>()
  const expRef = useReveal<HTMLDivElement>()
  const skillsRef = useReveal<HTMLDivElement>()
  const eduRef = useReveal<HTMLDivElement>()

  const featured = [
    ...projects.filter((p) => p.featured && p.type === 'game').slice(0, 2),
    ...projects.filter((p) => p.featured && p.type === 'tool').slice(0, 2),
  ]

  const inRoom = entered !== null

  /** Mirrors `playingFrom` for handlers that must not re-bind when it changes. */
  const playingRef = useRef<PageScreenRect | null>(null)
  /** Same, for the picture overlay. */
  const zoomRef = useRef(false)

  // Whether the journal in the current tent has been clicked open yet. Reset
  // the moment `entered` clears — CampHero only ever sets this to true (on the
  // click), so this is also what makes it false again for the next tent.
  const [bookRequested, setBookRequested] = useState(false)
  useEffect(() => {
    if (entered === null) setBookRequested(false)
  }, [entered])

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
  useEffect(() => {
    playingRef.current = playingFrom
  }, [playingFrom])

  useEffect(() => {
    zoomRef.current = zoomed !== null
  }, [zoomed])

  useEffect(() => {
    if (entered === null) setPlayingFrom(null)
  }, [entered])

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

      {/*
        Turn the phone.

        The camp is a landscape composition — three tents on an arc around a
        fire, with the middle one centred — and there is no portrait crop of it
        that keeps all three in frame and still leaves the journal readable.
        Rather than ship a second composition nobody asked for, a touch device
        held upright is asked to turn. Shown and hidden entirely in CSS, on
        `(orientation: portrait) and (pointer: coarse)`, so it costs nothing on
        a desktop and cannot get out of step with a resize the way a JS media
        query listener can.

        Screen Orientation's `lock()` is deliberately not called: outside
        fullscreen it rejects on every browser that matters, and a rejected
        promise on load is worse than a card that says what to do.
      */}
      <div className="rotategate" role="status">
        <div className="rotategate__inner">
          <svg className="rotategate__glyph" viewBox="0 0 64 64" aria-hidden="true">
            <rect x="20" y="6" width="24" height="42" rx="4" />
            <path d="M12 40a22 22 0 0 0 40 0" />
          </svg>
          <p className="rotategate__title">Turn your device</p>
          <p className="rotategate__body">
            The campsite is built for landscape. Rotate to sit down at the fire.
          </p>
        </div>
      </div>

      {/* --------------------------------------------------------------- hero */}
      <section className="hero hero--camp" ref={heroRef} aria-label="Campsite">
        <div className="hero__stage">
          <Suspense fallback={<div className="hero__canvas" />}>
            <CampHero
              entered={entered}
              onEnter={setEntered}
              onNavigate={(to, from) => {
                // Not a route. The build opens out of the page inside the tent,
                // so the campsite stays exactly where it is.
                if (to.startsWith('play:')) {
                  if (from) setPlayingFrom(from)
                  return
                }
                setEntered(null)
                navigate(to)
              }}
              onZoom={(src, from) => setZoomed({ src, from })}
              onBookOpenRequest={() => setBookRequested(true)}
              onExit={() => setEntered(null)}
              onProgress={handleProgress}
              onReady={handleReady}
            />
          </Suspense>

          <Suspense fallback={null}>
            <CampUI
              active
              inRoom={inRoom}
              showBookHint={inRoom && !bookRequested && playingFrom === null}
            />
          </Suspense>

          {playingFrom && (
            <Suspense fallback={null}>
              <BookPlayer from={playingFrom} onClose={() => setPlayingFrom(null)} />
            </Suspense>
          )}

          {zoomed && (
            <Suspense fallback={null}>
              <BookZoom src={zoomed.src} from={zoomed.from} onClose={() => setZoomed(null)} />
            </Suspense>
          )}

          <button
            className="tentswitch audioswitch"
            onClick={() => setMuted(!audioMuted)}
            aria-pressed={!audioMuted}
            aria-label={audioMuted ? 'Unmute ambience' : 'Mute ambience'}
          >
            {audioMuted ? '🔇 Sound off' : '🔊 Sound on'}
          </button>

          <button
            className="doorback"
            data-hidden={!inRoom || playingFrom !== null || zoomed !== null}
            onClick={() => setEntered(null)}
            tabIndex={inRoom && playingFrom === null && zoomed === null ? 0 : -1}
          >
            ← Back to the fire <kbd>Esc</kbd>
          </button>

          <div className="hero__overlay" data-dim={inRoom} />
        </div>
      </section>

      {/* -------------------------------------------------------------- intro */}
      <section className="section" id="main">
        <div className="wrap">
          <div className="reveal" ref={introRef}>
            <p className="eyebrow">About</p>
            <div className="about-grid" style={{ marginTop: 34 }}>
              <div>
                {[...profile.summary, ...profile.whatIBuild].map((para) => (
                  <p key={para.slice(0, 24)}>{para}</p>
                ))}
              </div>

              <dl className="factlist">
                <div>
                  <dt>Based in</dt>
                  <dd>{profile.location}</dd>
                </div>
                <div>
                  <dt>Focus</dt>
                  <dd>Gameplay systems · Unity editor tools</dd>
                </div>
                <div>
                  <dt>Platforms</dt>
                  <dd>{profile.platforms.join(' · ')}</dd>
                </div>
                <div>
                  <dt>Currently</dt>
                  <dd>Pursuing independent projects</dd>
                </div>
                <div>
                  <dt>Contact</dt>
                  <dd>
                    <a href={`mailto:${profile.email}`} style={{ borderBottom: '1px solid var(--line)' }}>
                      {profile.email}
                    </a>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- stats */}
      <div className="statband">
        {profile.stats.map((s) => (
          <div key={s.label}>
            <b className={`accent-${s.accent}`}>{s.value}</b>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {/* ----------------------------------------------------------- featured */}
      <section className="section section--tight">
        <div className="wrap">
          <p className="eyebrow">Selected work</p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(238px, 1fr))',
              gap: 1,
              background: 'var(--line-soft)',
              border: '1px solid var(--line-soft)',
              marginTop: 26,
            }}
          >
            {featured.map((p) => (
              <Link
                key={p.slug}
                to={`/projects/${p.slug}`}
                style={{ background: 'var(--paper)', padding: '26px 24px', display: 'block' }}
              >
                <div className="mono" style={{ color: `var(--${p.accent === 'ink' ? 'ink-3' : p.accent})` }}>
                  {p.type === 'game' ? 'Game' : 'Tool'} · {p.year}
                </div>
                <h3 style={{ margin: '12px 0 8px', fontSize: '1.25rem', fontWeight: 800 }}>
                  {p.title}
                </h3>
                <p className="muted" style={{ margin: 0, fontSize: '0.92rem' }}>
                  {p.blurb}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- experience */}
      <section className="section">
        <div className="wrap reveal" ref={expRef}>
          <p className="eyebrow">Experience</p>
          <div className="timeline" style={{ marginTop: 28 }}>
            {profile.experience.map((job) => (
              <article className="job" key={job.company}>
                <div className="job__meta">
                  <h3>{job.company}</h3>
                  <div className="job__period">{job.period}</div>
                  <div className="job__place">{job.place}</div>
                </div>
                <div>
                  <p className="job__role">{job.role}</p>
                  <ul>
                    {job.points.map((pt) => (
                      <li key={pt.slice(0, 30)}>{pt}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- skills */}
      <section className="section section--tight">
        <div className="wrap reveal" ref={skillsRef}>
          <p className="eyebrow">Skills</p>
          <div className="skills" style={{ marginTop: 26 }}>
            {profile.skills.map((g) => (
              <div className="skills__group" key={g.group}>
                <h3>{g.group}</h3>
                <div className="chips">
                  {g.items.map((i) => (
                    <span className="chip" key={i}>
                      {i}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- education */}
      <section className="section section--tight" style={{ paddingBottom: 'clamp(60px, 9vw, 120px)' }}>
        <div className="wrap reveal" ref={eduRef}>
          <p className="eyebrow">Education</p>
          <div className="timeline" style={{ marginTop: 26 }}>
            {profile.education.map((e) => (
              <div className="job" key={e.school}>
                <div className="job__meta">
                  <h3>{e.school}</h3>
                  <div className="job__period">{e.period}</div>
                </div>
                <p style={{ margin: 0, color: 'var(--ink-2)' }}>{e.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
