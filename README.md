# Ahmad Bilto — portfolio

Personal site for a Unity gameplay / tools developer. The landing page is a 3D campsite you walk
into; behind it sit a Unity WebGL host and a filterable project grid.

```bash
npm install
npm run dev
```

Opens on http://localhost:5173.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR |
| `npm run build` | Type-check, then production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally on :4173 |
| `npm run typecheck` | Types only, no build |

Stack: Vite · React 19 · TypeScript · react-router · three.js via react-three-fiber. No CSS
framework — the design system is plain CSS custom properties in `src/styles/global.css`, so
retheming is a token swap rather than a rewrite.

There is no top navigation on the landing page and no theme switcher anywhere: the campsite *is* the
navigation, and the scene is night-time regardless of anything else. Inner pages keep a small bar so
they are not a dead end.

---

## The campsite

`src/three/CampHero.tsx` plus `src/three/campsite/`. Three canvas A-frame tents round a fire in a
night forest, with the environment built from the *Dreamscape Nature: Campsite* Unity pack and the tent
mesh loaded from `public/models/canvas-cabin.glb`. Scroll moves focus between them. Clicking one
walks the camera across the clearing, ducks it through the doorway, and settles over a journal lying
open on a bench inside. Esc or the Back button walks you out.

The three shells share one matte, triplanar woven-canvas treatment and one
weathered-wood frame treatment. Their canvas bases are deliberately distinct:
olive About, warm-sand Gameplay, and smoky blue-charcoal Projects.

Each tent is dressed: a bedroll and pillow down one wall, a bench against the back with a lit candle
at each end and the journal between them, a cushion on the floor in front of it, and a small cushion
heap in the corner. The old shelf/glassware and backpack were removed when the shallower A-frame
replaced the pavilion because both intersected its walls. The room dressing remains in the
tent-local frame so the shell can change without changing any journal content.

`?room=0|1|2` deep-links straight inside a tent — that is also how the interiors get screenshotted
without waiting out the walk-in. In dev, `?travel=0.55` freezes the walk-in part-way and snaps the
camera there, `?book=0|1` pins how far the journal has opened, `?reveal=1` pins the ink, `?aurora=N`
sets the aurora's gain (0 turns the march off, which is how its share of the frame budget gets
measured), and `?fps=1` shows a frame-time readout — mean *and worst*, because a scene that averages
60 and drops a 40ms frame every second feels far worse than one sitting steadily at 45.

On a local server the profiler records automatically unless `?fps=0` is present. Every session writes
three synchronized files to `Desktop/Portfolio FPS Profiles`: exact per-frame CSV data, an event CSV,
and a summary JSON with percentiles, 1% low, stall counts, the twenty worst frames, and browser/device
context. The event timeline labels camp navigation and loading, player transitions, Unity preload /
create / ready / teardown stages, clicks, visibility changes, browser long tasks, and every frame over
100ms; uncaught errors and rejected promises are recorded as critical events. The on-screen graph uses
the worst frame in each 100ms bucket, keeps about 24 seconds visible,
draws event ticks, and gives multi-second stalls a logarithmic overflow band instead of flattening
everything above 50ms into the same line.

### Screenshotting it

```bash
node tools/shot.mjs hero
node tools/shot.mjs reading "?room=1&travel=1&book=1&reveal=1"
node tools/shot.mjs perf "?fps=1" --wait 14000 --info
```

`--stats` prints region averages of the shot, and `--ref <png>` prints them beside a reference
frame's, with the luminance and saturation deltas flagged. Matching a target frame by eye does not
work across more than about two iterations — the eye adapts to whatever it saw last, so a render
that is three percent too warm looks correct after ten minutes of looking at one that is ten percent
too warm. Put the frame you are matching in `tools/ref/`.

Writes `tools/shots/<name>.png` (gitignored) and prints the `?fps=1` reading if one is on screen.
It drives headless Chrome over the DevTools protocol rather than using `--screenshot`, for two
reasons worth knowing before you "simplify" it:

- `--screenshot` fires on the load event, which for a scene that streams a 2MB glTF and compiles a
  dozen shaders is long before there is anything to look at. It returns a **grey frame** perhaps one
  run in four — and a grey frame is also what a failed shader compile looks like, so the two are
  impossible to tell apart.
- `--virtual-time-budget` fixes that race but fakes the clock, which makes any frame-rate reading
  meaningless.

