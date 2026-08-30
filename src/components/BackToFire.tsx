import { Link } from 'react-router-dom'

/**
 * The way back to the campsite from the flat pages.
 *
 * These pages used to sit under a navigation bar listing Camp, Gameplay and
 * Projects. There is only one flat page now and the camp is the front door, so
 * a bar of three links was two links of chrome around one exit — this is the
 * exit, and nothing else.
 */
export default function BackToFire() {
  return (
    <Link className="tofire" to="/">
      <span className="tofire__flame" aria-hidden="true" />
      Back to the fire
    </Link>
  )
}
