import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getNeighbours, getProject } from '../data/projects'
import Thumb from '../components/Thumb'

export default function ProjectDetail() {
  const { slug = '' } = useParams()
  const project = getProject(slug)
  const { prev, next } = getNeighbours(slug)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    if (project) document.title = `${project.title} — Ahmad Bilto`
    return () => {
      document.title = 'Ahmad Bilto — Gameplay & Tools Developer'
    }
  }, [slug, project])

  if (!project) {
    return (
      <div className="page">
        <div className="wrap page-head">
          <p className="eyebrow">404</p>
          <h1 className="display" style={{ marginTop: 20 }}>
            No such
            <br />
            project
          </h1>
          <p>That slug does not exist. It may have been renamed.</p>
          <Link className="btn" to="/projects" style={{ marginTop: 24 }}>
            ← Back to projects
          </Link>
        </div>
      </div>
    )
  }

  const accentVar = `var(--${project.accent === 'ink' ? 'ink' : project.accent})`

  return (
    <div className="page">
      <header className="detail-hero">
        <div className="wrap detail-hero__inner">
          <Link className="backlink" to="/projects">
            ← All projects
          </Link>

          <div
            className="mono"
            style={{ color: accentVar, display: 'flex', gap: 14, flexWrap: 'wrap' }}
          >
            <span>{project.type === 'game' ? 'Game' : 'Tool'}</span>
            <span style={{ color: 'var(--ink-3)' }}>{project.status}</span>
            <span style={{ color: 'var(--ink-3)' }}>{project.period}</span>
          </div>

          <h1 className="display detail-title" style={{ marginTop: 18 }}>
            {project.title}
          </h1>
          <p className="detail-sub">{project.subtitle}</p>

          <div
            style={{
              marginTop: 34,
              border: '1px solid var(--line)',
              aspectRatio: '21 / 9',
              overflow: 'hidden',
              background: 'var(--paper-2)',
            }}
          >
            {project.video ? (
              <video
                src={project.video}
                poster={project.thumb}
                controls
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : project.thumb ? (
              <img
                src={project.thumb}
                alt={project.title}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <Thumb seed={project.slug} accent={project.accent} label={project.title} variant="shot" />
            )}
          </div>

          <dl className="detail-meta">
            <div>
              <dt>Role</dt>
              <dd>{project.role}</dd>
            </div>
            <div>
              <dt>Team</dt>
              <dd>{project.team}</dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd>{project.engine}</dd>
            </div>
            <div>
              <dt>Platforms</dt>
              <dd>{project.platforms.join(', ')}</dd>
            </div>
            <div>
              <dt>Year</dt>
              <dd>{project.year}</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="wrap detail-body">
        <div className="prose">
          <h2>Overview</h2>
          {project.overview.map((p) => (
            <p key={p.slice(0, 26)}>{p}</p>
          ))}

          <h2>What I built</h2>
          <ul>
            {project.contributions.map((c) => (
              <li key={c.slice(0, 26)}>{c}</li>
            ))}
          </ul>

          <h2>Technical notes</h2>
          <ul>
            {project.technical.map((t) => (
              <li key={t.slice(0, 26)}>{t}</li>
            ))}
          </ul>
        </div>

        <aside className="aside">
          {project.metrics && project.metrics.length > 0 && (
            <div className="panel">
              <h3>By the numbers</h3>
              <div className="metrics">
                {project.metrics.map((m) => (
                  <div className="metric" key={m.label}>
                    <b style={{ color: accentVar }}>{m.value}</b>
                    <span>{m.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="panel">
            <h3>Stack</h3>
            <div className="chips">
              {project.tech.map((t) => (
                <span className="chip" key={t}>
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="panel">
            <h3>Tags</h3>
            <div className="chips">
              {project.tags.map((t) => (
                <Link className="chip" key={t} to={`/projects?tags=${encodeURIComponent(t)}`}>
                  {t}
                </Link>
              ))}
            </div>
          </div>

          {project.links && project.links.length > 0 && (
            <div className="panel">
              <h3>Links</h3>
              <div className="stack" style={{ gap: 10 }}>
                {project.links.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mono"
                    style={{ borderBottom: '1px solid var(--line)', paddingBottom: 4 }}
                  >
                    {l.label} ↗
                  </a>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {project.gallery && project.gallery.length > 0 && (
        <div className="wrap">
          <p className="eyebrow" style={{ marginBottom: 22 }}>
            Gallery
          </p>
          <div className="gallery">
            {project.gallery.map((g, i) => (
              <figure key={g.caption}>
                <div className="shot">
                  {g.src ? (
                    <img
                      src={g.src}
                      alt={g.caption}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <Thumb
                      seed={`${project.slug}-${i}`}
                      accent={project.accent}
                      label={g.caption}
                      variant="shot"
                    />
                  )}
                </div>
                <figcaption>{g.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      <nav className="pager" aria-label="Project navigation">
        {prev && (
          <Link to={`/projects/${prev.slug}`}>
            <small>← Previous</small>
            <strong>{prev.title}</strong>
          </Link>
        )}
        {next && (
          <Link to={`/projects/${next.slug}`}>
            <small>Next →</small>
            <strong>{next.title}</strong>
          </Link>
        )}
      </nav>
    </div>
  )
}
