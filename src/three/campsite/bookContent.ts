import { profile } from '../../data/profile'
import { projects } from '../../data/projects'

/* -------------------------------------------------------------------------- */
/*  What is written in each tent's journal.                                     */
/*                                                                              */
/*  Everything here is drawn onto the page textures, so it is a flat list of     */
/*  typographic instructions rather than markup — the painter walks it once and  */
/*  reports back where the links landed.                                        */
/* -------------------------------------------------------------------------- */

export type Line =
  | { k: 'title'; text: string }
  | { k: 'kicker'; text: string }
  | { k: 'para'; text: string }
  | { k: 'bullet'; text: string }
  | { k: 'fact'; label: string; value: string }
  | { k: 'link'; text: string; to: string }
  | { k: 'rule' }
  | { k: 'gap'; h: number }

export interface Spread {
  left: Line[]
  right: Line[]
}

const game = projects.filter((p) => p.type === 'game')
const tools = projects.filter((p) => p.type === 'tool')

const ABOUT: Spread[] = [
  {
    left: [
      { k: 'kicker', text: 'The camp journal' },
      { k: 'title', text: profile.name },
      { k: 'rule' },
      { k: 'para', text: profile.tagline },
      { k: 'gap', h: 10 },
      { k: 'para', text: profile.summary[0] },
    ],
    right: [
      { k: 'kicker', text: 'At a glance' },
      { k: 'gap', h: 6 },
      { k: 'fact', label: 'Based in', value: profile.location },
      { k: 'fact', label: 'Focus', value: 'Gameplay systems · Unity tooling' },
      { k: 'fact', label: 'Engine', value: 'Unity 3D (C#), URP' },
      { k: 'fact', label: 'Platforms', value: profile.platforms.join(' · ') },
      { k: 'fact', label: 'Currently', value: 'Unity Developer, Mad Hook' },
      { k: 'gap', h: 14 },
      { k: 'rule' },
      { k: 'fact', label: 'Downloads', value: '100,000+ solo' },
      { k: 'fact', label: 'Studio titles', value: '5 shipped' },
      { k: 'fact', label: 'Android CPI', value: '$0.0019' },
      { k: 'gap', h: 18 },
      { k: 'link', text: profile.email, to: `mailto:${profile.email}` },
      { k: 'link', text: 'Read the résumé', to: profile.resumeUrl },
    ],
  },
  {
    left: [
      { k: 'kicker', text: 'Chapter two' },
      { k: 'title', text: 'What I build' },
      { k: 'rule' },
      { k: 'para', text: profile.summary[1] },
    ],
    right: [
      { k: 'kicker', text: 'Where I have worked' },
      { k: 'gap', h: 8 },
      ...profile.experience.flatMap<Line>((job) => [
        { k: 'fact', label: job.period.replace(' — ', '–'), value: `${job.company} — ${job.role}` },
      ]),
      { k: 'gap', h: 16 },
      { k: 'rule' },
      { k: 'kicker', text: 'Studied' },
      ...profile.education.map<Line>((e) => ({
        k: 'fact',
        label: e.period.replace(' — ', '–'),
        value: e.school,
      })),
    ],
  },
  {
    left: [
      { k: 'kicker', text: 'Chapter three' },
      { k: 'title', text: 'On my own' },
      { k: 'rule' },
      { k: 'para', text: profile.summary[2] },
    ],
    right: [
      { k: 'kicker', text: 'Tools of the trade' },
      { k: 'gap', h: 8 },
      ...profile.skills.map<Line>((g) => ({
        k: 'fact',
        label: g.group,
        value: g.items.join(' · '),
      })),
      { k: 'gap', h: 18 },
      { k: 'link', text: 'See the work', to: '/projects' },
    ],
  },
]

