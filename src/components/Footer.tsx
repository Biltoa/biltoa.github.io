import { profile } from '../data/profile'

/**
 * The colophon line, and nothing else.
 *
 * The old footer carried a contact call-to-action and two link columns, all of
 * which repeated what the camp already says better — and one of those columns
 * pointed at pages that no longer exist.
 */
export default function Footer() {
  return (
    <footer className="footer footer--slim">
      <div className="wrap">
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
