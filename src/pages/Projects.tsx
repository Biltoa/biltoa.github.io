import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { allPlatforms, allTags, projects, type Project, type ProjectType } from '../data/projects'
import Thumb from '../components/Thumb'
import { useDebounced } from '../lib/hooks'

type Sort = 'newest' | 'oldest' | 'az' | 'za'

const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'az', label: 'Title A–Z' },
  { value: 'za', label: 'Title Z–A' },
]

/** Tags shown before the "more tags" toggle — the full list is a wall. */
const TAG_PREVIEW = 12

/** Everything a card can be matched against, flattened once per project. */
function haystack(p: Project) {
  return [
    p.title,
    p.subtitle,
    p.blurb,
    p.role,
    p.engine,
    p.status,
    ...p.tags,
    ...p.platforms,
    ...p.tech,
  ]
    .join(' ')
    .toLowerCase()
}

/** Text colour that stays legible on each accent, in both themes. */
const ACCENT_FG: Record<Project['accent'], string> = {
  red: '#ffffff',
  blue: '#ffffff',
  yellow: '#14161a',
  ink: 'var(--paper)',
}

function ProjectCard({ p }: { p: Project }) {
  const accentVar = `var(--${p.accent === 'ink' ? 'ink' : p.accent})`

  return (
    <Link
      to={`/projects/${p.slug}`}
      className="card"
      style={{
        ['--card-accent' as string]: accentVar,
        ['--card-accent-fg' as string]: ACCENT_FG[p.accent],
      }}
    >
      <div className="card__media">
        {p.thumb ? (
          <img src={p.thumb} alt="" loading="lazy" />
        ) : (
          <Thumb seed={p.slug} accent={p.accent} label={p.title} />
        )}
        <span className="card__type">{p.type}</span>
        <span className="card__status">{p.status}</span>
        <span className="card__play" aria-hidden="true">
          <svg width="11" height="12" viewBox="0 0 11 12" fill="currentColor">
            <path d="M0 0l11 6-11 6z" />
          </svg>
        </span>
        {p.clip && <span className="card__clip">{p.clip}</span>}
      </div>

      <div className="card__body">
        <h3 className="card__title">{p.title}</h3>
        <p className="card__sub">{p.subtitle}</p>
        <p className="card__blurb">{p.blurb}</p>

        <div className="card__foot">
          <div className="card__tags">
            {p.tags.slice(0, 3).map((t) => (
              <span className="card__tag" key={t}>
                {t}
              </span>
            ))}
          </div>
          <span className="card__year">{p.year}</span>
        </div>
      </div>
    </Link>
  )
}

