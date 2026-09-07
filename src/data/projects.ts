/**
 * The single source of truth for the Projects page, every project detail page,
 * and the shared facts the camp journal reads out of (see `book.ts`).
 *
 * Every entry here is real work. The metrics are only present where there is a
 * measured number behind them — a project with nothing to report carries scope
 * facts (platforms, frame target) instead of an invented percentage.
 *
 * Media:
 *   thumb:   store artwork, pulled by `tools/fetch-game-art.mjs`
 *   gallery: tool window captures, produced by `tools/shoot-unity-tools.mjs`
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
    subtitle: 'Solo indie mobile game · self-published under Tazigra',
    type: 'game',
    year: 2023,
    period: 'Dec 2023 to now',
    status: 'Live',
    accent: 'red',
    featured: true,
    tags: ['Multiplayer', 'Vehicle physics', 'Live-ops', 'Monetization', 'Solo'],
    platforms: ['iOS', 'Android'],
    engine: 'Unity 3D (URP)',
    role: 'Solo developer, publisher, and UA operator',
    team: 'Solo',
    blurb:
      'Self-published drift and cruise game past 200,000 downloads, with Photon multiplayer, live-ops, and paid UA I ran myself down to a $0.0019 Android CPI.',
    overview: [
      'This Arabian driving and drifting game focuses on authentic Gulf style street sliding and vehicle tuning. It features both singleplayer and multiplayer modes, in-depth vehicle customization and tuning, traffic vehicles, and multiple maps.',
      'This is my solo title, from concept and code through release and everything that has come after it. Shipping it was the easy half. The interesting half has been the months since: reading retention curves, changing the early session loop, rebalancing ad placement, and buying users cheaply enough that the economics actually close.',
    ],
    contributions: [
      'Built the full game from concept to store release for iOS and Android.',
      'Implemented online multiplayer with Photon PUN2: lobbies, room state, transform sync, and interpolation tuned for mobile network conditions.',
      'Designed the vehicle handling model: drift entry and exit, grip curves, and camera behavior that stays readable while sliding.',
      'Integrated AdMob mediation, GameAnalytics, Firebase, and the Facebook SDK for revenue, telemetry, and attribution.',
      'Ran paid user acquisition through Google Ads and Meta Ads Manager, including creative production from game footage.',
      'Ran the live ops pipeline: update scheduling driven by retention and monetization data rather than gut feel.',
    ],
    technical: [
      'Vehicle physics run on a custom wheel model layered over Unity physics, with per-surface friction curves so drift feels consistent across the map instead of only on the test straight.',
      'Network transforms use dead-reckoning with a short interpolation buffer; remote cars stay smooth through 150ms spikes instead of rubber-banding, which matters because the whole point is watching other people drive.',
      'Object pooling covers particles, tyre marks, and audio sources. The previous per-spawn allocation pattern was the single biggest GC contributor on mid-range Android.',
      'Analytics funnels are event-tagged per session stage, which is what surfaced the Day-7 retention drop as the highest-leverage fix before scaling spend.',
    ],
    tech: ['Unity3D', 'C#', 'Photon PUN2', 'AdMob', 'GameAnalytics', 'Firebase', 'Meta Ads'],
    metrics: [
      { value: '200K+', label: 'Total downloads' },
      { value: '30K', label: 'Android MAU' },
      { value: '$0.0019', label: 'Android CPI' },
      { value: '38%', label: 'iOS Day-1 retention' },
    ],
    links: [
      { label: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.TazigraLLC.RealisticHajwala&hl=en' },
      { label: 'App Store', href: 'https://apps.apple.com/jo/app/realistic-hajwala/id6744271585' },
    ],
    thumb: '/media/games/realistic-hajwala.webp',
  },
  {
    slug: 'gravity-grid',
    title: 'Gravity Grid',
    subtitle: 'Solo indie mobile puzzle · self-published under Tazigra',
    type: 'game',
    year: 2025,
    period: '2025',
    status: 'Live',
    accent: 'blue',
    featured: true,
    tags: ['Puzzle', 'Level design', 'Solo', 'Physics'],
    platforms: ['iOS', 'Android'],
    engine: 'Unity 3D',
    role: 'Solo developer and publisher',
    team: 'Solo',
    blurb:
      'A gravity-flipping puzzle grid taken from concept to store release alone, with hand-authored progression and a rule set that stays readable as it deepens.',
    overview: [
      'In this gravity based puzzle game, the player rotates the entire board instead of touching the blocks directly. The player turns the world in different directions and lets gravity do the rest, guiding each colored block into its matching exit to solve the level.',
      'I self published it on both stores, then iterated based on live player data: where players stalled, which levels they abandoned, and which introductions were less effective at teaching than I had assumed.',
    ],
    contributions: [
      'Built the game from concept to store release on iOS and Android.',
      'Procedurally generated 10,000 levels with rigorous rule checks and automatic QA passes.',
      'Designed the rule set for readability under compounding complexity. The failure mode of this genre is a board nobody can parse.',
      'Integrated Firebase and GameAnalytics, then used level by level funnels to find and rebuild the levels players quit on.',
    ],
    technical: [
      'The board is a deterministic simulation stepped in discrete ticks rather than a live physics scene, so a solution is reproducible and a level can be verified as solvable at author time.',
      'DOTween drives the presentation layer only. Keeping the animation off the simulation means a player can act on the next move before the previous one has finished settling.',
      'Level data is plain serialised assets, so adding a level is authoring rather than building.',
    ],
    tech: ['Unity3D', 'C#', 'DOTween', 'Firebase', 'GameAnalytics'],
    metrics: [{ value: '2', label: 'Stores' }],
    links: [
      { label: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.tazigra.gravitygrid' },
      { label: 'App Store', href: 'https://apps.apple.com/jo/app/gravity-grid-color-drop/id6794268530' },
    ],
    thumb: '/media/games/gravity-grid.webp',
  },
  {
    slug: 'word-shift',
    title: 'Word Shift',
    subtitle: 'Solo indie mobile puzzle · self-published under Tazigra',
    type: 'game',
    year: 2025,
    period: '2025',
    status: 'Live',
    accent: 'yellow',
    tags: ['Puzzle', 'Word game', 'Solo', 'Monetization'],
    platforms: ['iOS', 'Android'],
    engine: 'Unity 3D',
    role: 'Solo developer and publisher',
    team: 'Solo',
    blurb:
      'A word puzzler on a board that shifts underneath you. Validation, generation, and the monetisation loop, all shipped solo.',
    overview: [
      'In this word puzzle game, the player slides and swaps tiles on a grid to spell target words and find hidden bonus words. The player unlocks mechanics like frozen, chained, multiplier, bomb, and color tiles as they progress.',
      'I built and published it alone, then tuned its pacing based on live retention data, particularly around ad placement, where a puzzle game either keeps its players or loses them.',
    ],
    contributions: [
      'Built the word validation and board shift systems, including the dictionary lookup and the shift rules.',
      'Implemented level generation so the puzzle supply was not a hand authored bottleneck.',
      'Built the monetization loop and tuned ad placement and pacing against live retention data.',
      'Designed a profanity filter for the word lists in 10+ different languages.',
      'Shipped and maintained the title on both stores.',
    ],
    technical: [
      'Word lookup runs against a prefix-trie built at load, so validating a candidate is a walk rather than a search and the board can be checked continuously as a player drags.',
      'The shift is applied as a transform over board state rather than as a rewrite, which keeps undo and the solver honest.',
      'Ad placement is data-driven: the interstitial cadence is config, so a pacing change is a remote value and not a build.',
    ],
    tech: ['Unity3D', 'C#', 'Firebase', 'GameAnalytics', 'AdMob'],
    metrics: [{ value: '2', label: 'Stores' }],
    links: [
      { label: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.tazigra.wordshift&hl=en' },
      { label: 'App Store', href: 'https://apps.apple.com/jo/app/word-shift-brain-puzzle/id6778904644' },
    ],
    thumb: '/media/games/word-shift.webp',
  },
  {
    slug: 'highway-drifter-online',
    title: 'Highway Drifter: Hajwala Online',
    subtitle: 'Mobile · Steam · PS4 / PS5',
    type: 'game',
    year: 2025,
    period: '2024 to 2025',
    status: 'Shipped',
    accent: 'blue',
    featured: true,
    tags: ['Console', 'Multiplayer', 'Cross-platform', 'Certification'],
    platforms: ['iOS', 'Android', 'Steam', 'PS4', 'PS5'],
    engine: 'Unity 3D',
    role: 'Unity developer',
    team: 'Mad Hook',
    blurb:
      'Cross-platform online drift racer taken to Steam and PlayStation, including the input, performance, and certification work that jump implies.',
    overview: [
      'This drifting and driving game focuses on the popular Gulf style motorsport of Hajwalah. It features both singleplayer and multiplayer modes, multiple maps, simple vehicle customization and tuning, and different play modes such as time attack and free roam.',
      'This was the studio\'s widest release. The same core runs on phones, Steam, and PlayStation 4 and 5. I shipped update releases for Steam and PS5, including new features, platform certification passes, and bug fixes across builds. I did this within an existing large codebase and under console submission requirements that never appear on a mobile store.',
    ],
    contributions: [
      'Implemented new features and fixes in an existing large production codebase.',
      'Carried Steam and PlayStation builds through platform certification passes.',
      'Adapted control and camera handling across touch, gamepad, and keyboard without splitting the gameplay code path.',
      'Profiled and optimized for console frame targets: draw call reduction, GPU instancing, LODs, and light baking.',
    ],
    technical: [
      'Input is normalised into an intent layer of steer, throttle, handbrake and camera, so gameplay never reads a device directly and a new platform is a mapping file rather than a refactor.',
      'The console frame budget forced the biggest wins: batching static road furniture with GPU instancing and rebuilding the LOD chain took the heaviest scenes back under target.',
      'Shared save and progression handling had to tolerate platform-specific storage semantics without diverging the progression rules.',
    ],
    tech: ['Unity3D', 'C#', 'Steamworks', 'PS5 SDK', 'Photon', 'Git'],
    metrics: [
      { value: '5', label: 'Platforms' },
      { value: '60fps', label: 'Console frame target' },
    ],
    links: [
      { label: 'Steam', href: 'https://store.steampowered.com/app/2761820/Highway_Drifter_Hajwala_Simulator/' },
      { label: 'PlayStation', href: 'https://store.playstation.com/en-us/concept/10009634/' },
      { label: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.madboxgames.drifter' },
      { label: 'App Store', href: 'https://apps.apple.com/np/app/highway-drifter-hajwala-online/id1415516694' },
    ],
    thumb: '/media/games/highway-drifter-online.webp',
  },
  {
    slug: 'highway-drifter-mobile',
    title: 'Highway Drifter: Hajwala Drift',
    subtitle: 'Mobile live-ops on a shipped title',
    type: 'game',
    year: 2024,
    period: '2024 to 2025',
    status: 'Live',
    accent: 'red',
    tags: ['Live-ops', 'Mobile', 'Production codebase'],
    platforms: ['iOS', 'Android'],
    engine: 'Unity 3D',
    role: 'Unity developer',
    team: 'Mad Hook',
    blurb:
      'Feature work, content additions, and fixes shipped onto a running drifting game with an existing player base.',
    overview: [
      'This drifting and driving game delivers a mix of realistic and arcade driving styles. It features a wide variety of realistic cars, special accessories, and simple tuning mechanics.',
      'This is the mobile line of the Highway Drifter family, with an active player base while development continues. Updating a running build is a different discipline from building one: every change has to remain compatible with existing saves and safe for players who are already mid progression.',
    ],
    contributions: [
      'Delivered feature work and content additions on a live production build.',
      'Fixed gameplay and platform bugs reported against the running version.',
      'Shipped update builds to both stores on the studio\'s release pipeline.',
      'Pushed monthly SDK updates.',
    ],
    technical: [
      'Save migration has to be forward-only and non-destructive; a progression wipe on a live title is unrecoverable regardless of what caused it.',
      'Ad mediation through AppLovin, with telemetry split so a revenue change can be attributed to the update that caused it.',
    ],
    tech: ['Unity3D', 'C#', 'AppLovin', 'Firebase', 'GameAnalytics', 'Git'],
    metrics: [{ value: '2', label: 'Stores' }],
    links: [
      { label: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.Untitled.CarPhysics' },
      { label: 'App Store', href: 'https://apps.apple.com/np/app/uhd-hajwala-drift-simulator/id6443678969' },
    ],
    thumb: '/media/games/highway-drifter-mobile.webp',
  },
  {
    slug: 'amer-fighting',
    title: 'Amer Fighting',
    subtitle: 'Steam · PS5',
    type: 'game',
    year: 2025,
    period: '2024 to 2025',
    status: 'Shipped',
    accent: 'red',
    tags: ['Console', 'Fighting', 'Certification'],
    platforms: ['Steam', 'PS5'],
    engine: 'Unity 3D',
    role: 'Unity developer',
    team: 'Mad Hook',
    blurb:
      'Steam and PS5 releases for a fighting game: new features, gameplay and platform fixes, and console certification.',
    overview: [
      'This cartoon style party brawler features chaotic multiplayer matches for up to six players, interactive arenas, and improvised weapons. The game highlights localized humor around the studio\'s character, Amer.',
      'This was my first multiplatform and multiplayer party game. Fighting games are unforgiving about frame timing, which makes them unforgiving about platform differences. A fix that is invisible on one target can change a combo window on another.',
    ],
    contributions: [
      'Fixed gameplay and platform specific bugs across builds.',
      'Carried builds through console certification.',
      'Developed and deployed a website specifically for this game.',
      'Integrated analytics to track wishlists.',
    ],
    technical: [
      'Gameplay timing is driven off a fixed step rather than frame delta, so behaviour does not change with the platform\'s frame pacing.',
      'Platform-specific requirements, from controller disconnection to suspend and resume to save semantics, are handled at the boundary rather than inside gameplay.',
    ],
    tech: ['Unity3D', 'C#', 'Steamworks', 'PS5 SDK', 'Git'],
    metrics: [{ value: '2', label: 'Platforms' }],
    links: [
      { label: 'Steam', href: 'https://store.steampowered.com/app/3264920/Amer_Fighting/' },
      { label: 'PlayStation', href: 'https://store.playstation.com/en-us/concept/10010443/' },
    ],
    thumb: '/media/games/amer-fighting.jpg',
  },
  {
    slug: 'amer-chase',
    title: 'Amer: The Chase, Hit and Run',
    subtitle: 'Mobile and PlayStation · live updates',
    type: 'game',
    year: 2024,
    period: '2024 to 2025',
    status: 'Live',
    accent: 'yellow',
    tags: ['Live-ops', 'Mobile', 'Console'],
    platforms: ['iOS', 'Android', 'PS5'],
    engine: 'Unity 3D',
    role: 'Unity developer',
    team: 'Mad Hook',
    blurb: 'Maintained and extended a shipped chase game against a live player base.',
    overview: [
      'In this open world arcade driving game, players step into the shoes of Amer to explore a vast city landscape, participate in different matches, evade police pursuits, and use earned cash to purchase houses and properties.',
      'The work here involved maintenance and extension within existing production code. This version of the job was constrained by what already existed rather than what I would have built. This was by far the largest codebase I worked on.',
    ],
    contributions: [
      'Delivered bug fixes and update builds on iOS and Android.',
      'Extended existing gameplay systems without restructuring them.',
      'Kept the build compliant as store and OS requirements changed.',
      'Pushed monthly SDK updates.',
    ],
    technical: [
      'Changes were scoped to be locally verifiable. In a codebase this size, a change whose blast radius you cannot see is a change you cannot ship on a cadence.',
    ],
    tech: ['Unity3D', 'C#', 'AppLovin', 'Firebase', 'GameAnalytics', 'Git'],
    metrics: [{ value: '3', label: 'Platforms' }],
    links: [
      { label: 'Google Play', href: 'https://play.google.com/store/apps/details?id=io.madhook.ameradventures' },
      { label: 'App Store', href: 'https://apps.apple.com/np/app/amer-the-chase-hit-and-run/id1638909330' },
      { label: 'PlayStation', href: 'https://store.playstation.com/en-us/concept/10018067' },
    ],
    thumb: '/media/games/amer-chase.webp',
  },
  {
    slug: 'amer-tycoon',
    title: 'Amer Tycoon: Idle',
    subtitle: 'Built from scratch · mobile idle',
    type: 'game',
    year: 2025,
    period: '2024 to 2025',
    status: 'Shipped',
    accent: 'yellow',
    featured: true,
    tags: ['Idle', 'Economy design', 'From scratch', 'Monetization'],
    platforms: ['iOS', 'Android'],
    engine: 'Unity 3D',
    role: 'Unity developer, full implementation',
    team: 'Mad Hook',
    blurb:
      'An idle tycoon built from the ground up: progression, offline earnings, upgrade economy, and the save system that has to survive all of it.',
    overview: [
      'In this business management simulation and idle game, the player controls Amer and manages different tasks to grow the business. Features include staff management, expansions, offline progression, and cosmetic rewards.',
      'This was the one studio title I owned end to end, rather than one I joined in progress. My work covered idle progression, offline earnings, the upgrade economy, and the save system underneath them.',
    ],
    contributions: [
      'Built the full game from the ground up.',
      'Implemented idle progression and offline earnings, including the time accounting that made returning feel rewarding without making the system exploitable.',
      'Designed and tuned the upgrade economy curve for long session retention.',
      'Built the save system and the migration path that allowed the economy to be retuned after release.',
    ],
    technical: [
      'Offline earnings are computed from a trusted elapsed-time source and clamped, because the naive version is a device-clock exploit.',
      'Economy values are data rather than code, so a rebalance ships as content and does not need a rebuild.',
      'Progression numbers exceed what a float can represent long before players stop playing, so the currency type is its own thing rather than a double.',
    ],
    tech: ['Unity3D', 'C#', 'AppLovin', 'Firebase', 'GameAnalytics'],
    metrics: [{ value: '100%', label: 'Implementation ownership' }],
    links: [
      { label: 'Google Play', href: 'https://play.google.com/store/apps/details?id=io.madhook.karakboy' },
      { label: 'App Store', href: 'https://apps.apple.com/np/app/amer-tycoon-idle/id6738697763' },
    ],
    thumb: '/media/games/amer-tycoon.webp',
  },
  {
    slug: 'amer-cop-pursuit',
    title: 'Amer: Cop Pursuit',
    subtitle: 'Mobile · Steam · PlayStation',
    type: 'game',
    year: 2024,
    period: '2024 to 2025',
    status: 'Live',
    accent: 'blue',
    tags: ['Live-ops', 'Mobile', 'Console'],
    platforms: ['iOS', 'Android', 'Steam', 'PS4', 'PS5'],
    engine: 'Unity 3D',
    role: 'Unity developer',
    team: 'Mad Hook',
    blurb: 'Update builds and fixes for a shipped police pursuit racer across mobile and console.',
    overview: [
      'This is a fast paced, casual, 2.5D arcade game in which the goal is to evade a police pursuit. The player escapes through different localized maps, utilizes map items like explosive mines and nitro speed boosters, and uses collected game cash to purchase new cars and character cosmetics.',
      'This was a pursuit racer live across mobile, Steam, and PlayStation. I worked on updates within an established production codebase for a title with players across four platforms at once.',
    ],
    contributions: [
      'Delivered update builds and bug fixes on iOS and Android.',
      'Worked within an established codebase shared across mobile and console releases.',
      'Pushed monthly SDK updates.',
    ],
    technical: [
      'A shared codebase across four storefronts means a fix has four verification targets; keeping the platform differences at the edges is what makes that tractable.',
    ],
    tech: ['Unity3D', 'C#', 'AppLovin', 'Firebase', 'GameAnalytics', 'Git'],
    metrics: [{ value: '5', label: 'Platforms' }],
    links: [
      { label: 'Steam', href: 'https://store.steampowered.com/app/1360820/The_Chase/' },
      { label: 'PlayStation', href: 'https://store.playstation.com/en-us/product/UP7305-PPSA18502_00-0141778171491961' },
      { label: 'Google Play', href: 'https://play.google.com/store/apps/details?id=com.madboxgames.thechase' },
      { label: 'App Store', href: 'https://apps.apple.com/np/app/amer-cop-pursuit/id1388971296' },
    ],
    thumb: '/media/games/amer-cop-pursuit.webp',
  },
  {
    slug: 'rooftop-run',
    title: 'Rooftop Run',
    subtitle: 'Mobile endless runner · live updates',
    type: 'game',
    year: 2024,
    period: '2024 to 2025',
    status: 'Live',
    accent: 'ink',
    tags: ['Live-ops', 'Mobile', 'Endless runner'],
    platforms: ['iOS', 'Android'],
    engine: 'Unity 3D',
    role: 'Unity developer',
    team: 'Mad Hook',
    blurb:
      'Update builds and fixes keeping a live endless runner stable across OS and store requirement changes.',
    overview: [
      'In this 3D parkour action game, the character automatically sprints and leaps over upcoming gaps or obstacles, while the player\'s main focus is maneuvering left and right to avoid losing. It features a progression system for upgrading attributes and different boosters like speed boosters and trampolines.',
      'This is an endless runner live on both mobile stores. Most of my work involved keeping a shipped title shippable: OS updates, SDK updates, and store policy changes impose a steady tax on anything that stays live.',
    ],
    contributions: [
      'Shipped mobile update builds and bug fixes on iOS and Android.',
      'Kept the build compliant through OS and store requirement changes.',
      'Pushed monthly SDK updates.',
    ],
    technical: [
      'SDK upgrades on a live title are the highest-risk low-glory change there is; staging them one at a time is what keeps a regression attributable.',
    ],
    tech: ['Unity3D', 'C#', 'AppLovin', 'Firebase', 'GameAnalytics', 'Git'],
    metrics: [{ value: '2', label: 'Stores' }],
    links: [
      { label: 'Google Play', href: 'https://play.google.com/store/apps/details?id=io.madhook.parkour' },
      { label: 'App Store', href: 'https://apps.apple.com/np/app/rooftop-run/id1517567831' },
    ],
    thumb: '/media/games/rooftop-run.webp',
  },

  /* ------------------------------------------------------------------ TOOLS */
  {
    slug: 'nav-mcp',
    title: 'NAV MCP',
    subtitle: 'One external server that lets AI tools work across every Unity Editor I have open.',
    type: 'tool',
    year: 2026,
    period: '2026',
    status: 'Shipped',
    accent: 'yellow',
    featured: true,
    tags: ['Editor tool', 'MCP', 'AI tooling', 'Unity automation', 'Developer tools'],
    platforms: ['Windows', 'macOS', 'Unity Editor'],
    engine: '.NET 8 / Unity 6',
    role: 'Solo systems and tool developer',
    team: 'Solo',
    blurb:
      'Drives every open Unity Editor from one external MCP server: 92 operations behind six tools, a 910-token idle surface, main-thread batching, and mirrored scene reads.',
    overview: [
      'A flat Unity MCP catalog can charge an AI client for hundreds of tool schemas before it has done any work, while every live Editor call still has to wait for Unity\'s main thread. The server NAV MCP replaces exposed 356 tools at roughly 56,800 tokens and paid that context cost on every turn.',
      'NAV MCP moves the durable state outside Unity into one .NET daemon, puts 92 Editor operations behind six MCP tools, and drives every linked Editor from the same desktop app. Guidance and schemas load only when needed; scene reads come from a live mirror; mutations batch into one Editor tick and one undo group.',
    ],
    contributions: [
      'Built the daemon, Unity package, stdio bridge, and desktop app as one system.',
      'Kept the MCP surface to six tools, then loaded the Unity commands and guidance only when the task needed them.',
      'Made batches land in one Editor tick and one undo step, instead of making Unity wait for every call separately.',
      'Maintained a live scene hierarchy from ObjectChangeEvents, cutting mirrored queries from about 95 ms to about 1 ms and keeping reads available through domain reloads.',
      'Implemented loopback-only transports, per-start bearer tokens, readonly/standard/full modes, and per-tool permissions enforced by the daemon.',
      'Generated dispatch, catalog, and reference docs from source attributes, backed by 153 tests and Windows/macOS CI packaging.',
    ],
    technical: [
      'The request queue, retry logic, catalog, and scene mirror live in the daemon because Unity destroys its AppDomain on every script recompile. The Unity package connects out and only pumps operations on the main thread.',
      'The selector grammar and reconcile hash compile into both the daemon and Unity package from shared source. Reconciliation can therefore identify the exact node and field that drifted without maintaining two parsers.',
      'Health is the last completed round trip rather than socket state. A connected Editor blocked by a modal dialog is reported as blocked, including the dialog title, instead of being shown as healthy.',
      'Each project is identified by a GUID rather than a port, and process command lines are read back after launch to verify that Unity received project paths containing spaces intact.',
    ],
    tech: ['C#', '.NET 8', 'ASP.NET Core', 'Avalonia', 'MCP', 'Unity Editor API', 'Roslyn', 'xUnit'],
    metrics: [
      { value: '56,800 → 910', label: 'Idle tool-schema tokens' },
      { value: '~95 ms → ~1 ms', label: 'Scene query latency' },
      { value: '32 → 1', label: 'Editor ticks per 32 operations' },
      { value: '153', label: 'Automated tests' },
    ],
    thumb: '/media/tools/nav-mcp.webp',
    gallery: [
      {
        caption: 'Overview: live server address, profile, tool count, and connected Editor state in one glance.',
        src: '/media/tools/nav-mcp.webp',
      },
      {
        caption: 'Projects: one daemon links, opens, restarts, and reports the live state of multiple Unity projects.',
        src: '/media/tools/nav-mcp-projects.webp',
      },
      {
        caption: 'Connections: safe setup for Claude Desktop, Claude Code, and Cursor without storing the bearer token in their config files.',
        src: '/media/tools/nav-mcp-connections.webp',
      },
      {
        caption: 'Settings: server mode plus searchable, per-operation permissions enforced immediately by the daemon.',
        src: '/media/tools/nav-mcp-settings.webp',
      },
      {
        caption: 'Stopped state: a first-run view that reports what is waiting and starts the server without a terminal.',
        src: '/media/tools/nav-mcp-stopped.webp',
      },
    ],
  },
  {
    slug: 'mesh-atlas-builder',
    title: 'Mesh Atlas Builder',
    subtitle: 'Mesh and material combiner with a generated texture atlas',
    type: 'tool',
    year: 2025,
    period: '2025',
    status: 'Internal',
    accent: 'yellow',
    featured: true,
    tags: ['Editor tool', 'Optimization', 'Draw calls', 'Atlasing'],
    platforms: ['Unity Editor'],
    engine: 'Unity 3D (URP)',
    role: 'Tool author',
    team: 'Solo',
    blurb:
      'Collapses a prop hierarchy into one mesh and one atlased material. A street of market stalls goes from 2,160 draw calls to 180.',
    overview: [
      'A market stall is twelve renderers and eight materials, and a street holds a hundred and eighty stalls. Drawn as authored that is thousands of draw calls for scenery nobody looks at directly.',
      'Mesh Atlas Builder walks the hierarchy, packs every source albedo into one atlas, rewrites each mesh\'s UVs into its cell, and writes a single combined mesh and material.',
    ],
    contributions: [
      'Editor window that searches the scene and lists every renderer with its material and texture budget.',
      'Shelf packer with configurable atlas size and cell padding, previewed live in the window.',
      'UV remap into atlas cells, with optional sub-mesh merging and lightmap UV generation.',
      'Draw call, SetPass, batch and frame-time reporting scaled to the number of instances the scene actually holds.',
    ],
    technical: [
      'The occupancy read-out is not decoration: a badly packed atlas trades draw calls for texture memory, and that trade has to be visible at the moment it is made.',
      'Cell padding exists because mip bleeding pulls a neighbour\'s colour into an atlas cell at distance, which looks like a lighting bug and is not.',
      'Colliders are preserved separately from the combined mesh, since a combined collider is a much worse trade than a combined renderer.',
    ],
    tech: ['Unity Editor API', 'C#', 'IMGUI', 'Texture2D.PackTextures'],
    metrics: [
      { value: '2,160 → 180', label: 'Draw calls' },
      { value: '8 → 1', label: 'SetPass calls' },
      { value: '−51%', label: 'CPU frame time' },
    ],
    thumb: '/media/tools/mesh-atlas-builder.webp',
    gallery: [
      {
        caption: 'The window after a pass over a twelve-part market stall: packing preview, occupancy, and the cost on either side.',
        src: '/media/tools/mesh-atlas-builder.webp',
      },
    ],
  },
  {
    slug: 'gpu-instanced-painter',
    title: 'GPU Instanced Painter',
    subtitle: 'Vertex color combiner with a GPU instanced recoloring shader',
    type: 'tool',
    year: 2025,
    period: '2025',
    status: 'Internal',
    accent: 'red',
    featured: true,
    tags: ['Editor tool', 'Shader', 'GPU instancing', 'Optimization'],
    platforms: ['Unity Editor'],
    engine: 'Unity 3D (URP)',
    role: 'Tool and shader author',
    team: 'Solo',
    blurb:
      'Four paintable zones in one mesh and one material, so every instance can be a different colourway and still draw in one batch.',
    overview: [
      'A table has an oak top, painted legs, an apron and brass hardware. Recolouring it per instance the usual way needs a material per colourway, which is exactly what breaks instancing.',
      'GPU Instanced Painter bakes the parts into one mesh, tags each into a vertex-colour channel, and drives four tint colours from a MaterialPropertyBlock. The variation moves out of the material and into somewhere instancing does not care about.',
    ],
    contributions: [
      'Editor window for assigning each child part of a prop to an R, G, B, or A vertex color channel.',
      'Bake pass producing one mesh with the channel masks written into vertex colors.',
      'Custom URP shader that tints four zones independently from a property block and is SRP Batcher compatible.',
      'Optional AO bake into UV2, to keep the contact shading the separate materials gave for free.',
    ],
    technical: [
      'Vertex colour was chosen over a mask texture because it costs no sampler and no extra texture memory, and four channels is exactly the number of paintable zones a prop of this kind actually needs.',
      'The colours go through a MaterialPropertyBlock rather than material instances. That is the whole difference between one draw call and one per colourway.',
      'AO baked into UV2 rather than recomputed, because the thing lost when four materials become one is the shading difference between them.',
    ],
    tech: ['Unity Editor API', 'C#', 'Shader Graph / HLSL', 'MaterialPropertyBlock'],
    metrics: [
      { value: '120 → 1', label: 'Draw calls (24 instances)' },
      { value: '32 → 1', label: 'Unique materials' },
      { value: '5 → 1', label: 'Mesh assets' },
    ],
    thumb: '/media/tools/gpu-instanced-painter.webp',
    gallery: [
      {
        caption: 'Channel assignment, the four colourway swatches, and a strip of instances that all come off one mesh and one material.',
        src: '/media/tools/gpu-instanced-painter.webp',
      },
    ],
  },
  {
    slug: 'icon-generator',
    title: 'Sprite Generator',
    subtitle: '3D asset to UI sprite, without a render scene',
    type: 'tool',
    year: 2025,
    period: '2025',
    status: 'Internal',
    accent: 'blue',
    featured: true,
    tags: ['Editor tool', 'UI', 'Content pipeline'],
    platforms: ['Unity Editor'],
    engine: 'Unity 3D (URP)',
    role: 'Tool author',
    team: 'Solo',
    blurb:
      'Frame a 3D asset, light it, outline it, and write the icon sprite, with no render scene to set up and no DCC round trip.',
    overview: [
      'Every shop, garage and inventory screen needs a flat icon of a thing that exists in 3D. The usual answer is a render scene somebody maintains, or a trip through a DCC package and back.',
      'Sprite Generator renders the asset live in an off-screen preview you can orbit, lights it with up to three placeable lights, dilates a coloured outline around the silhouette, and writes the supersampled sprite with its alpha.',
    ],
    contributions: [
      'Live preview with orbit, pan, and zoom, and an auto frame that fits the subject with space around it.',
      'Key, fill, and rim lights with independent color, intensity, and angle, over an adjustable ambient light.',
      'Screen space outline dilation in a color of choice.',
      'Transparent or solid background, resolution and supersample options, and a batch queue for a whole asset roster.',
    ],
    technical: [
      'The meshes are drawn explicitly through a PreviewRenderUtility rather than handed over as a GameObject. AddSingleGO only moves the root into the preview scene, so a prop whose meshes hang off children renders nothing, which reads as a broken tool rather than as a missing object.',
      'Renderers are woken and put on the preview layer before drawing, because prefabs authored for a game ship with variant parts switched off and no script runs in the editor to pick one.',
      'The outline is an eight-tap screen-space dilate rather than a second geometry pass. Cheaper, and identical to what lands on disk.',
    ],
    tech: ['Unity Editor API', 'C#', 'PreviewRenderUtility', 'IMGUI'],
    metrics: [
      { value: '14 min → 36 s', label: 'Per icon' },
      { value: '3 → 1', label: 'Apps in the loop' },
    ],
    thumb: '/media/tools/icon-generator.webp',
    gallery: [
      {
        caption: 'A shipped car framed for its shop icon: three preview lights, outline dilate on, checkerboard showing the cut-out.',
        src: '/media/tools/icon-generator.webp',
      },
    ],
  },
  {
    slug: 'shadow-baker',
    title: 'Shadow Baker',
    subtitle: 'Static realtime shadows baked down to ground sprites',
    type: 'tool',
    year: 2025,
    period: '2025',
    status: 'Internal',
    accent: 'ink',
    tags: ['Editor tool', 'Optimization', 'Mobile', 'Lighting'],
    platforms: ['Unity Editor'],
    engine: 'Unity 3D (URP)',
    role: 'Tool author',
    team: 'Solo',
    blurb:
      'Real-time shadows cost a full extra pass over every caster. Nothing in a market square moves, so nothing there should be paying it.',
    overview: [
      'Shadow Baker finds every static caster in a scene, renders its shadow from the sun into a sprite, drops that onto a ground decal, and switches the caster\'s real-time shadow casting off.',
      'The atlas is what stops the decals becoming the new problem: packed, twenty replacements draw as one.',
    ],
    contributions: [
      'Scene scan for static shadow casters, sizing each sprite to the object\'s ground footprint.',
      'Controls for softness, blur radius, opacity, and tint, with a live preview of the resulting sprite.',
      'Shared atlas or per object packing, ground offset to avoid z-fighting, and merging for casters whose shadows overlap.',
      'Reporting that shows the cost the bake adds as well as the cost it removes.',
    ],
    technical: [
      'Texture memory goes up and the tool says so. A tool that only reports its wins is a tool you cannot use to make a decision.',
      'The ground offset exists because a decal coplanar with the floor z-fights, and the fix is a millimetre rather than a render-queue argument.',
      'Only casters flagged static are touched, since the whole premise fails the moment the object moves.',
    ],
    tech: ['Unity Editor API', 'C#', 'Render textures', 'URP decals'],
    metrics: [
      { value: '20 → 0', label: 'Real-time casters' },
      { value: '−53%', label: 'Shadow pass' },
      { value: '+2.7 MB', label: 'Texture memory' },
    ],
    thumb: '/media/tools/shadow-baker.webp',
    gallery: [
      {
        caption: 'Twenty static casters found, with the penumbra preview at the current softness.',
        src: '/media/tools/shadow-baker.webp',
      },
    ],
  },
  {
    slug: 'texture-optimizer',
    title: 'Texture Optimizer',
    subtitle: 'Folder scoped texture import rules across the whole project',
    type: 'tool',
    year: 2025,
    period: '2025',
    status: 'Internal',
    accent: 'yellow',
    tags: ['Editor tool', 'Build size', 'Import settings', 'Optimization'],
    platforms: ['Unity Editor'],
    engine: 'Unity 3D',
    role: 'Tool author',
    team: 'Solo',
    blurb:
      'Import settings are where build size quietly goes wrong. A rule table, a dry run, and the build delta measured rather than hoped for.',
    overview: [
      'This project had two 8192-square source textures and a run of 4096s behind them, none of which anyone gets close enough to notice. 256 MB in the first two files alone.',
      'The window scans the real textures, applies rules by folder and filename, and reports what the build and the cold load actually saved.',
    ],
    contributions: [
      'Ordered rule table that governs max size, compression, crunch quality, and mipmaps.',
      'Project wide scan measuring each texture\'s cost on disk and in memory, with results sorted by what there is to gain.',
      'Dry run mode, so nothing is reimported on a guess.',
      'Build-size and cold-load reporting alongside the raw texture saving.',
    ],
    technical: [
      'The build figure is modelled on textures being about sixty per cent of this player rather than pretending a texture saving shrinks the whole build. The honest number is smaller and more useful than the flattering one.',
      'Rules are scoped by folder because policy genuinely differs: UI wants no mipmaps and high-quality compression, world textures want the opposite.',
      'Crunch ratios vary per asset, so the projected column is a range rather than one repeated number.',
    ],
    tech: ['Unity Editor API', 'C#', 'TextureImporter', 'IMGUI'],
    metrics: [
      { value: '1,458 → 34 MB', label: 'Texture on disk' },
      { value: '244 → 96 MB', label: 'Player build size' },
      { value: '−61%', label: 'Cold load time' },
    ],
    thumb: '/media/tools/texture-optimizer.webp',
    gallery: [
      {
        caption: 'A real scan of this project. The two 8192 road maps at the top are 256 MB between them.',
        src: '/media/tools/texture-optimizer.webp',
      },
    ],
  },
  {
    slug: 'lod-baker',
    title: 'LODs and Impostor Baker',
    subtitle: 'LOD chain generation, with an impostor at the far end',
    type: 'tool',
    year: 2025,
    period: '2025',
    status: 'Internal',
    accent: 'blue',
    tags: ['Editor tool', 'Optimization', 'LOD', 'Impostors'],
    platforms: ['Unity Editor'],
    engine: 'Unity 3D (URP)',
    role: 'Tool and shader author',
    team: 'Solo',
    blurb:
      'Past about forty metres nobody can tell a billboard from a building, and the tri count between those answers differs by three orders of magnitude.',
    overview: [
      'The tool generates an LOD chain with boundaries and UV seams preserved, then bakes the last level to an impostor: a grid of pre-rendered views blended by camera angle.',
      'Most of the window is about deciding where that line sits, which is why the distance ramp shows the chain the way the camera meets it rather than as a list of percentages.',
    ],
    contributions: [
      'LOD chain generation with per level screen height thresholds and a crossfade between levels.',
      'Impostor bake with configurable frame count, atlas size, and optional normal and depth capture.',
      'LODGroup authoring onto the source prefab.',
      'Cost reporting measured on a real street view rather than on one isolated prop.',
    ],
    technical: [
      'The per-frame resolution read-out turns red when the atlas cannot afford the frame count. An impostor with too little resolution per view is worse than no impostor, and the failure is silent otherwise.',
      'The capture grid puts the poles in the corner cells, which carry less silhouette than the middle ones; the preview shows that rather than hiding it behind a uniform grid.',
      'The atlas cost is a texture cost, not a vertex one, and the report separates them.',
    ],
    tech: ['Unity Editor API', 'C#', 'Mesh simplification', 'HLSL'],
    metrics: [
      { value: '−74%', label: 'Triangles on screen' },
      { value: '340 → 137', label: 'Draw calls' },
      { value: '−59%', label: 'GPU frame time' },
    ],
    thumb: '/media/tools/lod-baker.webp',
    gallery: [
      {
        caption: 'A 28,450-triangle prop down to a two-triangle impostor, with the distance ramp and the 12×12 capture grid.',
        src: '/media/tools/lod-baker.webp',
      },
    ],
  },
  {
    slug: 'validator',
    title: 'Project Validator',
    subtitle: 'The pass that runs before the build does',
    type: 'tool',
    year: 2025,
    period: '2025',
    status: 'Internal',
    accent: 'red',
    tags: ['Editor tool', 'Validation', 'Build pipeline', 'Automation'],
    platforms: ['Unity Editor'],
    engine: 'Unity 3D',
    role: 'Tool author',
    team: 'Solo',
    blurb:
      'Missing scripts, null references, broken shaders and out-of-policy imports all fail at runtime, which means a tester or a store reviewer finds them first.',
    overview: [
      'The Validator walks scenes and prefabs for the failures that only show up when something runs: missing script components, null serialized fields the code dereferences anyway, materials left on a pipeline that no longer exists.',
      'Findings with one correct answer are marked auto-fix and fixed in a batch. The rest are marked manual and left alone, because a validator that guesses is one nobody trusts.',
    ],
    contributions: [
      'Checks for missing scripts, null serialized references, broken shaders, dead colliders, empty objects, duplicate assets by content hash, and naming drift.',
      'Severity sorted findings list with filters, search, and a ping to select control on every row.',
      'Batch auto fix for the unambiguous findings and explicit manual marking for the rest.',
      'Markdown report export, and a hook so it runs as the first step of the build pipeline.',
    ],
    technical: [
      'Duplicate detection is by content hash rather than by name, because the assets that ship twice are the ones somebody duplicated and renamed.',
      'The manual/auto split is the design: the value of the tool is that its fixes are trustworthy, which requires it to decline the ambiguous ones out loud.',
    ],
    tech: ['Unity Editor API', 'C#', 'AssetDatabase', 'IMGUI'],
    metrics: [
      { value: '45 min → 1.7 s', label: 'Pre-build check' },
      { value: '3 → 0', label: 'Build failures per week' },
      { value: '9 of 11', label: 'Findings fixed without a decision' },
    ],
    thumb: '/media/tools/validator.webp',
    gallery: [
      {
        caption: 'A pass over this project: three errors, five warnings, three notes. Nine of them fixable without a decision.',
        src: '/media/tools/validator.webp',
      },
    ],
  },
  {
    slug: 'build-pipeline',
    title: 'Build Pipeline',
    subtitle: 'Every store build for a release, from one button',
    type: 'tool',
    year: 2025,
    period: '2025',
    status: 'Internal',
    accent: 'ink',
    featured: true,
    tags: ['Editor tool', 'Build pipeline', 'Automation', 'Release'],
    platforms: ['Unity Editor'],
    engine: 'Unity 3D',
    role: 'Tool author',
    team: 'Solo',
    blurb:
      'Four storefronts means four signing setups, four backend answers and four version schemes. A script owning the counter is the whole fix.',
    overview: [
      'Shipping one title to the App Store, Play, Steam and PlayStation by hand out of Build Settings is how a submission gets rejected for a version code that went backwards.',
      'The window resolves the version once and derives each storefront\'s scheme from it, then builds every enabled target with the backend and architecture that platform needs.',
    ],
    contributions: [
      'One resolved version, with Android versionCode, iOS CFBundleVersion, and the git tag derived from it.',
      'Per target build configuration for scripting backend, architecture, and output path, with live status and size.',
      'Pipeline steps: validator pass, Addressables rebuild, engine code stripping, symbol upload, changelog, and release channel post.',
      'Dry run mode and a per-step log, so a failure is attributable before anything is submitted.',
    ],
    technical: [
      'The build counter is owned by the script rather than by whoever is doing the release, which is the difference between a rejection and a release.',
      'The wall-time saving is real but is not the point. It is unattended time now rather than hands-on time, and the rejection count is what actually changed.',
      'The validator runs first by design: catching a null reference before a three-hour console build is the highest-value ordering in the whole pipeline.',
    ],
    tech: ['Unity Editor API', 'C#', 'BuildPipeline', 'Addressables', 'Git'],
    metrics: [
      { value: '38 → 1', label: 'Manual steps' },
      { value: '190 → 74 min', label: 'Release wall time' },
      { value: '2 → 0', label: 'Build rejections per release' },
    ],
    thumb: '/media/tools/build-pipeline.webp',
    gallery: [
      {
        caption: 'A release going out to four targets at once, every storefront version scheme resolved from one number.',
        src: '/media/tools/build-pipeline.webp',
      },
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