Do **not** pass `--disable-gpu`. SwiftShader takes minutes per frame on a scene this size.

### The journal

`src/three/campsite/Book.tsx`, the geometry and its textures in `bookGeometry.ts`, the content in
`bookContent.ts` and the typography in `bookPaint.ts`.

**The book is built in code** — boards, spine, gutter, text block and printed pages — not loaded from
a model. It used to be a downloaded glTF of a book frozen open, which meant the closed state had to
be faked by splitting every mesh down the spine, and because that model carried its own page
surfaces, the writing had to be floated on separate quads above them. However fine you tuned the gap,
it read as two lit cards hovering over a book.

Now the printed surface *is* the top face of the text block, so there is nothing to float, and the
closed state is what the geometry does when the hinge rotates. The block's top is a bowed grid: the
paper climbs from the fore edge, crests a little short of the spine and drops into the gutter, which
is most of what makes it read as paper. The fore edge carries a generated ruled-leaves texture, the
boards are extruded rounded rectangles with a bevel, and the cover leather and its blind-stamped rule
are painted on a canvas with the normal map baked from the same image.

Two things that will bite if you change them:

- **Winding.** The block is one geometry with two material groups (printed top, then edges and
  underside), built by hand. Back-facing walls do not look like a winding bug — they let the lit
  inside of the block show through and draw a bright sawtooth along the head of every page.
- **Page aspect.** `PAGE_W / PAGE_H` in `bookPaint.ts` has to match one page's real footprint
  (`PAGE_DEPTH` and the half-width in `bookGeometry.ts`), or the type comes out stretched.

The writing is **painted into the page textures**, not floated in front on a DOM panel. Paper is the
material's colour map and ink is a second, mostly transparent map composited over it inside
`<map_fragment>`, so both are lit by the candles, both take the page's curvature, and the ink can
arrive line by line while the paper is there from the moment the cover lifts. Links are clickable
rectangles that follow the same page curve. Arrow keys or the inked **Next page →** plate turn pages:
one double-sided sheet carries the outgoing page on its front and the incoming one on its back, and
which is showing comes from `gl_FrontFacing` rather than from a uniform the animation has to remember
to flip.

The reading light is **one soft source above the bench**, not the two candles. A point light falls off
with the square of distance and a wick four centimetres from the edge of a page is *close*: driven by
the candles the gutter blew out to white while the fore edge went black.

The journal is always on the bench, open or shut. Arriving and reading are two moves: the cover only
starts lifting once the camera has stopped, and on the way out the camera is pinned in place until
the book has shut, so the closing plays in front of the lens instead of behind a camera already
backing away.

To change what a tent says, edit `bookContent.ts`. It is a flat list of typographic instructions
(`title`, `para`, `fact`, `bullet`, `link`, `rule`, `gap`) that the painter walks once, reporting
link rectangles back as it goes.

### Everything else that is code, not geometry

- **Sky** (`Effects.tsx`) — night gradient, a milky-way band, a painted moon, and the aurora.
  The aurora is **five localised groups of vertical filaments**, each a regional mask in azimuth
  times noise sampled twenty times more finely across the sky than up it, with every column fading
  out at its own height. It used to be a twenty-six-layer altitude march — horizontal planes
  intersected with the view ray and composited front to back — which is the physically honest
  construction and produced *cloud* every time, because summing a noise field along a ray is an
  integral and integrals smooth. The regional masks are what leave clean dark sky between the
  groups; the anisotropy is what makes filaments instead of blobs. It is also about a twentieth of
  the cost: three noise taps per live group against a hundred and thirty octaves of folded
  turbulence per sky fragment, worth about 1.5ms a frame at 1080p.
  **The sky sphere must not be forced to render first.** Left alone, three.js draws it last of the
  opaques and early-Z rejects every fragment with a tree in front of it; with `renderOrder={-2}` the
  shader ran for every pixel on screen and was then painted over.
- **The moon** is painted in the same shader (disc, limb darkening, maria, two-stage halo) rather
  than being a billboard. `MOON_DIR` is where it is drawn and `MOON_LIGHT` is where the key light
  comes from: deliberately different vectors, because a light at the moon's real elevation strikes
  the clearing at fifteen degrees and the camp goes black, while the shadows still need to fall away
  from the moon's side of the sky.