export default function Projects() {
  const [params, setParams] = useSearchParams()
  const searchRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState(params.get('q') ?? '')
  const [showAllTags, setShowAllTags] = useState(false)
  const debounced = useDebounced(query, 130)

  const type = (params.get('type') as ProjectType | 'all') || 'all'
  const sort = (params.get('sort') as Sort) || 'newest'
  const platform = params.get('platform') ?? 'all'
  const activeTags = useMemo(
    () => (params.get('tags') ? params.get('tags')!.split(',').filter(Boolean) : []),
    [params]
  )

  // Collapsed by default, but an active tag is always visible so a filter can
  // never hide behind the toggle.
  const visibleTags = useMemo(() => {
    if (showAllTags) return allTags
    const head = allTags.slice(0, TAG_PREVIEW)
    return [...head, ...activeTags.filter((t) => !head.includes(t))]
  }, [showAllTags, activeTags])

  // Keep the URL shareable: every filter round-trips through the query string.
  const patch = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (!value || value === 'all' || value === '') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  useEffect(() => {
    patch('q', debounced || null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  // "/" focuses search, Escape clears it. Cheap, and reviewers use it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
      }
      if (e.key === 'Escape' && typing) {
        setQuery('')
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleTag = (tag: string) => {
    const next = activeTags.includes(tag)
      ? activeTags.filter((t) => t !== tag)
      : [...activeTags, tag]
    patch('tags', next.join(','))
  }

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    let out = projects.filter((p) => {
      if (type !== 'all' && p.type !== type) return false
      if (platform !== 'all' && !p.platforms.includes(platform)) return false
      if (activeTags.length && !activeTags.every((t) => p.tags.includes(t))) return false
      if (q && !haystack(p).includes(q)) return false
      return true
    })

    out = [...out].sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return a.year - b.year || a.title.localeCompare(b.title)
        case 'az':
          return a.title.localeCompare(b.title)
        case 'za':
          return b.title.localeCompare(a.title)
        default:
          return b.year - a.year || a.title.localeCompare(b.title)
      }
    })
    return out
  }, [debounced, type, platform, activeTags, sort])

  const counts = useMemo(
    () => ({
      all: projects.length,
      game: projects.filter((p) => p.type === 'game').length,
      tool: projects.filter((p) => p.type === 'tool').length,
    }),
    []
  )

  const hasFilters = Boolean(query || type !== 'all' || platform !== 'all' || activeTags.length)

  const clearAll = () => {
    setQuery('')
    setParams(new URLSearchParams(), { replace: true })
  }

  return (
    <div className="page">
      <div className="wrap page-head">
        <p className="eyebrow">Work</p>
        <h1 className="display" style={{ marginTop: 22 }}>
          Projects
          <br />& Tools
        </h1>
        <p>
          Shipped titles and the editor tooling built around them. Games are the visible half; the
          tools are the reason the games shipped on time.
        </p>
      </div>

      <div className="toolbar">
        <div className="wrap">
          <div className="toolbar__inner">
            <div className="search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.6-3.6" />
              </svg>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title, tech, platform…"
                aria-label="Search projects"
              />
              {!query && <kbd>/</kbd>}
            </div>

            <div className="segmented" role="group" aria-label="Filter by type">
              {(['all', 'game', 'tool'] as const).map((t) => (
                <button
                  key={t}
                  className={type === t ? 'is-active' : ''}
                  onClick={() => patch('type', t)}
                  aria-pressed={type === t}
                >
                  {t} ({counts[t]})
                </button>
              ))}
            </div>

            <div className="select">
              <select
                value={platform}
                onChange={(e) => patch('platform', e.target.value)}
                aria-label="Filter by platform"
              >
                <option value="all">All platforms</option>
                {allPlatforms.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="select">
              <select value={sort} onChange={(e) => patch('sort', e.target.value)} aria-label="Sort">
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="tagbar">
            {visibleTags.map((t) => (
              <button
                key={t}
                className={activeTags.includes(t) ? 'is-active' : ''}
                onClick={() => toggleTag(t)}
                aria-pressed={activeTags.includes(t)}
              >
                {t}
              </button>
            ))}
            {allTags.length > TAG_PREVIEW && (
              <button
                onClick={() => setShowAllTags((s) => !s)}
                style={{ borderStyle: 'dashed', color: 'var(--ink-2)' }}
              >
                {showAllTags ? '− Fewer tags' : `+ ${allTags.length - TAG_PREVIEW} more tags`}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="wrap">
        <div className="results">
          <span>
            {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
            {activeTags.length > 0 && ` · ${activeTags.length} tag filter${activeTags.length > 1 ? 's' : ''}`}
          </span>
          {hasFilters && (
            <button onClick={clearAll} style={{ borderBottom: '1px solid var(--line)' }}>
              Clear all ✕
            </button>
          )}
        </div>

        <div className="grid">
          {filtered.map((p) => (
            <ProjectCard key={p.slug} p={p} />
          ))}

          {filtered.length === 0 && (
            <div className="empty">
              <b>Nothing matches that</b>
              <p style={{ margin: 0 }}>Try a broader search, or clear the filters.</p>
              <button className="btn" style={{ marginTop: 20 }} onClick={clearAll}>
                Reset filters
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
