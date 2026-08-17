export const profile = {
  name: 'Ahmad Bilto',
  role: 'Gameplay & Tools Developer',
  location: 'Amman, Jordan',
  email: 'biltoa@outlook.com',
  phone: '+962 79 040 5940',
  site: 'ahmadbilto.com',
  linkedin: 'https://linkedin.com/in/ahmad-bilto',
  resumeUrl: '/Ahmad-Bilto-Resume.pdf',

  tagline:
    'I build responsive gameplay systems, polished cross-platform games, and Unity editor workflows that help teams iterate faster.',

  summary: [
    'Unity developer with a gameplay-first mindset and a tools habit. I ship mobile and cross-platform titles end to end — core mechanics, live-ops, monetization pacing, SDK integration, store submission — and I keep the pipeline around them fast enough that designers can iterate without waiting on me.',
    'Most of my work splits in two directions. On the gameplay side: controllers that feel right, state machines that stay readable, and the polish layer (VFX, audio feedback, micro-interactions) that makes a build feel finished. On the tools side: Unity editor windows, validators, and build automation that turn a manual half-day into a one-click pass.',
    'Alongside studio work I self-publish. Realistic Hajwala crossed 100,000+ downloads as a solo project, which meant owning everything — multiplayer with Photon PUN2, ad mediation, analytics, retention analysis, and paid UA down to a $0.0019 Android CPI.',
  ],

  stats: [
    { value: '100K+', label: 'Solo game downloads', accent: 'red' as const },
    { value: '5', label: 'Shipped studio titles', accent: 'blue' as const },
    { value: '4', label: 'Platforms shipped to', accent: 'yellow' as const },
    { value: '30K', label: 'Monthly active players', accent: 'ink' as const },
  ],

  platforms: ['iOS', 'Android', 'Steam', 'PlayStation 4 / 5'],

  experience: [
    {
      company: 'Mad Hook',
      role: 'Unity Developer',
      period: 'Aug 2024 — Present',
      place: 'Amman, Jordan',
      points: [
        'Core gameplay systems and mechanics in Unity3D / C#, built around clean architecture and SOLID principles.',
        'Shipped and maintained multi-platform titles across their lifecycles: Amer Tycoon: Idle (from scratch), Highway Drifter: Hajwala Online (Mobile, Steam, PS4/PS5), UHD, Amer: The Chase, and Rooftop Run.',
        'Owned the full deployment pipeline for every company title — iOS and Android submissions, engine upgrades, SDK updates, and policy compliance resolution.',
        'Balanced economy and progression systems with a focus on engagement loops, monetization pacing, and polish (VFX, audio feedback, micro-interactions).',
        'Integrated AdMob, AppLovin, GameAnalytics, Facebook, and Firebase for telemetry, attribution, and ad monetization.',
        'Applied occlusion culling, GPU instancing, draw call reduction, texture atlasing, object pooling, light baking, and LODs against profiled frame-rate targets.',
        'Built custom gameplay scenes for UA video campaigns plus interactive playable ad formats.',
      ],
    },
    {
      company: 'Maysalward',
      role: 'Unity Developer & Instructor',
      period: 'Mar 2024 — Jun 2024',
      place: 'Amman, Jordan',
      points: [
        'Implemented features and content updates for live mobile games in Unity3D.',
        'Delivered technical training on C# scripting, Unity UI architecture, animation state machines, and mobile optimization.',
        'Tested and debugged Android and iOS builds for stability and performance.',
      ],
    },
    {
      company: 'Independent',
      role: 'Unity Developer, Self-Employed',
      period: 'Dec 2023 — Mar 2024',
      place: 'Amman, Jordan',
      points: [
        'Built and self-published Realistic Hajwala for iOS and Android, concept to release.',
        'Implemented multiplayer gameplay with Photon PUN2.',
        'Managed ad mediation and analytics across AdMob, GameAnalytics, Firebase, and Facebook SDK.',
        'Ran paid user acquisition campaigns through Meta Ads Manager and Google Ads.',
      ],
    },
    {
      company: 'Aramad Information Technology Inc.',
      role: 'Full-Stack Web Developer & IT Support',
      period: 'Feb 2021 — Dec 2023',
      place: 'Charlottetown, PEI, Canada',
      points: [
        'Developed and maintained 20+ client websites in HTML, CSS, JavaScript, PHP, and WordPress.',
        'Implemented SEO, keyword research, and asset optimization improvements.',
        'Built a WHMCS reseller platform for automated hosting provisioning and billing.',
      ],
    },
  ],

  education: [
    {
      school: 'University of Prince Edward Island',
      detail:
        'B.Sc. Computer Science, Video Game Programming specialization — 3 years completed. GPA 3.70 / 4.0.',
      period: 'Jan 2020 — May 2023',
    },
    {
      school: "King's Academy",
      detail: 'American High School Diploma. GPA 3.91 / 4.0, Tawjihi equivalency 90.3%.',
      period: 'Aug 2013 — May 2017',
    },
  ],

  skills: [
    {
      group: 'Programming',
      items: ['C#', 'C', 'Java', 'Python', 'JavaScript', 'PHP', 'HTML', 'CSS', 'SQL'],
    },
    {
      group: 'Game Development',
      items: [
        'Unity3D',
        'Photon PUN2',
        'Blender',
        'Photoshop',
        'Object pooling',
        'LOD',
        'GPU instancing',
        'Profiling',
      ],
    },
    {
      group: 'SDKs & Services',
      items: ['AdMob', 'AppLovin', 'GameAnalytics', 'Firebase', 'Facebook SDK', 'WHMCS', 'cPanel', 'WHM'],
    },
    {
      group: 'Workflow & Tools',
      items: ['Git', 'PlasticSCM', 'Jira', 'Trello', 'VMware', 'Visual Studio', 'VS Code'],
    },
    {
      group: 'Architecture',
      items: ['SOLID', 'Clean architecture', 'Agile / Scrum', 'Code reviews', 'Design patterns'],
    },
  ],
} as const

export type Profile = typeof profile
