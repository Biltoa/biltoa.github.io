import { useMemo } from 'react'
import type { Accent } from '../data/projects'

const ACCENTS: Record<Accent, string> = {
  red: 'var(--red)',
  blue: 'var(--blue)',
  yellow: 'var(--yellow)',
  ink: 'var(--ink-2)',
}

/** Cheap deterministic hash so a slug always draws the same composition. */
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

function rng(seed: number) {
  let s = seed || 1
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

/**
 * Stand-in artwork for a project with no capture yet. Generated from the slug,
 * so each project gets its own composition and it never changes between loads.
 *
 * Set the project's `thumb` (and gallery `src`) to a real file under /public and
 * this stops being used for that project.
 */
export default function Thumb({
  seed,
  accent,
  label,
  variant = 'card',
}: {
  seed: string
  accent: Accent
  label?: string
  variant?: 'card' | 'shot'
}) {
  const art = useMemo(() => {
    const r = rng(hash(seed))
    const accentColor = ACCENTS[accent]

    // A stack of offset bands plus one dominant shape — enough structure to
    // read as deliberate rather than as a broken image.
    const bands = Array.from({ length: 5 }).map((_, i) => ({
      y: 8 + i * 17 + r() * 5,
      w: 22 + r() * 58,
      x: r() * 34,
      h: 5 + r() * 7,
      fill: i % 2 === 0 ? accentColor : 'var(--ink)',
      op: i % 2 === 0 ? 0.16 + r() * 0.18 : 0.06 + r() * 0.06,
    }))

    const blocks = Array.from({ length: 4 }).map(() => {
      const w = 10 + r() * 20
      return {
        x: 8 + r() * 74,
        y: 20 + r() * 52,
        w,
        h: w * (0.6 + r() * 0.9),
        fill: r() > 0.55 ? accentColor : 'var(--ink)',
        op: 0.1 + r() * 0.55,
      }
    })

    const circle = { cx: 20 + r() * 60, cy: 22 + r() * 46, rad: 9 + r() * 15 }
    const bar = { x: r() * 55, w: 26 + r() * 40 }

    return { bands, blocks, circle, bar, accentColor }
  }, [seed, accent])

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio={variant === 'shot' ? 'xMidYMid slice' : 'none'}
      role="img"
      aria-label={label ? `${label} — placeholder artwork` : 'Placeholder artwork'}
    >
      <rect width="100" height="100" fill="var(--paper-2)" />
      <rect width="100" height="100" fill={art.accentColor} opacity="0.07" />

      {/* diagonal hatch */}
      <g opacity="0.5">
        {Array.from({ length: 16 }).map((_, i) => (
          <line
            key={i}
            x1={-30 + i * 9}
            y1={-5}
            x2={-70 + i * 9}
            y2={105}
            stroke="var(--line)"
            strokeWidth="0.6"
          />
        ))}
      </g>

      {art.bands.map((b, i) => (
        <rect key={`b${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.fill} opacity={b.op} />
      ))}

      <circle
        cx={art.circle.cx}
        cy={art.circle.cy}
        r={art.circle.rad}
        fill="none"
        stroke={art.accentColor}
        strokeWidth="1.6"
        opacity="0.55"
      />

      {art.blocks.map((b, i) => (
        <rect key={`k${i}`} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.fill} opacity={b.op} />
      ))}

      <rect x={art.bar.x} y="80" width={art.bar.w} height="4" fill={art.accentColor} opacity="0.9" />
      <rect x="0" y="97" width="100" height="3" fill={art.accentColor} />
    </svg>
  )
}
