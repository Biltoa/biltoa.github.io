import { profile } from '../../data/profile'
import { bookGames, bookTools, type BookGame, type BookTool } from '../../data/book'

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
  /**
   * A labelled fact.
   *
   * `value` is wrapped to the column. `lines` overrides that with an explicit
   * set of lines — used where the copy is a dotted list and a wrap would put a
   * separator at the start or the end of a line, which reads as a typo rather
   * than as a list.
   */
  | { k: 'fact'; label: string; value: string; lines?: string[] }
  | { k: 'link'; text: string; to: string }
  /**
   * A row of links set two to a line.
   *
   * A title on four storefronts is four `link` lines, which is 216 page-pixels
   * of margin arrows down a page that also has to carry a title, a plate and a
   * paragraph — and the fourth store fell off the bottom. Set in pairs it is
   * half that, and a store list is a list rather than prose, so pairs read
   * fine.
   */
  | { k: 'links'; items: { text: string; to: string }[] }
  | { k: 'rule' }
  | { k: 'gap'; h: number }
  /**
   * A print pasted onto the page.
   *
   * `h` is the height of the plate in page pixels; the width is the text
   * column. `fit: 'contain'` letterboxes inside that plate, which is what a
   * square store icon or a tall editor window wants; `'cover'` fills it and
   * crops, which is what a wide screenshot wants.
   */
  | {
      k: 'image'
      src: string
      h: number
      caption?: string
      fit?: 'contain' | 'cover'
      /** Makes the plate a link. Same targets a `link` line takes. */
      to?: string
      /**
       * Drawn over the print once it has landed.
       *
       * `'play'` puts a lit play button and a "click to play" tab on the
       * picture, because a screenshot that happens to be a button looks
       * exactly like a screenshot that is not.
       */
      overlay?: 'play'
      /**
       * Full-resolution version, shown when the plate is pressed to look
       * closer. The printed plate is a crop sized for paper; this is the file
       * it was cropped from.
       */
      zoom?: string
    }
  /**
   * A handful of prints thrown down together and taped to the sheet.
   *
   * Where `image` is a plate ruled into the page, this is the loose stack a
   * notebook actually collects: each one tilted a degree or two, overlapping
   * its neighbour, held on with a strip of tape. `h` is the height of the
   * whole cluster in page pixels.
   */
  | { k: 'snaps'; srcs: string[]; h: number }
  /** A metric with its before and after, drawn as a small paper bar chart. */
  | { k: 'delta'; label: string; before: string; after: string; ratio: number }

export interface Spread {
  left: Line[]
  right: Line[]
}


/** The skill groups the trade page carries. */
const CORE_SKILLS = profile.skills

/**
 * How each skill group is broken across the page.
 *
 * Keyed by group name; a group with no entry falls back to the wrapped
 * `value`. Three to four lines each, related items kept together, and no line
 * begins or ends on a separator.
 */
const SKILL_LINES: Record<string, string[]> = {
  'Gameplay Programming': [
    'C# · Unity · Character & vehicle controllers',
    'Finite state machines · NPC behaviour',
    'Grid-based building · Inventory & progression',
    'JSON serialization',
  ],
  'Tools & Editor Scripting': [
    'Unity editor extensions · Asset import automation',
    'Multi-platform build pipelines · Pre-build validation',
    'LODs & impostors · Mesh & material combining',
    'Texture atlas generation',
  ],
  'Performance & Rendering': [
    'Unity Profiler · Frame Debugger · URP · Shader Graph',
    'GPU instancing · Occlusion culling · Draw call reduction',
    'Object pooling · Light baking · Addressables',
    'Jobs System · Burst',
  ],
  'Platforms & Workflow': [
    'iOS · Android · Steam · PS4 / PS5',
    'App Store & Google Play submission',
    'PlasticSCM · Git · Jira · Blender · Agile / Scrum',
    'Firebase · GameAnalytics · AdMob · AppLovin',
  ],
}

