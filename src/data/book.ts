import { projects, type Project } from './projects'

/**
 * What the Projects journal in the camp contains.
 *
 * The facts — titles, store links, artwork, the tech stack — are read straight
 * out of `projects.ts` rather than restated here, because the first version of
 * this file kept its own copy and the site and the journal immediately
 * disagreed about which tools exist. What lives here is only what the book
 * needs and the HTML pages do not: how deep each chapter runs, a tagline short
 * enough for a page of paper, and for the tools, the before-and-after bars.
 *
 * Store artwork lives under /media/games and tool screenshots under
 * /media/tools.
 */

export interface BookLink {
  label: string
  href: string
}

export interface BookGame {
  slug: string
  title: string
  developer: string
  /** What the game is, for the left page. */
  description: string
  /** The reflective half: what the work was like. */
  body: string
  /** What I built, one line each. */
  did: string[]
  tech: string[]
  links: BookLink[]
  /** Store icon or key art, under /public. */
  art: string
  /** Solo titles get a spread to themselves; studio work gets a page. */
  tier: 'solo' | 'studio'
}

export interface BookDelta {
  label: string
  before: string
  after: string
  /** After as a fraction of before, for the bar. Lower is better throughout. */
  ratio: number
}

export interface BookTool {
  slug: string
  name: string
  tagline: string
  /** What it does, in the order someone using it would meet it. */
  what: string[]
  /** How it works underneath — the part that makes it a tool and not a button. */
  how: string
  shot: string
  shotCaption: string
  deltas: BookDelta[]
  /** The one line that says why the numbers moved. */
  note: string
}

/* ------------------------------------------------------------- game extras */

interface GameExtra {
  tier: 'solo' | 'studio'
}

const GAME_EXTRAS: Record<string, GameExtra> = {
  'realistic-hajwala': {
    tier: 'solo',
  },
  'gravity-grid': {
    tier: 'solo',
  },
  'word-shift': {
    tier: 'solo',
  },
  'highway-drifter-online': {
    tier: 'studio',
  },
  'highway-drifter-mobile': {
    tier: 'studio',
  },
  'amer-fighting': {
    tier: 'studio',
  },
  'amer-chase': {
    tier: 'studio',
  },
  'amer-tycoon': {
    tier: 'studio',
  },
  'amer-cop-pursuit': {
    tier: 'studio',
  },
  'rooftop-run': {
    tier: 'studio',
  },
}

/* ------------------------------------------------------------- tool extras */

interface ToolExtra {
  how: string
  shotCaption: string
  deltas: BookDelta[]
  note: string
}

