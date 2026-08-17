import { Link } from 'react-router-dom'
import { profile } from '../data/profile'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer__inner">
          <div className="footer__cta">
            <h2>
              Building something
              <br />
              that needs to feel right?
            </h2>
            <p className="muted" style={{ maxWidth: '46ch', margin: '0 0 18px' }}>
              Open to gameplay and tools work — studio or contract. Fastest way to reach me is
              email.
            </p>
            <a className="btn btn--solid" href={`mailto:${profile.email}`}>
              {profile.email}
            </a>
          </div>

          <div className="footer__links">
            <span className="muted">Elsewhere</span>
            <a href={profile.linkedin} target="_blank" rel="noreferrer noopener">
              LinkedIn ↗
            </a>
            <a href={profile.resumeUrl} target="_blank" rel="noreferrer noopener">
              Résumé (PDF) ↗
            </a>
            <a href={`https://${profile.site}`} target="_blank" rel="noreferrer noopener">
              {profile.site} ↗
            </a>
          </div>

          <div className="footer__links">
            <span className="muted">Pages</span>
            <Link to="/">About</Link>
            <Link to="/gameplay">Gameplay</Link>
            <Link to="/projects">Projects</Link>
          </div>
        </div>

        <div className="footer__base">
          <span>
            {profile.name} — {profile.role}
          </span>
          <span>{profile.location}</span>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </div>
    </footer>
  )
}
