import { NavLink } from 'react-router-dom'
import { useScrolled } from '../lib/hooks'
import { profile } from '../data/profile'

const links = [
  { to: '/', label: 'Camp', end: true },
  { to: '/gameplay', label: 'Gameplay', end: false },
  { to: '/projects', label: 'Projects', end: false },
]

/** Inner-page bar only — the landing page navigates through the tents. */
export default function Nav() {
  const scrolled = useScrolled(10)

  return (
    <header className="nav" data-scrolled={scrolled}>
      <div className="nav__inner">
        <NavLink to="/" className="nav__brand">
          <span className="nav__dot" aria-hidden="true" />
          <span>{profile.name}</span>
        </NavLink>

        <nav className="nav__links" aria-label="Primary">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  )
}
