/**
 * The single source of truth for the Projects page and every project detail page.
 *
 * NOTE FOR AHMAD: the shipped-title entries are pulled from your resume; the numbers
 * and platform lists are real. The five `tool` entries and every `gallery` caption are
 * PLACEHOLDERS written to be plausible — rewrite them with your actual editor tools.
 * Anything you edit here flows straight into the grid, the filters and the detail pages.
 *
 * To attach real media:
 *   thumb:  '/media/<file>.jpg'   → put the file in public/media/
 *   video:  '/media/<file>.mp4'   → same folder; plays inline on the detail page
 * Leave `thumb` undefined and a generated placeholder pattern is drawn instead.
 */

export type ProjectType = 'game' | 'tool'
export type Accent = 'red' | 'blue' | 'yellow' | 'ink'

export interface ProjectLink {
  label: string
  href: string
}

export interface Metric {
  value: string
  label: string
}

export interface GalleryItem {
  caption: string
  /** Optional image path under /public. Falls back to a generated pattern. */
  src?: string
}

export interface Project {
  slug: string
  title: string
  subtitle: string
  type: ProjectType
  /** Sort key + displayed year. */
  year: number
  /** Human-readable span shown on the detail page. */
  period: string
  status: 'Shipped' | 'Live' | 'In development' | 'Internal'
  accent: Accent
  featured?: boolean
  /** Shown as the runtime badge on the card, e.g. '01:02'. Optional. */
  clip?: string
  tags: string[]
  platforms: string[]
  engine: string
  role: string
  team: string
  /** One-line hook used on the card and in search. */
  blurb: string
  /** Detail page intro paragraphs. */
  overview: string[]
  /** "What I built" bullets. */
  contributions: string[]
  /** Deeper implementation notes. */
  technical: string[]
  tech: string[]
  metrics?: Metric[]
  links?: ProjectLink[]
  gallery?: GalleryItem[]
  thumb?: string
  video?: string
}