- **Fog** (`fog.ts`) — height fog, installed by swapping the four `fog_*` shader chunks once at
  module load, so every material three.js compiles afterwards picks it up. Stock fog is
  distance-only: it tints a tree's canopy by as much as its roots, so turning it up far enough to
  sink the treeline also veils the tents and the sky. This modulates the exp2 term by the fragment's
  altitude, breaks it into banks with two octaves of noise, and gates it off entirely inside 26
  metres — the camp is never fogged and there is no fog *front* crossing anything the eye is reading.
  An earlier attempt used stacked horizontal mist sheets and had to be abandoned: a sheet the camera
  draws level with fills the frame, and every sheet that intersects a tent draws a line across it.
- **Fire** (`fire.ts`) — a procedural flame shader rather than a sprite, so the *silhouette* moves:
  rising turbulence bends the tongue and eats the tip while the core stays hot. The same material at
  a finer noise scale drives the tent torches, and the smoke is the same idea with a dissolve.
- **Orbs** — additive points with a blown-out core, a saturated body and a wide halo. A single
  gaussian read as a flat bead; the hard core is what feeds bloom and turns them into little lamps.
  On-screen size is capped at 30 CSS pixels and the size spread is deliberately narrow: with a wide
  one the big orbs sat at the cap right across the clearing, stopped shrinking with distance, and
  read as a foreground layer.
- **Ground** (`parallax.ts`) — the circle round the fire is **trodden earth**, the pack's dirt maps
  tiled onto a disc with an irregular alpha rim so it runs out in tongues rather than ending on a
  perfect circle. It was a generated cobble walkway; a laid circle of setts in the middle of a wood
  reads as civic landscaping rather than as a camp somebody made. Parallax-occlusion mapped rather
  than normal-mapped: this disc is the biggest unbroken surface in frame and it is seen at a low
  angle, where a normal map only shifts shading and the ruts have to actually occlude. The patch
  assumes a flat +Y surface whose UVs run along world +X and -Z, which lets the tangent frame be a
  constant instead of screen-space derivatives. The dirt's own roughness map is deliberately *not*
  wired up: the pack authors it for a daylit terrain shader and its gloss under a point light a metre
  off the ground reads as a pond with the fire reflected in it.
- **Contact shadows** — painted dark patches under the tents, benches, torches and every trunk. The
  moon's shadow map covers the whole camp at about three centimetres a texel, which at the foot of a
  wall is not enough to draw the line where canvas meets ground, and that line is what decides
  whether a prop is standing *in* the clearing or hovering above it.
- **Treeline** — the pack's own billboard bakes, cooled toward moonlit blue with a trace of emissive,
  and a dark ridge band faded out along its top edge behind them. Without the ridge the bakes read as
  floating canopies: their trunks are thin, the fog eats them well before the leaves, and the ground
  at that distance has already faded to the same value as the sky. A few very faint additive haze
  banks stand between the camp and the wood — the height fog can tint geometry by distance but it
  cannot put anything *between* two objects, so without them the near wood and the far wood met at a
  hard edge.
- **Foliage is Lambert, not Standard** — a leaf card has no normal map and no roughness map, so the
  only thing `MeshStandardMaterial`'s specular lobe can do with it is lay a flat colourless sheen
  across the canopy. Summed over four directional lights that sheen was brighter than the leaf's own
  diffuse: the wood rendered pale silver-blue whatever the autumn tints were set to, and darkening
  the albedo did nothing at all. Worth remembering the next time a surface refuses to take a tint.
- **Wind and firelight** (`wind.ts`) — patches the kit's own materials through `onBeforeCompile`
  rather than replacing them, so textures, normal maps and alpha cutout survive. Phase comes from
  each instance's translation, so grass ripples instead of swaying in unison; a root-to-tip gradient
  and a tight falloff around the fire carry the colour. `window.__windShaders` in dev confirms the
  patch compiled.
- **Hover glow** (`glow.ts` + the `Outline` pass) — a Fresnel rim, a flat term, and a matching
  emissive lift on the fabric, with a blurred neon outline traced round the hovered tent on top. The
  rim cannot do this on its own: a tent is flat panels squarely facing the camera, so almost no
  fragment has any rim to speak of, and the result was a tint rather than a light. **The outline pass
  has to be handed the meshes, not the group** — it marks what it is given onto its own layer and
  re-renders through a layer mask, and a Group is never drawn, so selecting the parent silently
  outlines nothing.
