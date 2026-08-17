import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Nav from './components/Nav'
import Footer from './components/Footer'
import About from './pages/About'
import Gameplay from './pages/Gameplay'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])
  return null
}

export default function App() {
  const { pathname } = useLocation()
  // The landing page is the campsite; a floating navbar over it fights the
  // scene, and the tents are the navigation. Inner pages keep the bar so they
  // are not a dead end.
  const landing = pathname === '/'

  useEffect(() => {
    document.documentElement.dataset.theme = 'light'
  }, [])

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {!landing && <Nav />}
      <ScrollToTop />

      <main>
        <Routes>
          <Route path="/" element={<About />} />
          <Route path="/gameplay" element={<Gameplay />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:slug" element={<ProjectDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {!landing && <Footer />}
    </>
  )
}