const GAMEPLAY: Spread[] = [
  {
    left: [
      { k: 'kicker', text: 'Field notes' },
      { k: 'title', text: 'Playable build' },
      { k: 'rule' },
      {
        k: 'para',
        text: 'A Unity WebGL build runs in the browser — no download, no install. It streams on demand, so the page stays light until you ask for it.',
      },
      { k: 'gap', h: 10 },
      {
        k: 'para',
        text: 'The same gameplay code ships to iOS, Android, Steam and PlayStation. What runs here is the desktop control scheme.',
      },
    ],
    right: [
      { k: 'kicker', text: 'Controls' },
      { k: 'gap', h: 6 },
      { k: 'fact', label: 'W A S D', value: 'Drive' },
      { k: 'fact', label: 'Space', value: 'Handbrake' },
      { k: 'fact', label: 'Shift', value: 'Boost' },
      { k: 'fact', label: 'C', value: 'Change camera' },
      { k: 'fact', label: 'Esc', value: 'Release the cursor' },
      { k: 'gap', h: 18 },
      { k: 'rule' },
      { k: 'fact', label: 'Engine', value: 'Unity 3D, URP' },
      { k: 'fact', label: 'Target', value: '60 fps, mid-range laptop' },
      { k: 'gap', h: 18 },
      { k: 'link', text: 'Open the player', to: '/gameplay' },
    ],
  },
  {
    left: [
      { k: 'kicker', text: 'Under the hood' },
      { k: 'title', text: 'How it holds up' },
      { k: 'rule' },
      { k: 'bullet', text: 'Object pooling for every spawned actor and effect.' },
      { k: 'bullet', text: 'GPU instancing and atlased materials to keep draw calls flat.' },
      { k: 'bullet', text: 'Occlusion culling and LODs profiled against a frame budget.' },
      { k: 'bullet', text: 'Baked lighting where it is static, real-time only where it moves.' },
      { k: 'bullet', text: 'Texture atlasing and draw-call batching, measured with the profiler rather than guessed at.' },
      { k: 'gap', h: 10 },
      { k: 'rule' },
      { k: 'fact', label: 'Shipped to', value: 'iOS · Android · Steam · PS4 / PS5' },
    ],
    right: [
      { k: 'kicker', text: 'Also shipped' },
      { k: 'gap', h: 6 },
      ...game.slice(0, 5).map<Line>((p) => ({ k: 'link', text: p.title, to: `/projects/${p.slug}` })),
      { k: 'gap', h: 14 },
      { k: 'rule' },
      {
        k: 'para',
        text: 'Multiplayer runs on Photon PUN2; telemetry and attribution through GameAnalytics, Firebase and the Facebook SDK.',
      },
      { k: 'gap', h: 8 },
      { k: 'fact', label: 'Live players', value: '30,000 monthly' },
    ],
  },
]

const PROJECTS: Spread[] = [
  {
    left: [
      { k: 'kicker', text: 'The ledger' },
      { k: 'title', text: 'Shipped games' },
      { k: 'rule' },
      ...game.map<Line>((p) => ({ k: 'link', text: `${p.title}  ·  ${p.year}`, to: `/projects/${p.slug}` })),
      { k: 'gap', h: 12 },
      {
        k: 'para',
        text: 'Mobile, Steam and PlayStation. Core mechanics, live-ops, store submission and the deployment pipeline around them.',
      },
      { k: 'gap', h: 8 },
      { k: 'rule' },
      { k: 'fact', label: 'Platforms', value: profile.platforms.join(' · ') },
      { k: 'fact', label: 'Reach', value: '100,000+ downloads · 30K monthly players' },
    ],
    right: [
      { k: 'kicker', text: 'Editor tooling' },
      { k: 'gap', h: 6 },
      ...tools.map<Line>((p) => ({ k: 'link', text: p.title, to: `/projects/${p.slug}` })),
      { k: 'gap', h: 10 },
      {
        k: 'para',
        text: 'Windows, validators and build automation that turn a manual half-day into a one-click pass.',
      },
      { k: 'gap', h: 10 },
      { k: 'rule' },
      { k: 'fact', label: 'Built with', value: 'C# · UnityEditor · IMGUI + UI Toolkit' },
      { k: 'gap', h: 12 },
      { k: 'link', text: 'Browse everything', to: '/projects' },
    ],
  },
]

const BOOKS = [ABOUT, GAMEPLAY, PROJECTS]

export const bookSpreads = (index: number): Spread[] => BOOKS[index] ?? ABOUT

/** Shown on the closed cover. */
export const BOOK_TITLE = ['About', 'Gameplay', 'Projects']