export const projects: Project[] = [
  /* ------------------------------------------------------------------ GAMES */
  {
    slug: 'realistic-hajwala',
    title: 'Realistic Hajwala',
    subtitle: 'Solo indie mobile game · self-published',
    type: 'game',
    year: 2023,
    period: 'Dec 2023 — Present',
    status: 'Live',
    accent: 'red',
    featured: true,
    clip: '02:14',
    tags: ['Multiplayer', 'Vehicle physics', 'Live-ops', 'Monetization', 'Solo'],
    platforms: ['iOS', 'Android'],
    engine: 'Unity 3D (URP)',
    role: 'Solo developer, publisher, and UA operator',
    team: 'Solo',
    blurb:
      'Self-published drift/cruise game past 100,000 downloads, with Photon multiplayer, live-ops, and paid UA I ran myself down to a $0.0019 Android CPI.',
    overview: [
      'Realistic Hajwala is my solo title — concept, code, release, and everything that comes after release. It is a car-culture cruising and drifting game built for mobile, with online lobbies where players meet up and show off runs.',
      'Shipping it was the easy half. The interesting half was the eighteen months since: reading retention curves, changing the early-session loop, rebalancing ad placement, and buying users cheaply enough that the economics actually close.',
    ],
    contributions: [
      'Built the full game from concept to store release for iOS and Android.',
      'Implemented online multiplayer with Photon PUN2 — lobbies, room state, transform sync, and interpolation tuned for mobile network conditions.',
      'Designed the vehicle handling model: drift entry/exit, grip curves, and camera behaviour that stays readable while sliding.',
      'Integrated and mediated AdMob, GameAnalytics, Firebase, and the Facebook SDK for revenue, telemetry, and attribution.',
      'Ran paid user acquisition through Google Ads and Meta Ads Manager, including creative production from in-engine capture.',
      'Ran the live-ops cadence: update scheduling driven by retention and monetization data rather than gut feel.',
    ],
    technical: [
      'Vehicle physics run on a custom wheel model layered over Unity physics, with per-surface friction curves so drift feels consistent across the map instead of only on the test straight.',
      'Network transforms use dead-reckoning with a short interpolation buffer; remote cars stay smooth through 150ms+ spikes instead of rubber-banding, which matters because the whole point is watching other people drive.',
      'Object pooling covers particles, tyre marks, and audio sources — the previous per-spawn allocation pattern was the single biggest GC contributor on mid-range Android.',
      'Analytics funnels are event-tagged per session stage, which is what surfaced the Day-7 retention drop as the highest-leverage fix before scaling spend.',
    ],
    tech: ['Unity3D', 'C#', 'Photon PUN2', 'AdMob', 'GameAnalytics', 'Firebase', 'Facebook SDK'],
    metrics: [
      { value: '100K+', label: 'Total downloads' },
      { value: '30K', label: 'Android MAU' },
      { value: '$0.0019', label: 'Android CPI' },
      { value: '32.6%', label: 'iOS Day-1 retention' },
      { value: '+86%', label: 'Ad revenue over 2 months' },
    ],
    links: [{ label: 'Store listing', href: '#' }],
    gallery: [
      { caption: 'Free-roam city at night — the main cruising loop.' },
      { caption: 'Multiplayer lobby with room browser and player cards.' },
      { caption: 'Drift scoring HUD and combo feedback.' },
      { caption: 'Garage / customization flow.' },
    ],
  },
  {
    slug: 'highway-drifter-hajwala-online',
    title: 'Highway Drifter: Hajwala Online',
    subtitle: 'Mobile · Steam · PS4 / PS5',
    type: 'game',
    year: 2025,
    period: '2024 — 2025',
    status: 'Shipped',
    accent: 'blue',
    featured: true,
    clip: '01:38',
    tags: ['Console', 'Multiplayer', 'Cross-platform', 'Gameplay systems'],
    platforms: ['iOS', 'Android', 'Steam', 'PS4', 'PS5'],
    engine: 'Unity 3D',
    role: 'Gameplay programmer',
    team: 'Studio team at Mad Hook',
    blurb:
      'Cross-platform online driving title taken from mobile to Steam and PlayStation, including the input, performance, and certification work that jump implies.',
    overview: [
      'Highway Drifter started life on mobile and grew into the studio\'s widest release — the same core running on phones, Steam, and PlayStation 4 and 5.',
      'I worked on core gameplay systems and on the platform work that a port surfaces: input abstraction, frame budget on fixed console hardware, and the long tail of certification requirements that never appear on a mobile store.',
    ],
    contributions: [
      'Implemented and maintained core gameplay systems and mechanics in C#, structured for the platform differences instead of forked per platform.',
      'Adapted control and camera handling across touch, gamepad, and keyboard without splitting the gameplay code path.',
      'Profiled and optimized for console frame targets: draw call reduction, GPU instancing, LODs, and light baking.',
      'Contributed to the release pipeline across mobile stores and console submission.',
    ],
    technical: [
      'Input is normalised into an intent layer — steer, throttle, handbrake, camera — so gameplay never reads a device directly and a new platform is a mapping file rather than a refactor.',
      'The console frame budget forced the biggest wins: batching static road furniture with GPU instancing and rebuilding the LOD chain took the heaviest scenes back under target.',
      'Shared save/progression handling had to tolerate platform-specific storage semantics without diverging the progression rules.',
    ],
    tech: ['Unity3D', 'C#', 'Photon', 'Console SDKs', 'PlasticSCM', 'Jira'],
    metrics: [
      { value: '5', label: 'Platforms' },
      { value: '60fps', label: 'Console frame target' },
    ],
    gallery: [
      { caption: 'Highway traffic sim at speed.' },
      { caption: 'Gamepad control scheme on console build.' },
      { caption: 'Performance capture before/after batching pass.' },
    ],
  },
  {
    slug: 'amer-tycoon-idle',
    title: 'Amer Tycoon: Idle',
    subtitle: 'Built from scratch · mobile idle',
    type: 'game',
    year: 2025,
    period: '2024 — 2025',
    status: 'Shipped',
    accent: 'yellow',
    featured: true,
    clip: '01:05',
    tags: ['Idle', 'Economy design', 'From scratch', 'Monetization'],
    platforms: ['iOS', 'Android'],
    engine: 'Unity 3D',
    role: 'Unity developer — project founded from scratch',
    team: 'Studio team at Mad Hook',
    blurb:
      'Idle tycoon built from an empty project: progression curve, offline earnings, prestige loop, and the monetization pacing that holds it together.',
    overview: [
      'Amer Tycoon started as an empty Unity project and became a shipped idle title. Because it began from scratch, the architecture decisions were mine to make early — which is exactly where an idle game lives or dies, since the whole genre is one long balanced curve.',
      'The bulk of the work after first playable was economy: how fast numbers grow, when the player hits a wall, and what the wall is selling.',
    ],
    contributions: [
      'Founded the project structure and core systems — save/load, offline progression, upgrade graph, and prestige reset.',
      'Balanced the economy and progression curve against target session length and engagement loops.',
      'Paced monetization placements (rewarded video, boosts, offers) to sit at friction points rather than randomly.',
      'Built the polish layer: number pop VFX, audio feedback, and the micro-interactions that make idle taps feel good.',
      'Integrated analytics to validate curve assumptions against real session data.',
    ],
    technical: [
      'Currency values exceed double precision quickly in idle games, so the economy runs on a big-number representation with formatted display rather than raw floats.',
      'Offline earnings are computed from a signed timestamp delta with clamping, so clock manipulation cannot mint currency.',
      'The upgrade graph is data-driven ScriptableObjects — design could retune the entire curve without a code change or a rebuild.',
    ],
    tech: ['Unity3D', 'C#', 'ScriptableObjects', 'AdMob', 'AppLovin', 'GameAnalytics', 'Firebase'],
    gallery: [
      { caption: 'Main tycoon board with upgrade tracks.' },
      { caption: 'Offline earnings return screen.' },
      { caption: 'Prestige reset and multiplier preview.' },
    ],
  },
  {
    slug: 'amer-the-chase',
    title: 'Amer: The Chase',
    subtitle: 'Mobile action / pursuit',
    type: 'game',
    year: 2024,
    period: '2024',
    status: 'Shipped',
    accent: 'ink',
    clip: '00:58',
    tags: ['Mobile', 'Gameplay systems', 'Polish', 'Live title'],
    platforms: ['iOS', 'Android'],
    engine: 'Unity 3D',
    role: 'Unity developer',
    team: 'Studio team at Mad Hook',
    blurb:
      'Pursuit-driven mobile action title — gameplay mechanics, feel pass, and the live update cadence after launch.',
    overview: [
      'Amer: The Chase is a mobile pursuit game where the moment-to-moment tension comes from proximity: how close the chaser is, how readable the escape route is, and how quickly the player understands they are about to lose.',
      'My work concentrated on gameplay mechanics and the feedback layer that communicates that pressure without a UI element telling the player outright.',
    ],
    contributions: [
      'Implemented core chase mechanics and the difficulty pacing behind them.',
      'Built the feedback layer — camera shake, audio ducking, and VFX cues tied to pursuit proximity.',
      'Maintained the title through content updates and store compliance passes.',
      'Optimized for the low-end Android device tier that made up the majority of the install base.',
    ],
    technical: [
      'Pursuit difficulty scales on a rubber-band curve rather than fixed speed, so a losing player is kept in tension instead of dropped, without the chaser reading as unfair.',
      'Proximity drives a single normalised "heat" value that camera, audio, and post-processing all subscribe to — one signal, many expressions, no drift between them.',
    ],
    tech: ['Unity3D', 'C#', 'Cinemachine', 'AdMob', 'Firebase'],
    gallery: [
      { caption: 'Chase sequence with proximity heat effects.' },
      { caption: 'Escape route telegraphing.' },
    ],
  },
  {
    slug: 'uhd',
    title: 'UHD',
    subtitle: 'Mobile title',
    type: 'game',
    year: 2024,
    period: '2024 — 2025',
    status: 'Shipped',
    accent: 'blue',
    clip: '00:47',
    tags: ['Mobile', 'Optimization', 'Live title'],
    platforms: ['iOS', 'Android'],
    engine: 'Unity 3D',
    role: 'Unity developer',
    team: 'Studio team at Mad Hook',
    blurb:
      'Mobile title I contributed gameplay and heavy performance-optimization work to across its live lifecycle.',
    overview: [
      'UHD is one of the studio titles I worked across during its live lifecycle — feature work, maintenance, and a sustained optimization effort as the content footprint grew.',
    ],
    contributions: [
      'Implemented gameplay features and content updates.',
      'Ran profiling-led optimization passes: occlusion culling, texture atlasing, and object pooling.',
      'Handled engine version upgrades and SDK updates without regressing live builds.',
    ],
    technical: [
      'Profiling first, changes second — every optimization in this project started from a captured frame rather than an assumption about what was slow.',
      'Texture atlasing and draw-call reduction gave the largest wins; the content pipeline had grown past what the original batching setup assumed.',
    ],
    tech: ['Unity3D', 'C#', 'Unity Profiler', 'Addressables'],
    gallery: [{ caption: 'Profiler capture before and after the batching pass.' }],
  },
  {
    slug: 'rooftop-run',
    title: 'Rooftop Run',
    subtitle: 'Mobile runner',
    type: 'game',
    year: 2024,
    period: '2024',
    status: 'Shipped',
    accent: 'yellow',
    clip: '00:41',
    tags: ['Runner', 'Mobile', 'Gameplay systems'],
    platforms: ['iOS', 'Android'],
    engine: 'Unity 3D',
    role: 'Unity developer',
    team: 'Studio team at Mad Hook',
    blurb:
      'Rooftop parkour runner — movement feel, procedural segment flow, and the responsiveness a runner lives on.',
    overview: [
      'Rooftop Run is a parkour runner where the entire experience is the movement model. If the jump arc is wrong or the input window is a frame too tight, nothing else matters.',
    ],
    contributions: [
      'Implemented player movement, jump arcs, and the forgiveness windows that keep a runner fair.',
      'Built segment flow and difficulty ramping across the run.',
      'Added the polish layer: speed lines, landing impacts, and audio feedback tied to momentum.',
    ],
    technical: [
      'Input uses coyote time plus a small jump buffer — the two changes that most reliably move a runner from "unresponsive" to "tight" in playtests.',
      'Segments are authored as prefabs with tagged entry/exit heights so procedural assembly can never produce an impossible transition.',
    ],
    tech: ['Unity3D', 'C#', 'Object pooling'],
    gallery: [{ caption: 'Segment transition with momentum preserved.' }],
  },

  /* ------------------------------------------------------------------ TOOLS */
  {
    slug: 'level-prototyping-toolkit',
    title: 'Level Prototyping Toolkit',
    subtitle: 'Unity editor tool · workflow + validation',
    type: 'tool',
    year: 2024,
    period: '2024',
    status: 'Internal',
    accent: 'red',
    featured: true,
    clip: '01:02',
    tags: ['Editor tooling', 'Workflow', 'QA', 'Validation'],
    platforms: ['Unity Editor'],
    engine: 'Unity 3D',
    role: 'Tools developer',
    team: 'Internal studio tool',
    blurb:
      'Editor window for blocking out and validating levels — snap-placement, layout rules, and a validation pass that fails the build on broken geometry.',
    overview: [
      'PLACEHOLDER CONTENT — rewrite with your real tool. Designers were blocking out levels by dragging primitives and discovering problems in playtest. This toolkit moved both halves of that into the editor: fast placement, and an automated pass that catches the broken cases before anyone loads the scene.',
      'The validation half turned out to matter more than the placement half. Catching an unreachable pickup at author time instead of in QA is the difference between a five-second fix and a bug ticket round trip.',
    ],
    contributions: [
      'Built a custom EditorWindow with grid snapping, modular piece palettes, and multi-object placement.',
      'Wrote a validation pass covering unreachable geometry, overlapping colliders, missing spawn markers, and out-of-bounds props.',
      'Added a scene-view overlay drawing validation failures in place rather than as a console list.',
      'Wired validation into the build pipeline so a failing scene stops the build with a readable report.',
    ],
    technical: [
      'Placement uses Handles and custom scene-view input so it feels native rather than like a separate mode the user has to remember to leave.',
      'Validation rules are individual ScriptableObject assets — new rules are authored without touching the runner, and rules can be enabled per project.',
      'Reachability is a coarse navmesh/raycast sweep from spawn points; it is deliberately conservative, since false negatives cost more than false positives here.',
    ],
    tech: ['Unity Editor API', 'C#', 'ScriptableObjects', 'Handles / Gizmos', 'IPreprocessBuildWithReport'],
    metrics: [
      { value: '~4h → 20m', label: 'Blockout iteration time' },
      { value: '12', label: 'Validation rules' },
    ],
    gallery: [
      { caption: 'Editor window with modular piece palette.' },
      { caption: 'Scene-view validation overlay flagging failures in place.' },
      { caption: 'Build-time validation report.' },
    ],
  },
  {
    slug: 'build-pipeline-automation',
    title: 'Build Pipeline Automation',
    subtitle: 'One-click multi-platform builds + store submission prep',
    type: 'tool',
    year: 2025,
    period: '2024 — 2025',
    status: 'Internal',
    accent: 'blue',
    featured: true,
    clip: '00:52',
    tags: ['Build automation', 'CI', 'Release', 'Editor tooling'],
    platforms: ['Unity Editor', 'iOS', 'Android'],
    engine: 'Unity 3D',
    role: 'Tools developer',
    team: 'Internal studio tool',
    blurb:
      'Turned a manual, error-prone release checklist into a one-click pass: platform switching, keystore and signing config, versioning, and submission-ready artifacts.',
    overview: [
      'PLACEHOLDER CONTENT — rewrite with your real tool. I owned deployment for every company title, which meant repeating the same twenty-step checklist per platform per release. Every step was a chance to ship the wrong bundle version or the wrong signing config.',
      'This tool encodes the checklist. The build machine does the same thing every time, and the parts that used to be tribal knowledge live in a config asset.',
    ],
    contributions: [
      'Built a build configuration asset per platform — bundle IDs, signing, defines, stripping level, and target API.',
      'Automated version and build-number increments tied to release channel.',
      'Added a preflight check that fails early on the common submission blockers instead of at the store.',
      'Exposed the whole thing as both an editor window and a command-line entry point for headless builds.',
    ],
    technical: [
      'The command-line entry point takes a config name and nothing else, so a CI runner cannot drift from what a developer runs locally.',
      'Preflight covers the failures that actually cost days: missing privacy manifest entries, mismatched bundle versions, debug defines left enabled, and oversized asset budgets.',
      'Build reports are written next to the artifact — size breakdown by category, so growth is visible per release instead of discovered at the store limit.',
    ],
    tech: ['Unity Editor API', 'C#', 'BuildPipeline', 'Gradle', 'Xcode post-process', 'CLI / headless Unity'],
    metrics: [
      { value: '20+ steps → 1', label: 'Release checklist' },
      { value: '5', label: 'Titles using it' },
    ],
    gallery: [
      { caption: 'Build configuration asset inspector.' },
      { caption: 'Preflight report catching a submission blocker.' },
    ],
  },
  {
    slug: 'performance-audit-window',
    title: 'Performance Audit Window',
    subtitle: 'Scene-wide cost analysis for mobile targets',
    type: 'tool',
    year: 2025,
    period: '2025',
    status: 'Internal',
    accent: 'yellow',
    clip: '01:20',
    tags: ['Optimization', 'Profiling', 'Editor tooling', 'Mobile'],
    platforms: ['Unity Editor'],
    engine: 'Unity 3D',
    role: 'Tools developer',
    team: 'Internal studio tool',
    blurb:
      'Editor window that audits a scene against mobile budgets — draw calls, overdraw hotspots, texture memory, and un-batched renderers — and points at the offending objects.',
    overview: [
      'PLACEHOLDER CONTENT — rewrite with your real tool. Profiling a mobile build is a slow loop: build, deploy, capture, interpret. Most of what that loop reveals is knowable from the scene itself.',
      'This window answers the cheap questions in the editor so the device profiler is reserved for the expensive ones.',
    ],
    contributions: [
      'Built a scene scanner reporting renderer counts, material variants, texture memory, and batching breakers.',
      'Added budget thresholds per device tier with pass/warn/fail states.',
      'Made every finding click-to-select so a warning takes you to the object causing it.',
      'Added a diff mode comparing the current scene against a saved baseline to catch regressions per release.',
    ],
    technical: [
      'Batching breakers are the highest-value finding: a single material instance difference silently splits a batch, and nothing in the default editor surfaces that.',
      'Texture memory is estimated from import settings and platform overrides rather than on-disk size, which is what actually lands on the device.',
      'Baseline diffing is stored as a JSON asset per scene so regressions show up in review instead of at the end of a milestone.',
    ],
    tech: ['Unity Editor API', 'C#', 'IMGUI / UI Toolkit', 'Unity Profiler API'],
    metrics: [{ value: '3', label: 'Device tiers modelled' }],
    gallery: [
      { caption: 'Audit results grouped by severity.' },
      { caption: 'Overdraw hotspot visualisation in scene view.' },
    ],
  },
  {
    slug: 'gameplay-state-machine-framework',
    title: 'Gameplay State Machine Framework',
    subtitle: 'Reusable hierarchical FSM + editor visualiser',
    type: 'tool',
    year: 2025,
    period: '2025',
    status: 'Internal',
    accent: 'ink',
    clip: '01:11',
    tags: ['Architecture', 'Gameplay systems', 'Editor tooling', 'SOLID'],
    platforms: ['Unity Editor', 'Runtime'],
    engine: 'Unity 3D',
    role: 'Gameplay / tools developer',
    team: 'Internal studio framework',
    blurb:
      'Hierarchical state machine used across studio titles, with a live editor visualiser that shows the active state path at runtime.',
    overview: [
      'PLACEHOLDER CONTENT — rewrite with your real framework. Every title had its own hand-rolled state handling, all of them slightly different, none of them debuggable. This is the shared one.',
      'The visualiser is the part people actually use daily — being able to see which state a character is in, and why it transitioned, removes most state-machine bugs before they get filed.',
    ],
    contributions: [
      'Designed a hierarchical FSM with typed transitions, entry/exit hooks, and per-state update budgets.',
      'Built a runtime visualiser drawing the active state path with transition history.',
      'Wrote the transition guard system so conditions are declarative and testable in isolation.',
      'Documented adoption patterns and migrated an existing title onto it as the proof case.',
    ],
    technical: [
      'Transitions are data plus a guard delegate, which keeps the graph inspectable — a transition that can never fire is visible without running the game.',
      'Hierarchy lets shared behaviour (stunned, dead, paused) live at parent level instead of being duplicated into every leaf state, which is what made the original per-title machines unmaintainable.',
      'The visualiser reads from a ring buffer of transitions so the history survives the frame where the bug happened.',
    ],
    tech: ['C#', 'Unity Editor API', 'SOLID', 'Design patterns'],
    gallery: [
      { caption: 'Runtime state path visualiser.' },
      { caption: 'Transition history ring buffer view.' },
    ],
  },
  {
    slug: 'playable-ad-exporter',
    title: 'Playable Ad Exporter',
    subtitle: 'Unity scene → single-file interactive playable',
    type: 'tool',
    year: 2025,
    period: '2025',
    status: 'Internal',
    accent: 'red',
    clip: '00:49',
    tags: ['UA', 'Build automation', 'WebGL', 'Marketing'],
    platforms: ['Unity Editor', 'Web'],
    engine: 'Unity 3D',
    role: 'Tools developer',
    team: 'Internal studio tool',
    blurb:
      'Exports a purpose-built Unity scene into a size-capped, single-file playable ad that meets each ad network\'s packaging rules.',
    overview: [
      'PLACEHOLDER CONTENT — rewrite with your real tool. I built custom gameplay scenes for UA campaigns and interactive playable formats; the packaging step around them was manual and network-specific, and every network wants something slightly different.',
      'This exporter takes the scene and produces the artifact each network will actually accept, with the size cap enforced at export instead of discovered at upload.',
    ],
    contributions: [
      'Built the export pipeline from a tagged Unity scene to an inlined single-file HTML playable.',
      'Added per-network profiles for size caps, entry hooks, and required call-to-action APIs.',
      'Automated asset compression and inlining so the artifact stays under cap without hand-editing.',
      'Added a local preview harness for reviewing playables before handing them to marketing.',
    ],
    technical: [
      'Everything is inlined as base64 — a playable that references an external file fails on some networks and silently degrades on others.',
      'Size cap enforcement runs as a hard gate at export with a per-asset breakdown, so the fix is obvious rather than a guessing game.',
      'Network profiles are config assets, so a new network is a data entry rather than a code change.',
    ],
    tech: ['Unity Editor API', 'C#', 'WebGL', 'JavaScript', 'Asset compression'],
    metrics: [{ value: '< 5MB', label: 'Enforced artifact cap' }],
    gallery: [
      { caption: 'Export settings with per-network profiles.' },
      { caption: 'Size breakdown gate at export time.' },
    ],
  },
]

/* -------------------------------------------------------------- derived data */

export const allTags = Array.from(new Set(projects.flatMap((p) => p.tags))).sort()

export const allPlatforms = Array.from(new Set(projects.flatMap((p) => p.platforms))).sort()

export function getProject(slug: string): Project | undefined {
  return projects.find((p) => p.slug === slug)
}

/** Neighbours in the default (newest-first) ordering, for prev/next nav. */
export function getNeighbours(slug: string) {
  const ordered = [...projects].sort((a, b) => b.year - a.year || a.title.localeCompare(b.title))
  const i = ordered.findIndex((p) => p.slug === slug)
  if (i === -1) return { prev: undefined, next: undefined }
  return {
    prev: i > 0 ? ordered[i - 1] : ordered[ordered.length - 1],
    next: i < ordered.length - 1 ? ordered[i + 1] : ordered[0],
  }
}