const ABOUT: Spread[] = [
  {
    left: [
      { k: 'kicker', text: 'The camp journal' },
      { k: 'title', text: profile.name },
      { k: 'rule' },
      { k: 'para', text: profile.tagline },
      { k: 'gap', h: 10 },
      ...profile.summary.map<Line>((text) => ({ k: 'para', text })),
    ],
    right: [
      { k: 'kicker', text: 'At a glance' },
      { k: 'gap', h: 6 },
      { k: 'fact', label: 'Based in', value: profile.location },
      { k: 'fact', label: 'Focus', value: 'Gameplay systems · Unity editor tools' },
      { k: 'fact', label: 'Platforms', value: profile.platforms.join(' · ') },
      { k: 'fact', label: 'Currently', value: 'Pursuing independent projects' },
      { k: 'gap', h: 14 },
      { k: 'rule' },
      { k: 'fact', label: 'Downloads', value: '200,000+ solo · 10M+ studio' },
      { k: 'fact', label: 'Titles shipped', value: '3 solo titles, 7 studio titles' },
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
      ...profile.whatIBuild.map<Line>((text) => ({ k: 'para', text })),
    ],
    right: [
      { k: 'kicker', text: 'Where I have worked' },
      { k: 'gap', h: 8 },
      ...profile.experience.flatMap<Line>((job) => [
        { k: 'fact', label: job.period, value: `${job.company}, ${job.role}` },
      ]),
      { k: 'gap', h: 16 },
      { k: 'rule' },
      { k: 'kicker', text: 'Studied' },
      ...profile.education.map<Line>((e) => ({
        k: 'fact',
        label: e.period,
        value: e.school,
      })),
    ],
  },
  {
    left: [
      { k: 'kicker', text: 'Chapter three' },
      { k: 'title', text: 'Tools of the trade' },
      { k: 'rule' },
      // Four groups is what a page of paper holds under a title.
      //
      // Broken by hand rather than wrapped. Joined into one string and left to
      // the wrapper, the column break landed wherever it landed — which on a
      // dotted list means lines that open or close on a separator, and a line
      // ending in a lone centred dot reads as a mistake. `SKILL_LINES` keeps
      // closely related items together on a line and never lets a dot sit at
      // either end of one.
      ...CORE_SKILLS.map<Line>((g) => ({
        k: 'fact',
        label: g.group,
        value: g.items.join(' · '),
        lines: SKILL_LINES[g.group],
      })),
    ],
    right: [
      // A kicker sits on its baseline, so it climbs into whatever is above it
      // unless something makes room first.
      { k: 'gap', h: 8 },
      { k: 'kicker', text: 'Away from the desk' },
      { k: 'gap', h: 8 },
      // One title a line. Set as a dotted run it filled three lines and left
      // the bottom half of the page empty, and a thirteen-item list run
      // together is not something anyone reads.
      {
        k: 'fact',
        label: 'Playing',
        value: profile.offDuty.games.join(' · '),
        lines: [...profile.offDuty.games],
      },
      { k: 'gap', h: 6 },
      { k: 'fact', label: 'Outdoors', value: profile.offDuty.outdoors.join(' · ') },
    ],
  },
]

/* ------------------------------------------------------------------------- */
/*  The gameplay journal.                                                      */
/*                                                                             */
/*  About the build that is sitting one click away, not about WebGL in the      */
/*  abstract. The pictures are frames off that same build running in a browser, */
/*  and the control list is the one the build itself                             */
/*  prints on its opening card — which is not the one this chapter used to      */
/*  claim.                                                                     */
/* ------------------------------------------------------------------------- */

const GAMEPLAY: Spread[] = [
  {
    left: [
      { k: 'kicker', text: 'Field notes' },
      { k: 'title', text: 'Drift Controller' },
      { k: 'rule' },
      {
        k: 'para',
        text: 'A custom drift controller built from scratch for responsive, controllable slides, grip curves, weight transfer, and a camera that stays readable while the car is sideways.',
      },
      { k: 'gap', h: 16 },
      // Frames off the scene itself, taped in the way notes actually collect
      // pictures. The cluster is sized to stop well above the corner control —
      // a print over the "Back" plate is a print you cannot press past.
      {
        k: 'snaps',
        srcs: [
          '/media/build/snap-1.webp',
          '/media/build/snap-2.webp',
          '/media/build/snap-3.webp',
        ],
        h: 560,
      },
    ],
    right: [
      { k: 'gap', h: 4 },
      { k: 'kicker', text: 'The build' },
      { k: 'gap', h: 6 },
      // The picture is the button. `play:` is handled in the page itself, so
      // the build opens out of this plate rather than replacing the scene.
      {
        k: 'image',
        src: '/media/build/straight.webp',
        h: 420,
        fit: 'cover',
        to: 'play:gameplay',
        overlay: 'play',
        caption: 'Click the picture to play it here, in the browser.',
      },
      { k: 'gap', h: 14 },
      { k: 'rule' },
      { k: 'fact', label: 'Engine', value: 'Unity 6, URP' },
      { k: 'fact', label: 'Build', value: 'WebGL. Streams once, then caches' },
    ],
  },
]

/* ------------------------------------------------------------------------- */
/*  The projects journal.                                                      */
/*                                                                             */
/*  Built rather than written out, because the contents page has to name the    */
/*  leaf each chapter is bound on and that number is only known once the book   */
/*  has been laid out. The builder collects the spreads and the indices in one  */
/*  pass, then the contents page is pushed onto the front.                      */
/* ------------------------------------------------------------------------- */

/**
 * The left page of a title: the store art, what the game is, where it lives.
 *
 * Every title gets this — the studio work used to be crammed onto a single
 * shared page, which meant the seven of them said less between them than any
 * one of the three solo releases did.
 */