const TOOL_EXTRAS: Record<string, ToolExtra> = {
  'nav-mcp': {
    how: 'I started NAV MCP after testing another Unity MCP server that exposed 356 tools. Their schemas alone took about 56,800 tokens before the real work started. NAV MCP keeps its queue and scene state outside Unity, so a script recompile does not wipe them. Unity pushes hierarchy changes to a small scene mirror for fast reads, while edits are sent back in batches.',
    shotCaption: 'The desktop app showing whether the server is running, which mode it is using, and how many Editors are connected.',
    deltas: [
      { label: 'MCP tool schemas', before: '56,800 tokens', after: '910 tokens', ratio: 0.016 },
      { label: 'Scene query', before: '~95 ms', after: '~1 ms', ratio: 0.011 },
      { label: 'Editor ticks for 32 operations', before: '32', after: '1', ratio: 0.031 },
    ],
    note: 'Measured with the project’s own bench tests against a Unity Editor.',
  },
  'mesh-atlas-builder': {
    how: 'A market stall is twelve renderers and eight materials, and a street holds a hundred and eighty stalls. Packing the textures into one atlas and remapping the UVs collapses the prop to one material, and one material is what lets the copies batch. The occupancy readout is there because a badly packed atlas trades draw calls for texture memory.',
    shotCaption: 'A pass over a twelve-part market stall: the packing preview and the cost on either side.',
    deltas: [
      { label: 'Draw calls', before: '2,160', after: '180', ratio: 0.083 },
      { label: 'SetPass calls', before: '8', after: '1', ratio: 0.125 },
      { label: 'CPU frame time', before: '18.05 ms', after: '8.75 ms', ratio: 0.485 },
    ],
    note: 'One draw per instance instead of twelve, and one SetPass for the whole street.',
  },
  'gpu-instanced-painter': {
    how: 'A table has an oak top, painted legs, an apron, and brass hardware. Recoloring it per instance the usual way needs a material per colorway, and that is exactly what breaks instancing. Tagging each part with a vertex color channel moves the variation into a property block instead, which instancing does not care about.',
    shotCaption: 'Channel assignment, the four swatches, and a strip of instances off one mesh and one material.',
    deltas: [
      { label: 'Draw calls (24 instances)', before: '120', after: '1', ratio: 0.008 },
      { label: 'Unique materials', before: '32', after: '1', ratio: 0.031 },
      { label: 'CPU frame time', before: '5.42 ms', after: '4.24 ms', ratio: 0.782 },
    ],
    note: 'The colourways cost nothing extra once the colours live in a property block.',
  },
  'icon-generator': {
    how: 'The preview is a real render. The meshes are drawn explicitly rather than handed over as a GameObject, which is what makes it work for props whose meshes hang off children, so what the window shows is what lands on disk. A queue on the side renders a whole car roster in one pass.',
    shotCaption: 'A shipped car framed for its shop icon, three preview lights, outline dilate on.',
    deltas: [
      { label: 'Minutes per icon', before: '14', after: '0.6', ratio: 0.043 },
      { label: 'Apps in the loop', before: '3', after: '1', ratio: 0.333 },
      { label: 'Re-shoots after an art change', before: 'all by hand', after: 'one batch', ratio: 0.1 },
    ],
    note: 'No render scene, no DCC round trip, and the framing is reproducible.',
  },
  'shadow-baker': {
    how: 'Realtime shadows on a mobile forward renderer cost a full extra pass over every caster, every frame. Nothing in a market square moves, so nothing there should be paying for it. The atlas is why the decals do not become the new problem: packed, the twenty replacements draw as one.',
    shotCaption: 'Twenty static casters found, and the penumbra preview at the current softness.',
    deltas: [
      { label: 'Real-time casters', before: '20', after: '0', ratio: 0.02 },
      { label: 'Shadow pass', before: '3.20 ms', after: '1.50 ms', ratio: 0.469 },
      { label: 'Texture memory', before: '96.4 MB', after: '99.1 MB', ratio: 1 },
    ],
    note: 'Texture memory goes up, and that is the atlas. The shadow pass goes away, which is the trade worth making on mobile.',
  },
  'texture-optimizer': {
    how: 'Import settings are where build size quietly goes wrong. This project has two 8192 × 8192 textures and a run of 4096 × 4096 textures behind them, none of which anyone gets close enough to notice. The rules are ordered, so the UI folder keeps its own policy while everything else takes the general rule.',
    shotCaption: 'A real scan of this project: the two 8192 road maps are 256 MB between them.',
    deltas: [
      { label: 'Texture on disk', before: '1,457.6 MB', after: '34.1 MB', ratio: 0.023 },
      { label: 'Player build size', before: '244.1 MB', after: '96.2 MB', ratio: 0.394 },
      { label: 'Cold load time', before: '41.6 s', after: '16.4 s', ratio: 0.394 },
    ],
    note: 'Measured with a full Android IL2CPP player, same scene set, same machine.',
  },
  'lod-baker': {
    how: 'Past a certain distance, nobody can tell a billboard from a building, and the tri counts for those answers differ by three orders of magnitude. The window is about deciding where that line sits: the distance ramp shows the chain the way the camera meets it, and the per frame resolution turns red when the atlas cannot afford the frame count.',
    shotCaption: 'A 28,450-triangle prop down to a two-triangle impostor, with the capture grid.',
    deltas: [
      { label: 'Triangles on screen', before: '9,673,000', after: '2,539,571', ratio: 0.263 },
      { label: 'Draw calls', before: '340', after: '137', ratio: 0.403 },
      { label: 'GPU frame time', before: '14.90 ms', after: '6.10 ms', ratio: 0.409 },
    ],
    note: 'Measured on a street with 340 instances, sixty per cent of them past the imposter distance.',
  },
  validator: {
    how: 'Every one of these issues causes a failure at runtime rather than at compile time, so the first person to find them is a tester or a store reviewer. Findings with one correct answer are marked for auto fix and fixed in a batch; the rest are left alone because a validator that guesses is one nobody trusts.',
    shotCaption: 'Three errors, five warnings, three notes. Nine of them fixable without a decision.',
    deltas: [
      { label: 'Pre-build check', before: '45 min by hand', after: '1.7 s', ratio: 0.001 },
      { label: 'Build failures per week', before: '3', after: '0', ratio: 0.02 },
      { label: 'Findings needing a human', before: '11', after: '2', ratio: 0.182 },
    ],
    note: 'The nine auto-fixes have one correct answer each. The other two get a name and a line number.',
  },
  'build-pipeline': {
    how: 'Shipping one title to the App Store, Play, Steam, and PlayStation means four signing setups, four backend answers, and four version schemes. Doing that by hand is how a submission gets rejected for a version code that went backwards. A script owning the counter is the whole fix.',
    shotCaption: 'Four targets at once, every storefront version scheme resolved from one number.',
    deltas: [
      { label: 'Release wall time', before: '190 min', after: '74 min', ratio: 0.389 },
      { label: 'Manual steps', before: '38', after: '1', ratio: 0.026 },
      { label: 'Build rejections per release', before: '2', after: '0', ratio: 0.02 },
    ],
    note: 'The wall time is unattended now rather than hands-on. The rejection count is what actually changed.',
  },
}

/* ------------------------------------------------------------------ binding */

function developerOf(p: Project) {
  // The self-published titles ship under Tazigra, which is the label rather
  // than a studio credit — naming it here is what stops the solo pages reading
  // as three unrelated one-off releases.
  return p.team === 'Solo' ? 'Tazigra · solo developer & publisher' : p.team
}

export const bookGames: BookGame[] = projects
  .filter((p) => p.type === 'game' && GAME_EXTRAS[p.slug])
  .map((p) => {
    const extra = GAME_EXTRAS[p.slug]
    return {
      slug: p.slug,
      title: p.title,
      developer: developerOf(p),
      // The site's first opening paragraph is the premise and the second is
      // about the work. The book prints them on facing pages rather than
      // dropping one of them.
      description: p.overview[0],
      body: p.overview[1] ?? p.overview[0],
      did: p.contributions,
      tech: p.tech,
      links: p.links ?? [],
      art: p.thumb ?? '',
      tier: extra.tier,
    }
  })

export const bookTools: BookTool[] = projects
  .filter((p) => p.type === 'tool' && TOOL_EXTRAS[p.slug])
  .map((p) => {
    const extra = TOOL_EXTRAS[p.slug]
    return {
      slug: p.slug,
      name: p.title,
      tagline: p.subtitle,
      // Three is what fits above the rule; the site page carries the rest.
      what: p.contributions.slice(0, 3),
      how: extra.how,
      // The journal uses a lifted, tighter crop of the tool screenshot.
      shot: `/media/tools/${p.slug}-book.webp`,
      shotCaption: extra.shotCaption,
      deltas: extra.deltas,
      note: extra.note,
    }
  })
