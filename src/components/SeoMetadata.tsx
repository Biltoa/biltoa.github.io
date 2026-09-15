import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { getProject } from '../data/projects'
import {
  HOME_DESCRIPTION,
  HOME_IMAGE,
  HOME_TITLE,
  SITE_ORIGIN,
  absoluteSiteUrl,
  homeStructuredData,
  projectDescription,
  projectStructuredData,
} from '../data/seo'

function setContent(selector: string, content: string) {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', content)
}

/** Keeps head metadata correct after client-side navigation between projects. */
export default function SeoMetadata() {
  const { pathname } = useLocation()

  useEffect(() => {
    const slug = pathname.match(/^\/projects\/([^/]+)\/?$/)?.[1]
    const project = slug ? getProject(decodeURIComponent(slug)) : undefined
    const isProject = Boolean(project)
    const title = project ? `${project.title} | Ahmad Bilto` : HOME_TITLE
    const description = project ? projectDescription(project) : HOME_DESCRIPTION
    const canonical = project ? `${SITE_ORIGIN}/projects/${project.slug}/` : `${SITE_ORIGIN}/`
    const image = project ? absoluteSiteUrl(project.thumb ?? '/social-card.png') : HOME_IMAGE
    const imageAlt = project ? `${project.title} by Ahmad Bilto` : 'Ahmad Bilto, Unity Gameplay and Tools Developer'

    document.title = title
    document.querySelector<HTMLLinkElement>('#canonical-link')?.setAttribute('href', canonical)
    setContent('#meta-description', description)
    setContent('#og-title', title)
    setContent('#og-description', description)
    setContent('#og-type', isProject ? 'article' : 'profile')
    setContent('#og-url', canonical)
    setContent('#og-image', image)
    setContent('#og-image-alt', imageAlt)
    setContent('#twitter-title', title)
    setContent('#twitter-description', description)
    setContent('#twitter-image', image)

    const structuredData = document.querySelector<HTMLScriptElement>('#structured-data')
    if (structuredData) {
      structuredData.textContent = JSON.stringify(
        project ? projectStructuredData(project) : homeStructuredData(),
      )
    }
  }, [pathname])

  return null
}