function gamePage(g: BookGame): Line[] {
  return [
    { k: 'kicker', text: g.developer },
    { k: 'title', text: g.title },
    { k: 'rule' },
    // The plate gives way to the store list rather than the other way round:
    // four storefronts is 216 page-pixels of links, and a page that keeps its
    // picture at full height instead drops the last two of them off the
    // bottom margin.
    { k: 'image', src: g.art, h: g.links.length > 2 ? 280 : 330, fit: 'cover', zoom: g.art },
    { k: 'para', text: g.description },
    { k: 'gap', h: 30 },
    { k: 'kicker', text: 'Where to find it' },
    { k: 'gap', h: 2 },
    { k: 'links', items: g.links.map((l) => ({ text: l.label, to: l.href })) },
  ]
}

/** The facing page: the long version, then what the work actually was. */
function gameDetail(g: BookGame): Line[] {
  return [
    { k: 'kicker', text: 'What it took' },
    { k: 'gap', h: 4 },
    { k: 'para', text: g.body },
    // No rule between the two halves. A kicker is drawn on its baseline, so it
    // needs headroom of its own, and a rule plus that headroom is sixty page
    // pixels — which on the longest of these pages is the last bullet.
    { k: 'gap', h: 28 },
    { k: 'kicker', text: 'What I built' },
    { k: 'gap', h: 2 },
    ...g.did.map<Line>((d) => ({ k: 'bullet', text: d })),
  ]
}

/** The left page of a tool chapter: what it does and why the numbers moved. */
function toolPage(t: BookTool): Line[] {
  return [
    { k: 'kicker', text: 'Editor tooling' },
    { k: 'title', text: t.name },
    { k: 'rule' },
    { k: 'para', text: t.tagline },
    { k: 'gap', h: 8 },
    ...t.what.map<Line>((w) => ({ k: 'bullet', text: w })),
    { k: 'gap', h: 6 },
    { k: 'rule' },
    { k: 'para', text: t.how },
  ]
}

/** The right page: the window itself, then what it bought. */
function toolResult(t: BookTool): Line[] {
  return [
    { k: 'kicker', text: 'In the editor' },
    { k: 'gap', h: 4 },
    {
      k: 'image',
      src: t.shot,
      h: 340,
      fit: 'contain',
      caption: t.shotCaption,
      // Pressing the plate opens the uncropped capture, which is the one you
      // can actually read the window in.
      zoom: `/media/tools/${t.slug}.webp`,
    },
    // A kicker is drawn on its baseline, so it climbs into whatever is above
    // it unless something makes room first.
    { k: 'gap', h: 26 },
    { k: 'kicker', text: 'Before and after' },
    { k: 'gap', h: 8 },
    ...t.deltas.map<Line>((d) => ({
      k: 'delta',
      label: d.label,
      before: d.before,
      after: d.after,
      ratio: d.ratio,
    })),
    { k: 'gap', h: 6 },
    { k: 'para', text: t.note },
  ]
}

function buildProjects() {
  const spreads: Spread[] = []
  /** Spread index each chapter opens on, keyed by slug. */
  const at: Record<string, number> = {}

  // Every title gets a spread: the store art and what the game is on the left,
  // the long version and what the work was on the right. Solo releases lead,
  // then the studio work, which is the order the contents page lists them in.
  for (const g of [
    ...bookGames.filter((x) => x.tier === 'solo'),
    ...bookGames.filter((x) => x.tier === 'studio'),
  ]) {
    at[g.slug] = spreads.length + 1 // +1 for the contents page pushed on later
    spreads.push({ left: gamePage(g), right: gameDetail(g) })
  }

  for (const t of bookTools) {
    at[t.slug] = spreads.length + 1
    spreads.push({ left: toolPage(t), right: toolResult(t) })
  }

  const contents: Spread = {
    left: [
      { k: 'kicker', text: 'The ledger' },
      { k: 'title', text: 'Contents' },
      { k: 'rule' },
      { k: 'kicker', text: 'One. Games' },
      { k: 'gap', h: 4 },
      ...bookGames.map<Line>((g) => ({ k: 'link', text: g.title, to: `book:${at[g.slug]}` })),
    ],
    right: [
      { k: 'kicker', text: 'Two. Editor tools' },
      { k: 'gap', h: 4 },
      ...bookTools.map<Line>((t) => ({ k: 'link', text: t.name, to: `book:${at[t.slug]}` })),
      { k: 'gap', h: 10 },
      { k: 'rule' },
      {
        k: 'para',
        text: 'Press a title to turn straight to it, or take the corner and read the book the way it is bound.',
      },
    ],
  }

  return [contents, ...spreads]
}

const PROJECTS: Spread[] = buildProjects()

const BOOKS = [ABOUT, GAMEPLAY, PROJECTS]

export const bookSpreads = (index: number): Spread[] => BOOKS[index] ?? ABOUT

/** Shown on the closed cover. */
export const BOOK_TITLE = ['About', 'Gameplay', 'Projects']

/** Individual collection line stamped above each closed-cover title. */
export const BOOK_COVER_SUBTITLE = [
  'THE STORY SO FAR',
  'THE CRAFT OF GAME FEEL',
  'IDEAS MADE REAL',
]
