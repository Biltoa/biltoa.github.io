import { Link } from 'react-router-dom'
import UnityPlayer from '../components/UnityPlayer'

const CONTROLS = [
  { key: 'W A S D', action: 'Move' },
  { key: 'Space', action: 'Jump / handbrake' },
  { key: 'Shift', action: 'Boost' },
  { key: 'Mouse', action: 'Camera' },
  { key: 'R', action: 'Reset' },
  { key: 'Esc', action: 'Release cursor' },
]

const NOTES = [
  {
    title: 'Why it is here',
    body: 'A build in the page beats a video of a build. Reading about how a controller feels is a poor substitute for holding it, so the same gameplay code that ships on device runs here in the browser.',
  },
  {
    title: 'What to look at',
    body: 'Input responsiveness and camera behaviour under fast direction changes — that is where a controller either holds up or falls apart, and it is the part I spend the most iteration on.',
  },
  {
    title: 'Build notes',
    body: 'Compiled for WebGL with compression enabled and stripping on. Frame pacing on WebGL is worse than a native mobile build by design; treat it as a feel demo rather than a performance benchmark.',
  },
]

export default function Gameplay() {
  return (
    <div className="page">
      <div className="wrap page-head">
        <p className="eyebrow">Playable</p>
        <h1 className="display" style={{ marginTop: 22 }}>
          Gameplay
          <br />
          demo
        </h1>
        <p>
          A Unity WebGL build running in the page. No download, no install — click launch and
          drive it.
        </p>
      </div>

      <div className="wrap" style={{ paddingBottom: 'clamp(40px, 6vw, 70px)' }}>
        <UnityPlayer title="Gameplay Demo" />

        <div style={{ marginTop: 40 }}>
          <p className="eyebrow" style={{ marginBottom: 18 }}>
            Controls
          </p>
          <div className="keycaps">
            {CONTROLS.map((c) => (
              <div key={c.key}>
                <span className="key">{c.key}</span>
                <span>{c.action}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            marginTop: 46,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 26,
          }}
        >
          {NOTES.map((n) => (
            <div key={n.title}>
              <h3
                className="mono"
                style={{ color: 'var(--ink-3)', margin: '0 0 10px', fontWeight: 500 }}
              >
                {n.title}
              </h3>
              <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: '0.96rem' }}>{n.body}</p>
            </div>
          ))}
        </div>

        <div className="note" style={{ marginTop: 40 }}>
          <strong>Setup note (visible to you, remove before shipping):</strong> drop the Unity WebGL
          output into <code>public/unity/Build/</code>. The player expects{' '}
          <code>WebGL.loader.js</code>, <code>WebGL.data</code>, <code>WebGL.framework.js</code> and{' '}
          <code>WebGL.wasm</code> — either name the Unity build <code>WebGL</code> or change{' '}
          <code>BUILD_NAME</code> in <code>src/components/UnityPlayer.tsx</code>. Full instructions
          are in <code>public/unity/README.md</code>.
        </div>

        <div style={{ marginTop: 40 }}>
          <Link className="btn" to="/projects?type=game">
            See the shipped titles →
          </Link>
        </div>
      </div>
    </div>
  )
}
