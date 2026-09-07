export const profile = {
  name: 'Ahmad Bilto',
  role: 'Unity Gameplay & Tools Developer',
  location: 'Amman, Jordan',
  email: 'biltoa@outlook.com',
  phone: '+962 79 040 5940',
  site: 'ahmadbilto.com',
  linkedin: 'https://linkedin.com/in/ahmad-bilto',
  resumeUrl: '/Ahmad-Bilto-Resume.pdf',

  tagline:
    'I build responsive gameplay systems, polished cross-platform games, and Unity editor tools that help teams iterate faster.',

  summary: [
    'I am a Unity gameplay & tools developer with ten shipped titles across iOS, Android, Steam, and PS4/PS5, including a mobile multiplayer driving game that I built and published solo to 200,000+ downloads and roughly 37,000 monthly active users.',
    'Whenever I take on a project, I take full ownership of the product and remain committed to bringing out its full potential from beginning to end.',
  ],

  /**
   * The two halves of the work, in the reader's words rather than a skills
   * list. Kept out of `summary` because the journal prints them on their own
   * chapter and the About page gives them their own column.
   */
  whatIBuild: [
    'Most of my work falls into two areas: gameplay and tools.',
    'On the gameplay side, I build vehicle and character controllers, state machines, grid-based systems, inventories, and progression systems. I also enjoy adding the final layer of polish and juice, whether it is the visuals, sound, or the small interactions that make everything feel satisfying to use.',
    'On the tools side, I create systems that improve the project, optimize performance, and make collaboration between artists and developers smoother. This includes tools that import art assets and connect them to the right systems, whether it is a new car, character, or other game content. I also create tools that automate repetitive tasks so the team can spend less time on setup and more time building the game.',
  ],

  /** Away from the desk. */
  offDuty: {
    games: [
      'Rust',
      'League of Legends',
      'Silkroad Online',
      'Apex Legends',
      'Sons of the Forest',
      'Assetto Corsa',
      'BeamNG.drive',
      'Command & Conquer: Generals – Zero Hour',
      'Rocket League',
      'Teamfight Tactics',
      "Garry's Mod",
      'The Elder Scrolls V: Skyrim',
      'Red Dead Redemption 2',
    ],
    outdoors: ['Camping', 'Hiking', 'Cooking'],
  },

  stats: [
    { value: '200K+', label: 'Solo game downloads', accent: 'red' as const },
    { value: '10', label: 'Shipped titles', accent: 'blue' as const },
    { value: '4', label: 'Platforms shipped to', accent: 'yellow' as const },
    { value: '37K', label: 'Monthly active players', accent: 'ink' as const },
  ],

  platforms: ['iOS', 'Android', 'Steam', 'PlayStation 4 / 5'],

  experience: [
    {
      company: 'Mad Hook',
      role: 'Unity Developer',
      period: 'Aug 2024 to Aug 2026',
      place: 'Amman, Jordan',
      points: [
        'Wrote code in all seven studio titles and personally shipped 30+ updates to four live games without losing player progress, including Amer Tycoon: Idle (from scratch) and Highway Drifter: Hajwala Online (iOS, Android, Steam, PS4/PS5).',
        'Architected the core systems: a custom vehicle controller plus a heavily extended Realistic Car Controller Pro, kinematic and physics-based character controllers driven by finite state machines, a grid-based building and decoration system wired to progression and inventory, and a custom JSON save system.',
        'Replaced the input controller across Highway Drifter: Hajwala Online with touch, keyboard, and gamepad schemes; retuned inherited car handling and owned draw-call optimization on the console builds.',
        'Wrote the Unity editor content tooling used by the 12-developer team: mesh and material combining with generated atlases, a vertex-colour combiner paired with a GPU-instanced recolouring shader, and 3D asset to UI sprite baking with no render scene.',
        'Automated the release and optimization path with LOD chains ending in impostors, shadow baking to ground sprites, folder-scoped texture import rules, a project validator, and a one-button multi-store build pipeline behind 40+ store releases.',
        'Increased Day-7 retention 26% relative and ad ARPDAU 10% through economy, progression and telemetry tuning; increased install conversion 13% relative with playable ads and capture scenes; mentored a junior Unity developer.',
      ],
    },
    {
      company: 'Tazigra',
      role: 'Independent Unity Developer',
      period: 'Dec 2023 to now',
      place: 'Amman, Jordan',
      points: [
        'Founded Tazigra to publish my own games — Realistic Hajwala, Gravity Grid, Word Shift, and more on the way.',
        'Designed, built and shipped a multiplayer driving game solo on iOS and Android in Unity with eight-player Photon PUN2 multiplayer, reaching 200,000+ downloads at roughly 80% organic, with 30,000 Android MAU and 7,000 iOS MAU.',
        'Built the entire feature set alone: a heavily modified RCCP vehicle controller, custom JSON saves, dynamic day and night weather cycles, and a mobile-optimized traffic system.',
        'Raised performance from 24 to 60 FPS on an iPhone 13 Pro in a full-traffic city and cut draw calls from 2,160 to 180; improved iOS Day-1 retention from about 20% to 38%.',
        'Prioritized the update roadmap from retention and monetization data, and ran the paid user acquisition behind it through Meta Ads Manager and Google Ads.',
      ],
    },
    {
      company: 'Maysalward',
      role: 'Unity Developer & Instructor',
      period: 'Mar 2024 to Jun 2024',
      place: 'Amman, Jordan',
      points: [
        'Shipped gameplay features and content updates for live mobile titles in Unity3D.',
        'Stabilized iOS and Android builds through release.',
        'Trained six students and interns in C#, Unity UI architecture, animation state machines, and mobile optimization.',
      ],
    },
    {
      company: 'Aramad Information Technology',
      role: 'Full-Stack Web Developer',
      period: 'Feb 2021 to Dec 2023',
      place: 'Charlottetown, PEI, Canada',
      points: [
        'Built and maintained 20+ client websites in PHP, JavaScript and WordPress.',
        'Built a WHMCS reseller platform automating hosting provisioning and billing.',
        'Implemented SEO, keyword research, and asset optimization improvements.',
      ],
    },
  ],

  education: [
    {
      school: 'Dickinson College, Carlisle, PA',
      detail: 'Coursework toward a B.S. in Computer Science. 2 years completed.',
      period: 'Aug 2017 to May 2019',
    },
    {
      school: "King's Academy, Madaba, Jordan",
      detail: 'American High School Diploma. GPA 3.91 / 4.0.',
      period: 'Aug 2013 to May 2017',
    },
  ],

  skills: [
    {
      group: 'Gameplay Programming',
      items: [
        'C#',
        'Unity',
        'Character & vehicle controllers',
        'Finite state machines',
        'NPC behaviour',
        'Grid-based building',
        'Inventory & progression',
        'JSON serialization',
      ],
    },
    {
      group: 'Tools & Editor Scripting',
      items: [
        'Unity editor extensions',
        'Multi-platform build pipelines',
        'Asset import automation',
        'Pre-build validation',
        'LODs & impostors',
        'Mesh & material combining',
        'Texture atlas generation',
      ],
    },
    {
      group: 'Performance & Rendering',
      items: [
        'Unity Profiler',
        'Frame Debugger',
        'URP',
        'Shader Graph',
        'GPU instancing',
        'Occlusion culling',
        'Draw call reduction',
        'Object pooling',
        'Light baking',
        'Jobs System',
        'Burst',
        'Addressables',
      ],
    },
    {
      group: 'Platforms & Workflow',
      items: [
        'iOS',
        'Android',
        'Steam',
        'PS4 / PS5',
        'App Store & Google Play submission',
        'PlasticSCM',
        'Git',
        'Jira',
        'Blender',
        'Agile / Scrum',
        'Firebase',
        'GameAnalytics',
        'AdMob',
        'AppLovin',
      ],
    },
  ],
} as const

export type Profile = typeof profile
