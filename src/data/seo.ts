import type { Project } from './projects'

export const SITE_ORIGIN = 'https://ahmadbilto.com'
export const HOME_TITLE = 'Ahmad Bilto | Unity Gameplay & Tools Developer'
export const HOME_DESCRIPTION =
  'Unity gameplay and tools developer with 10 shipped titles across mobile, Steam, and PlayStation. Creator of a multiplayer driving game with 200K+ downloads.'
export const HOME_IMAGE = `${SITE_ORIGIN}/social-card.png`

export function absoluteSiteUrl(path: string) {
  return new URL(path, SITE_ORIGIN).toString()
}

export function projectDescription(project: Project) {
  const description = `${project.subtitle}. ${project.blurb}`
  if (description.length <= 158) return description

  const shortened = description.slice(0, 155)
  const lastSpace = shortened.lastIndexOf(' ')
  return `${shortened.slice(0, lastSpace > 110 ? lastSpace : 155).replace(/[.,;:!?-]+$/, '')}…`
}

export function homeStructuredData() {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': `${SITE_ORIGIN}/#profile`,
    url: `${SITE_ORIGIN}/`,
    name: HOME_TITLE,
    description: HOME_DESCRIPTION,
    mainEntity: {
      '@type': 'Person',
      '@id': `${SITE_ORIGIN}/#ahmad-bilto`,
      name: 'Ahmad Bilto',
      url: `${SITE_ORIGIN}/`,
      jobTitle: 'Unity Gameplay & Tools Developer',
      homeLocation: {
        '@type': 'Place',
        name: 'Amman, Jordan',
      },
      sameAs: ['https://linkedin.com/in/ahmad-bilto', 'https://github.com/Biltoa'],
      knowsAbout: [
        'Unity',
        'C#',
        'Gameplay programming',
        'Unity editor tools',
        'Game performance optimization',
        'iOS games',
        'Android games',
        'Steam games',
        'PlayStation games',
      ],
    },
  }
}

export function projectStructuredData(project: Project) {
  const url = `${SITE_ORIGIN}/projects/${project.slug}/`
  return {
    '@context': 'https://schema.org',
    '@type': project.type === 'game' ? 'VideoGame' : 'CreativeWork',
    '@id': `${url}#project`,
    url,
    name: project.title,
    description: projectDescription(project),
    image: absoluteSiteUrl(project.thumb ?? '/social-card.png'),
    dateCreated: String(project.year),
    creator: {
      '@type': 'Person',
      '@id': `${SITE_ORIGIN}/#ahmad-bilto`,
      name: 'Ahmad Bilto',
    },
    ...(project.type === 'game'
      ? {
          gamePlatform: project.platforms,
          applicationCategory: 'Game',
          operatingSystem: project.platforms.join(', '),
        }
      : {}),
  }
}
