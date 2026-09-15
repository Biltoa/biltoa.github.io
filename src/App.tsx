import { useEffect, useLayoutEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import BackToFire from './components/BackToFire'
import Footer from './components/Footer'
import SeoMetadata from './components/SeoMetadata'
import About from './pages/About'
import ProjectDetail from './pages/ProjectDetail'
import {
  resumeAudio,
  resumeInteractionAudio,
  sfxUiClick,
  sfxUiHover,
  suspendAudio,
} from './lib/audio'
import { MOBILE_EXPERIENCE } from './lib/graphics'

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

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = 'light'
    document.documentElement.dataset.mobile = String(MOBILE_EXPERIENCE)
  }, [])

  useEffect(() => {
    const selector = 'button:not(:disabled), a[href], [role="button"]:not([aria-disabled="true"])'
    const targetFor = (target: EventTarget | null) =>
      target instanceof Element ? (target.closest(selector) as HTMLElement | null) : null

    // Safari will not allow audio before the first real gesture. The landing
    // page unlocks the complete camp mix; written pages unlock UI sounds only.
    const unlock = () => (landing ? resumeAudio() : resumeInteractionAudio())
    const hover = (event: PointerEvent) => {
      const target = targetFor(event.target)
      if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return
      sfxUiHover()
    }
    const click = (event: MouseEvent) => {
      // Treat the click itself as a second unlock opportunity. On iOS a
      // pointerdown resume can remain pending; the subsequent trusted click is
      // often the event that is allowed to open the audio output.
      unlock()
      const target = targetFor(event.target)
      if (!target) return
      const kind = target.dataset.sfx
      sfxUiClick(
        kind === 'toggle' || kind === 'fullscreen' || kind === 'back' ? kind : 'click'
      )
    }
    const suspendIfHidden = () => {
      if (document.visibilityState !== 'visible') suspendAudio()
    }

    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    if (MOBILE_EXPERIENCE) {
      window.addEventListener('blur', suspendAudio)
      window.addEventListener('pagehide', suspendAudio)
      document.addEventListener('visibilitychange', suspendIfHidden)
    }
    document.addEventListener('pointerover', hover)
    document.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
      if (MOBILE_EXPERIENCE) {
        window.removeEventListener('blur', suspendAudio)
        window.removeEventListener('pagehide', suspendAudio)
        document.removeEventListener('visibilitychange', suspendIfHidden)
      }
      document.removeEventListener('pointerover', hover)
      document.removeEventListener('click', click, true)
    }
  }, [landing])

  // The camp is warm paper; the written-out work is a dark reading surface set
  // in a single face. They are different rooms, so the switch is on the root
  // element rather than on a wrapper — the footer and the way back to the fire
  // sit outside the page and have to change with it.
  useLayoutEffect(() => {
    document.documentElement.dataset.surface = landing ? 'camp' : 'work'
    if (MOBILE_EXPERIENCE) {
      const mobileTheme = document.querySelector<HTMLMetaElement>('#mobile-theme-color')
      mobileTheme?.setAttribute('content', landing ? '#070914' : '#EFE9DF')
    }
  }, [landing])

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SeoMetadata />
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