- **UI** (`src/components/CampUI.tsx`) — name block with ember drift, click hint, and an ember cursor
  with a particle trail, all on one canvas. Tent labels carry a hollow chevron and a bead trail down
  to the doorway, both in the tent's own neon colour, and hovering either the label or the tent
  lights both.

The three tents share the supplied Meshy A-frame mesh, re-exported by
`tools/split-aframe-materials.py` with real `AFrame_Cloth` and `AFrame_Wood` material primitives.
The cloth no longer samples Meshy's contaminated colour, normal, or packed roughness atlases. It
uses one warm off-white colour plus the same object-space triplanar plain weave on every shell, so
the texture stays continuous and identical across all three tents. The beams and knots retain their
authored atlas on the separate wood primitive.

### Rebuilding the campsite assets

Only needed if you change which meshes are used. Requires Blender (tested on 4.4) at the path
hard-coded below.

```bash
node tools/prep-textures.mjs
```

```
"C:\Program Files\Blender Foundation\Blender 4.4\blender.exe" --background --factory-startup --python tools/export-campsite.py -- tools/build/campsite-kit.glb
```

```bash
node tools/fix-alpha.mjs tools/build/campsite-kit.glb public/models/campsite-kit.glb
```

```bash
node tools/strip-kit.mjs public/models/campsite-kit.glb
```

The last step is not optional. `export-campsite.py` exports the whole prop set so the camp can be
re-dressed; `strip-kit.mjs` then drops everything the scene does not actually place and prunes what
that orphans. On the current layout that is 85k triangles and 83 textures down to 31k and 40, and
4.2MB down to 2.0MB. **Its keep list has to be updated whenever the scene starts placing a new
mesh**, or the shipped kit will not contain it.

```bash
node tools/upres-textures.mjs
```

Optional, and run *after* the four steps above because it patches the shipped GLB in place.
`prep-textures.mjs` sizes every map for how the prop is usually seen — across the clearing, where 512
is more than the frame resolves. The camp bench is not seen that way: the journal lies on it and the
reading camera sits sixty centimetres above, so this lifts that one set back to 1024 from the pack's
originals without another Blender run. The other half of the same problem is filtering — every kit
texture gets `anisotropy` in `useKit`, because glTF textures arrive at 1, which is what makes any
surface seen at a glancing angle read as a low-resolution texture whatever size the map is.

The journal has no asset step: it is generated in `bookGeometry.ts` at load time.

Gotchas the pipeline exists to handle, all found the hard way:

- **`mesh.materials.clear()` flattens polygon material indices to 0.** That silently merged every
  tree's trunk and leaf slots into one, so leaves rendered as opaque bark-textured squares. The
  script assigns materials in place instead.
- **Blender 4.2 removed `blend_method = 'CLIP'`**, which the glTF exporter read to emit
  `alphaMode: MASK`. Without it foliage exports OPAQUE — hence `tools/fix-alpha.mjs`, which sets the
  mask and cutoff on the foliage materials after export.
- **The pack's fire, smoke, dust and cloud sprites are single-channel masks** — black RGB with fully
  opaque alpha — so on a quad they render as dark boxes. Those effects are shader-generated instead,
  and the sprites are no longer prepped or shipped.
- **The pack mixes units.** The tent arrives 978 units wide, a tree arrives 24. Applying the
  importer's transform bakes its unit scale, which normalises both to metres.
- **Zeroing the imported rotation breaks the axis fix.** Blender's FBX importer adds a correction
  rotation; discard it and the glTF exporter rotates a second time, standing benches on end. The
  script applies the transform instead.
- **Tent_01's doorway faces Blender +Y**, which the glTF conversion turns into -Z — away from the
  camera. `TENT.flip` turns the body around; everything else is positioned in the group's own space,
  so it is unaffected.

**Licence note:** the converted meshes and textures ship in `public/models/` and are downloadable by
anyone visiting the site. The Unity Asset Store EULA covers using the pack inside your own product,
not redistributing the assets themselves. What is extractable here is a decimated, lossily
recompressed subset rather than the source pack, which is the usual position for a portfolio site —
but it is your call, and worth a re-read of the licence before this goes live.

### Tuning the scene

Scroll drives the scene through `src/lib/scroll.ts`, which keeps a smoothed 0→1 progress value
outside React (a 60fps re-render to move a camera would be silly). Useful knobs:

