import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import BackToFire from './components/BackToFire'
import Footer from './components/Footer'
import About from './pages/About'
import ProjectDetail from './pages/ProjectDetail'
import { resumeInteractionAudio, sfxUiClick, sfxUiHover } from './lib/audio'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])
  return null
}

export default function App() {
  const { pathname } = useLocation()
  // The landing page is the campsite, and the camp is the navigation. The flat
  // pages are the long version of what the journals say, so all they need is a
  // way back to the fire.
  const landing = pathname === '/'

  useEffect(() => {
    document.documentElement.dataset.theme = 'light'
  }, [])

  useEffect(() => {
    const selector = 'button:not(:disabled), a[href], [role="button"]:not([aria-disabled="true"])'
    const targetFor = (target: EventTarget | null) =>
      target instanceof Element ? (target.closest(selector) as HTMLElement | null) : null

    const unlock = () => resumeInteractionAudio()
    const hover = (event: PointerEvent) => {
      const target = targetFor(event.target)
      if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return
      sfxUiHover()
    }
    const click = (event: MouseEvent) => {
      const target = targetFor(event.target)
      if (!target) return
      const kind = target.dataset.sfx
      sfxUiClick(
        kind === 'toggle' || kind === 'fullscreen' || kind === 'back' ? kind : 'click'
      )
    }

    window.addEventListener('pointerdown', unlock, true)
    document.addEventListener('pointerover', hover)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('pointerdown', unlock, true)
      document.removeEventListener('pointerover', hover)
      document.removeEventListener('click', click, true)
    }
  }, [])

  // The camp is warm paper; the written-out work is a dark reading surface set
  // in a single face. They are different rooms, so the switch is on the root
  // element rather than on a wrapper — the footer and the way back to the fire
  // sit outside the page and have to change with it.
  useEffect(() => {
    document.documentElement.dataset.surface = landing ? 'camp' : 'work'
  }, [landing])

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {!landing && <BackToFire />}
      <ScrollToTop />

      <main>
        <Routes>
          <Route path="/" element={<About />} />
          <Route path="/projects/:slug" element={<ProjectDetail />} />
          {/* The gameplay page and the projects index are both gone: the build
              plays inside the journal and the journal *is* the index, so a
              second page listing the same work was a fork in the road with
              nothing at the end of it. Anything still pointing at either lands
              on the camp. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {!landing && <Footer />}
    </>
  )
}