- Scroll length of the hero: `.hero--camp { height: 260vh }` in `global.css`. Longer = slower.
- Damping: the `k` value in `attachScrollDriver`. Lower = heavier, more lag.
- Layout: `TENTS`, `FIRE_POS`, `BOOK_LOCAL` and `BOOK_WIDTH` at the top of `CampHero.tsx`.
- Walk-in: the three legs in `CameraRig`. The middle one has to keep the camera under the tent's
  lintel — ray-casting the mesh along its own centre line puts that at about 1.22m, so anything at
  1.30 hits the canvas and anything at 1.15 reaches the back wall.
- Density: the counts in the `scatter` memo, and the props passed to `<Fireflies>` and `<Leaves>`.
  Grass is split unevenly between two clumps on purpose — `GrassA` is 40 triangles and `GrassB` is
  200, so the cheap one carries the density.
- Reading pose: `READ_BACK` and `READ_RISE`. The distance is set by the page rather than the pitch —
  closer than about 0.8m the open spread is deeper than the frame is tall and the foot of both pages
  gets cropped.
- Grade: `Bloom`, `ToneMapping`, `HueSaturation`, `BrightnessContrast`, the split tone in `grade.ts`
  and the `Vignette` at the bottom of `CampHero`. **The tone mapping has to be an effect in the
  chain, not a renderer setting** — `<EffectComposer>` writes `gl.toneMapping = NoToneMapping` when
  it mounts, so `state.gl.toneMapping = ACESFilmicToneMapping` in `onCreated` only applies on the
  `?post=0` path. Without an operator in the chain the half-float buffer went straight to an sRGB
  encode, which clamps *per channel*: firelit grass ran red past 1 while green was still climbing
  and rendered as a flat screaming crimson, and the moon came back as a featureless grey disc with
  every crater clipped off the top. Both are missing-shoulder artefacts, not lighting faults.
  `BrightnessContrast` pivots on 0.5 and nearly everything in this frame is below that, so its
  contrast term is mostly a subtraction — past about 0.1 it drives the weak channel of warm-lit
  surfaces through zero. There is deliberately **no chromatic aberration and no film grain**: the
  dispersion softened every tree silhouette and the grain sat as speckle over the dark half of the
  frame, and together they read as a low-quality render rather than as an effect.
- Matching a reference frame: put it in `tools/ref/`, then `node tools/shot.mjs <name> --ref
  tools/ref/target.png` for region averages and `node tools/probe.mjs <png> '[["name",x,y,r]]'` for
  point samples of a specific feature — a disc, one curtain, the sky two degrees off the limb.
  Region means cannot see any of those; they are a thousandth of the frame each.
- Split tone (`grade.ts`) — cool tint into the shadows, warm into the highlights, keyed on luminance.
  The stock passes cannot do this: pushing the frame bluer for moonlit shadows also pulls the fire
  blue, and warming it back warms the shadows to brown again. **The pass runs on the composer's
  linear buffer, before tone mapping**, where a lit surface is a value like 8 and a dim one 0.03 —
  so it may only *add*. An earlier version also carried a saturation term written the usual way,
  `mix(vec3(luma), rgb, k)` with `k > 1`; at those magnitudes that subtraction drove the channels
  below the mean straight through zero and clipped the entire warm half of every frame to black,
  while the highlights survived. The same line after tone mapping would have been unremarkable.

### Frame budget

Everything in the scene is lit by a forward renderer, so **every point light is evaluated for every
fragment of every lit material**, whether or not it reaches. Six torches, six candles and three
lanterns meant sixteen point lights being summed across a full-screen ground plane. The lights are
now culled by state — outside, each tent keeps its two torches; once the camera is inside one, the
other two tents go dark and the reading light comes up — which is seven instead of sixteen.

Two other things that mattered more than they look:

- **Damping is frame-rate independent** (`damp()` in `src/lib/scroll.ts`). `x += (target - x) * k`
  with a constant `k` is a different filter at every frame rate, so a scene that drops frames also
  feels *mushier* rather than merely slower. It is also why the walk-in used to clip the doorway: the
  camera trailed its target by half a metre, so it was still coming down as the target passed under
  the lintel. The duck is now a flat plateau across the opening rather than a dip.
- **Render scale adapts.** `PerformanceMonitor` walks the dpr cap between 1 and 2. It is passed as a
  range, not a number — a bare `dpr={1.75}` makes R3F render at that ratio whatever the display is,
  which on an ordinary 1x monitor is supersampling nobody asked for.

---

## Pages

**Landing** (`/`) — the campsite, then the plain-HTML version of the same material for anyone who
scrolls past it: bio, stats, a selected-work strip, experience timeline, skills, education. Content
comes from `src/data/profile.ts`.

**Gameplay** (`/gameplay`) — Unity WebGL player, controls table, build notes. See below.

**Projects** (`/projects`) — filterable grid of games and tools. Search across title, tech, platform
and tags; filter by type, platform, and multi-select tags; four sort orders. Every filter is stored
in the URL, so a filtered view is a shareable link. `/` focuses the search box, Escape clears it.

**Project detail** (`/projects/:slug`) — overview, what-I-built, technical notes, metrics panel,
stack, tags (which link back into a filtered grid), gallery, and prev/next paging.

---

## Editing content

Everything lives in two files. No component edits needed.

- `src/data/profile.ts` — name, tagline, stats, experience, education, skills.
- `src/data/projects.ts` — every card and every detail page. The `Project` interface at the top of
  that file documents each field.

### What is real and what is placeholder

Real, from your résumé: all six game entries, the platform lists, and the Realistic Hajwala metrics.

**Placeholder — rewrite these:** the five `tool` entries (Level Prototyping Toolkit, Build Pipeline
Automation, Performance Audit Window, Gameplay State Machine Framework, Playable Ad Exporter). They
are written to be plausible for someone with your résumé, and each one's `overview` starts with a
`PLACEHOLDER CONTENT` marker so you can find them fast. Swap in your actual editor tools. Gallery
captions across all projects are placeholders too.

### Adding images and video

Projects with no `thumb` get generated placeholder artwork, seeded from the slug so it is stable and
distinct per project. To use real media, drop files in `public/media/` and set:

```ts
thumb: '/media/hajwala-cover.jpg',
video: '/media/hajwala-clip.mp4',          // optional, plays on the detail page
gallery: [{ caption: 'Night cruise', src: '/media/hajwala-01.jpg' }],
```

Card media is 16:9, the detail hero is 21:9, gallery items are 16:10.

---

## Unity WebGL build

The Gameplay page probes for a build on load and shows an honest "no build installed" panel until
one exists. Drop your build into `public/unity/Build/` and it appears — no code change.

Full instructions, including the Unity build settings that matter (compression, stripping, data
caching) are in [`public/unity/README.md`](public/unity/README.md).

Two gotchas worth knowing up front:

- Brotli `.unityweb` builds are supported by the Vite dev/preview servers. The response-header
  middleware in `vite.config.ts` supplies the encoding and MIME types Unity requires; `public/.htaccess`
  carries the equivalent settings to an Apache/cPanel deployment.
- `public/unity/Build/WebGL.data.unityweb` is intentionally gitignored because it is 244 MiB.
  GitHub Pages cannot serve Git LFS objects, so the payload lives in the `unity-webgl-v1` GitHub
  Release. The Pages workflow downloads it before the production build and publishes it in the
  same-origin site artifact. The loader, framework, and WebAssembly files stay in normal Git.

---

## Deploying to ahmadbilto.com

```bash
npm run build
```

Upload the contents of `dist/` to the site root. `base` is already `/` in `vite.config.ts`.

Because this is a client-routed SPA, the host must serve `index.html` for unknown paths, or a direct
hit on `/projects/realistic-hajwala` 404s.

- **Apache / cPanel** — add `.htaccess` next to `index.html`:

  ```apache
  RewriteEngine On
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
  ```

- **Netlify** — a `_redirects` file containing `/*  /index.html  200`.
- **Vercel** — works out of the box.
- **GitHub Pages** — this user-site repository deploys from `.github/workflows/deploy-pages.yml`.
  It downloads the Unity release payload, builds the app, and uploads `dist/`. `public/CNAME`
  preserves `ahmadbilto.com`, while `public/404.html` returns direct SPA routes to the app.

The résumé is served from `public/Ahmad-Bilto-Resume.pdf`; replace that file when you update it.

---

## Notes

- The campsite is `React.lazy`-loaded, so the initial JS payload does not include three.js for
  anyone landing on `/projects`.
- `prefers-reduced-motion` is respected: scroll damping is bypassed and reveal animations are
  disabled.
- Accessibility: skip link, focus-visible rings, labelled controls, `aria-pressed` on the filter
  toggles. Placeholder artwork carries alt text describing what it stands in for.
