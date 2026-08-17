# Performance pass — every change, and how to undo any of it

Date: 2026-08-15

The brief was to make the campsite scene faster **without changing what it looks
like**, and to put a loading screen in front of it. Every change below is either
proven pixel-identical against a screenshot diff, or is a new thing on screen
before the scene starts (the loading screen). Nothing in the composition,
lighting, colour, geometry, copy or interaction has moved.

Each section says what changed, why, what it measured, and exactly what to put
back to revert it on its own. Nothing here depends on anything else here.

---

## How this was measured

Two harnesses, both driving headless Chrome over the DevTools protocol against
the **production** build (`npm run build` + `npm run preview`). Dev-server
numbers are not comparable — React's StrictMode double-renders the whole tree,
and `?post=0` renders the scene straight into a multisampled backbuffer, which
inflates every fill cost fourfold.

* **Frame time.** rAF deltas over an 8-second window, reported as a *trimmed
  mean over the fastest 60% of frames*. Headless Chrome drops occasional
  100–500 ms frames that have nothing to do with the scene; a plain mean moves
  more from one of those than from anything measured here.
* **Visual identity.** Five fixed poses (lobby, hovered tent, mid walk-in, the
  reading pose, and the scene with post disabled), captured with the scene clock
  pinned, the render scale pinned, and every DOM layer over the canvas hidden.
  Two captures of the same build are bit-identical, so any difference in the
  numbers below is real.

Test machine: RTX 3060, headless Chrome/ANGLE D3D11, 1600×900.

### Result

| Render scale | Before | After | |
| --- | --- | --- | --- |
| dpr 1.0 (1600×900) | 11.6 – 12.8 ms | 11.2 – 13.2 ms | no measurable change |
| dpr 0.75 (1200×675) | 12.4 – 13.2 ms | 10.2 – 10.4 ms | **~20% faster** |
| dpr 0.5 (800×450) | 11.0 – 12.4 ms | 7.0 – 7.3 ms | **~40% faster** |

Read that shape carefully, because it is the most useful thing in this document:
**before the pass, dropping the resolution barely helped.** Half the pixels came
out the same speed as all of them, which is the signature of a frame that is not
limited by pixels at all. After the pass the scene scales with resolution the
way it should, which means the render-scale ladder in `CampHero` (`PIXEL_BUDGET`
/ `PerformanceMonitor`) can finally do its job on a slower machine.

The headless numbers are noisy and headless ANGLE is slower than a real windowed
context — treat them as relative, not absolute. **The shipped site now carries a
frame-time readout in its top right corner** (see §8), so the real figure can be
read off the real machine rather than inferred from this one.

### Visual diff, before vs after

Mean absolute difference per subpixel, 0–255:

| Pose | Mean | Subpixels differing by >2 |
| --- | --- | --- |
| lobby | 0.004 | 0.02% |
| hovered tent | 0.004 | 0.02% |
| mid walk-in | 0.000 | 0.00% |
| reading pose | 0.000 | 0.00% |
| `?post=0` (dev only) | 0.000 | 0.00% |

The lobby and hover residue is two drifting leaf sprites and a few fireflies
landing a fraction of a frame apart between runs — their position comes from
elapsed frame *count*, and the two builds run at different speeds. Everything
else is identical, on every path including the dev-only one, now that the
drawing-buffer change in §3 has been reverted.

**Nothing about the render scale was touched.** `PIXEL_BUDGET`, `DPR_MIN`,
`DPR_MAX` and the `PerformanceMonitor` bounds in `CampHero.tsx` are exactly as
they were; the scene is rendered at the same number of pixels it always was.
What changed is what each of those pixels costs.

---

## 1. Height fog: the noise now runs only where the fog does

**File:** `src/three/campsite/fog.ts`

The height-fog chunk is pasted into *every* fogged material in the scene, and it
evaluated two octaves of value noise — eight `sin` calls — for every fragment of
every one of them. That result is then multiplied by `fogGate`, which is exactly
zero for anything closer than 26 m. The whole camp, the whole near field, the
ground under it and every prop on it were paying for a number thrown away.

The gate is now computed first and everything else sits inside `if (fogGate >
0.0)`. Same expression, zero case factored out; the branch is on view depth,
which is about as warp-coherent as a condition gets.

**Before**

```glsl
#ifdef FOG_EXP2
  float fogFactor = ...
#endif
float fogH = ...;
float fogBank = fogNoise(...) * 0.68 + fogNoise(...) * 0.32;
fogH *= 0.62 + 0.72 * fogBank;
float fogGate = smoothstep( 26.0, 78.0, vFogDepth );
gl_FragColor.rgb = mix( ..., clamp( fogFactor * fogH * fogGate, 0.0, 1.0 ) );
```

**After** — the same lines, with `fogGate` hoisted above them and the rest
wrapped in `if ( fogGate > 0.0 ) { … }`.

**To revert:** change `if ( fogGate > 0.0 ) {` to `if ( true ) {`, or move the
`fogGate` line back below `fogH` and drop the braces.

---

## 2. Tree trunks are single-sided again

**File:** `src/three/campsite/useKit.ts`

`useKit` forced `THREE.DoubleSide` onto every primitive of `TreeA/B/C`. Leaf
cards need it — they are single quads and vanish from behind without it. Trunks
do not: a trunk is a closed solid, so two-sided is not something you can see,
only something you pay for. With back-face culling off, the far wall of all
seventy-one trunks was rasterised and shaded through a full standard-material
evaluation with fourteen lights in it, then discarded by the depth test.

Slot 0 of a tree in this kit is the bark; every slot after it is leaf cards, and
`treeParts` already sets `DoubleSide` on those explicitly when it rebuilds them
as Lambert.

**Before**

```ts
for (const name of ['TreeA', 'TreeB', 'TreeC', 'GrassA', 'GrassB']) {
  for (const p of part(name)) {
    const m = p.material as THREE.MeshStandardMaterial
    m.side = THREE.DoubleSide
  }
}
```

**After** — the same loop split in two: trees skip index 0, grass is unchanged.

**To revert:** restore the single loop above.

---

## 3. Drawing buffer — tried, measured, **reverted**

**File:** `src/three/CampHero.tsx`, the `<Canvas gl={…}>` prop

**Currently:** `gl={{ antialias: true, powerPreference: 'high-performance' }}` —
i.e. unchanged from before this pass.

This section is kept as a record of something that looked free and was not worth
taking. The change tried was:

```diff
-gl={{ antialias: true, powerPreference: 'high-performance' }}
+gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
```

The reasoning: neither flag should do anything, because the `EffectComposer`
owns the render loop, the scene lands in its own half-float target, and the only
thing ever written to the drawing buffer is one full-screen triangle carrying
the finished frame. Multisampling that triangle has no interior edges to
resolve; nothing shows through an alpha channel because the sky sphere covers
every pixel. The screenshot diff agreed to the bit — lobby, hover, walk-in and
reading poses all at 0.000 against the multisampled build.

**Two reasons it went back anyway.**

*It measured as nothing.* Three runs each at 1600×900 with the render scale
pinned: 10.02 / 10.14 / 10.68 ms with the flags on, 10.35 / 10.36 / 10.64 ms
with them off. The two sets overlap completely — the saving is smaller than the
run-to-run noise. The 4× buffer is allocated but the driver evidently never pays
for it on a full-screen triangle.

*And it was not quite free.* `?post=0` — the dev freeze that pulls the composer
out to look at the raw scene — *does* draw straight into this buffer, and there
the multisampling is the only antialiasing in the pipeline. That is the 2.21%
row in the diff table. This is a scene whose whole subject is silhouettes:
alpha-cut foliage against a night sky. A safety margin on the two flags that
decide how those edges resolve is worth more than a buffer that costs nothing
measurable.

**To re-apply** (not recommended on this evidence): the diff at the top of this
section.

---

## 4. The sky is pinned to the back of the opaque queue

**File:** `src/three/campsite/Effects.tsx`, `NightSky`

```diff
-<mesh scale={[-1, 1, 1]}>
+<mesh scale={[-1, 1, 1]} renderOrder={100}>
```

The aurora march is the most expensive fragment shader in the frame, so the one
thing that must be true of the sky sphere is that it never runs on a pixel the
forest is standing in front of. The comment in the file claimed three.js already
guaranteed that. It does not: `painterSortStable` compares `material.id` *before*
it compares depth, so where the sky lands in the opaque queue is decided by when
its material happened to be constructed — which in practice put it ahead of the
ground plane. `renderOrder` is compared before both.

This only orders it against the other opaques; the transparent queue still draws
after all of them, which is what the haze, the flames and the contact patches
want.

**To revert:** remove `renderOrder={100}`.

---

## 5. Aurora march: per-layer constants moved to the CPU

**File:** `src/three/campsite/Effects.tsx`, `SKY_FRAG`, `auroraLayers`, `NightSky`

Everything in the 26-layer loop that depended only on the layer index was being
recomputed for every pixel of sky: a `pow` for the height, an `exp2` and two
`smoothstep`s for the weight, and a three-component `sin` for the colour ramp.
None of them vary across the frame or across time. They are built once in
`auroraLayers()` now and read from `uHeight` / `uJit` / `uRamp` / `uWeight`.
Same arithmetic, same values, evaluated 26 times a frame instead of 26 times a
*pixel*.

`rot(uTime * spd)` inside `triNoise2d` got the same treatment — it was five sine
and cosine pairs per call across 26 calls, all computing one number — and is now
the `uSpin` uniform.

**Measured:** small on this GPU (a few tenths of a millisecond); the march turns
out to be bound by the turbulence folding rather than by transcendentals. Kept
because it is free and it matters more on hardware with weaker special-function
units, which is most laptops and every phone.

**To revert:** restore the four expressions inside the loop —

```glsl
float fi = float(i);
float height = 0.8 + pow(fi, 1.4) * 0.0052;
float t = (height - 0.0) / (rd.y * 2.0 + 0.4);
t -= 0.006 * dither * smoothstep(0.0, 9.3, fi);
layer.rgb = (sin(1.0 - vec3(2.15, -0.5, 1.2) + fi * 0.115) * 0.5 + 0.5) * rzt;
col += avg * exp2(-fi * 0.065 - 2.5) * smoothstep(0.0, 3.1, fi);
```

— put `dg *= rot(uTime * spd);` back, and delete the four uniform arrays,
`uSpin`, `AURORA_LAYERS`, `AURORA_SPIN` and `auroraLayers()`.

> **See §10 — this change surfaced a latent bug.** `AURORA_SPIN` is 0 rather
> than the 0.03 the shader asks for, and that is deliberate: it reproduces what
> the site has always rendered.

---

## 6. The scatter is frustum-culled

**File:** `src/three/campsite/Effects.tsx`, `InstancedParts`

Every instanced mesh in the scene carried `frustumCulled={false}`. From the
clearing that costs nothing — the whole camp is in shot. It costs a great deal
from *inside a tent*: the camera is forty centimetres from an open book with a
canvas wall behind it, and the entire forest, the entire field and every stone
in the camp were still being submitted, transformed and rasterised behind that
wall. The reading pose is where a reader spends most of their time.

`computeBoundingSphere()` was already being called; the sphere is now inflated by
`CULL_MARGIN` (0.5 m) to cover the wind patch's vertex displacement, which the
bounding sphere cannot know about, and `frustumCulled` is left at its default.

**To revert:** add `frustumCulled={false}` back to the `<instancedMesh>` in
`InstancedParts` and delete `CULL_MARGIN`.

---

## 7. Instances are ordered nearest-first

**File:** `src/three/campsite/Effects.tsx`, `buildMatrices`; call site in
`src/three/CampHero.tsx`, `Scatter`

An `InstancedMesh` draws in buffer order, and these lists were in whatever order
the scatter sowed them — for a field seeded in polar coordinates, a random walk
back and forth through the depth of the scene. Foliage here is alpha cutout: the
shader discards, so the hardware cannot write depth early, but it *can* still
reject early against depth already in the buffer. A blade drawn after the blade
in front of it is rejected before it shades; the same pair in the other order
shades twice.

`buildMatrices` now sorts by distance from a fixed point near the lobby camera,
once, at build time. The image is identical either way — alpha cutout with depth
writes is order-independent — so this changes only what the GPU is *able* to
skip.

`buildMatrices` gained an optional second argument for parallel per-instance
arrays; the tree tint list goes through it, or the colours end up on the wrong
trees.

**Honest note:** this measured as **neutral** on the test GPU. Blades are thin
and do not occlude each other as much as the overdraw suggests. It is kept
because it costs nothing at runtime, cannot change the image, and front-to-back
submission is worth considerably more on tile-based GPUs — every phone, and
Apple Silicon.

**To revert:** drop the `.sort(...)` from `order`, drop the `aligned` parameter
and the block that reorders it, and change the tree call back to
`buildMatrices(g.items)`.

---

## 8. Frame-time readout, top right, always on

**Files:** `src/components/CampUI.tsx` (`FpsMeter`), `.fpsmeter` block at the end
of `src/styles/global.css`

The overlay was gated behind `import.meta.env.DEV` *and* a `?fps=1` parameter,
which means it could only measure a build nobody visits. The production bundle
is a different program — different React, no StrictMode, minified — and it is
the one that is either fast or not.

It is now **on by default in every build**, pinned to the top right corner of
the landing page, and `?fps=0` turns it off. Dressed in the camp's own
furniture — the amber-on-dark pill the sound toggle uses — so a permanent
readout reads as part of the site rather than as a debug overlay somebody forgot
to remove. It hides itself until the first half-second window closes, so there
is never an empty pill.

Read it as `<fps> · <mean ms> · <worst ms>`. The worst-frame figure is the one to
watch: a scene that averages 60 and drops a 40 ms frame every second feels far
worse than one sitting steadily at 45.

It only appears on the landing page, because `CampUI` only mounts there — which
is also the only page with anything to measure.

**To make it opt-in again:** change the `on` condition from
`get('fps') !== '0'` to `get('fps') !== null`. **To take it out entirely:** put
`import.meta.env.DEV &&` in front of that, or drop `<FpsMeter />` from the
`CampUI` return.

---

## 9. Loading screen, preloading and shader warm-up

New: `src/components/CampLoader.tsx`, styles at the end of
`src/styles/global.css`, wiring in `src/pages/About.tsx`, preload tags in
`index.html`, `LoadTracker` and `Warmup` in `src/three/CampHero.tsx`.

### The screen

Deep-navy ground with the fire's glow rising into it, the name in the site's
display face, three ember diamonds breathing, an amber progress rail and a mono
caption. Painted in the *hero's* palette rather than the site's paper one — it
stands in front of a night scene, and a cream screen that turns navy is a flash
in the face.

Three stages, because there are three genuinely different waits and only the
middle one is measurable:

| Stage | Caption | Bar budget |
| --- | --- | --- |
| `boot` | Walking out to the clearing | 0 → 0.18 |
| `assets` | Pitching the tents | 0.18 → 0.86 |
| `compile` | Lighting the fire | 0.86 → 1 |

The bar is driven from a rAF loop writing one `transform`, not from React state
— the whole point of the screen is that the main thread is busy, and a bar that
needs a render pass to move freezes exactly when it is meant to be reassuring.
The follow is eased against *time*, not frames, for the same reason.

Nothing in `CampLoader.tsx` imports three or drei. It has to be on screen while
those chunks are still downloading.

Scroll is frozen while the curtain is up (`html.is-loading`), so a reader who
flicks the wheel during the load does not get the curtain lifted on the middle
of the page. It is held on the `documentElement`, because the tent-entry effect
owns `body.style.overflow` and the two would otherwise restore over each other.

A 20-second timeout (`LOADER_TIMEOUT_MS`) forces the curtain up regardless. A
loading screen that can hang forever is worse than none.

### Preloading

`index.html` now preloads the campsite kit and the eight ground and billboard
textures. Before this, the 2.7 MB glTF was not *requested* until React had
mounted and the hero chunk had parsed — about 1.1 s in on a warm local
connection, and correspondingly worse on a real one. They now start at ~50 ms,
in parallel with the JavaScript.

`crossorigin` on those tags is load-bearing: the GLB goes through three's
`FileLoader` and the textures through `ImageLoader`, which sets `crossOrigin` to
anonymous. Without a matching preload the browser downloads each file twice.
Verified: eleven resource entries, no duplicates.

### Shader warm-up

`<Warmup>` sits inside the Suspense boundary and calls `renderer.compileAsync`
(falling back to `compile`) before signalling ready. Three builds a program the
first time it draws with a material, and this scene has around thirty of them.
Left lazy, that is thirty driver compiles landing in the first couple of seconds
a reader is looking at the camp — and a shader compile is a hard stall on the
main thread, so they land as visible hitches at exactly the wrong moment. Doing
them behind a curtain that is already up costs the same time and is invisible.

**To revert the whole section:** delete `CampLoader.tsx` and the `.camploader`
and `html.is-loading` blocks from `global.css`; remove the `CampLoader` import,
the `stage`/`assetProgress` state and the four effects from `About.tsx`, and the
`onProgress`/`onReady` props from the `<CampHero>` call; remove `LoadTracker`,
`Warmup`, the `useProgress` import and the two new props from `CampHero.tsx`
(the component then returns the bare `<Canvas>` again rather than a fragment);
delete the nine `<link rel="preload">` tags from `index.html`.

---

## 10. Two things found on the way that are **not** fixed

Both are pre-existing, both change what is on screen if corrected, and neither
is a performance matter — so they are reported rather than acted on.

### `uTime` never reaches three of the shader materials

The sky, the stars and the fireflies all set uniforms with the pattern

```tsx
const uniforms = useMemo(() => ({ uTime: { value: 0 }, … }), [])
useFrame((state) => { uniforms.uTime.value = state.clock.elapsedTime })
…
<shaderMaterial uniforms={uniforms} … />
```

and in the running page — in the production build as much as in dev —
`material.uniforms.uTime.value` is **0 forever**. Whatever object ends up on the
material is not the object `useFrame` writes into. (Mutating a `Float32Array`
value works, because the array itself is shared by reference; assigning to a
`{ value: number }` does not.) The flame and smoke materials in `fire.ts` animate
correctly, and they are the ones built imperatively and mutated through the
material.

What that costs today:

* the aurora's octave warp never turns — this is why `AURORA_SPIN` is 0 in §5,
  which reproduces exactly what the site renders now;
* the stars do not twinkle (`vTwinkle` is frozen at its `t = 0` value);
* the fireflies do not breathe (`vGlow` likewise) — they still drift, because
  their positions are written into a geometry attribute rather than a uniform.

**The fix** is to write these through a ref to the material rather than through
the captured object:

```tsx
const mat = useRef<THREE.ShaderMaterial>(null)
useFrame((state) => {
  if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime
})
…
<shaderMaterial ref={mat} … />
```

It is a visible change — three animations that are currently still would start
moving — so it is a decision, not a cleanup. Set `AURORA_SPIN` back to `0.03` at
the same time if you take it.

### The bloom's two top mip levels

`<Bloom mipmapBlur>` runs at eight levels, which is fifteen of the eighteen
render passes the whole frame does. Those passes are not free even when they are
tiny — the cost is nearly all render-target switch and state change rather than
pixels — and they are very tiny at the top: the effect already runs at half
resolution, so on a 1600×900 frame the chain starts at 800×450 and level seven
is 6×3 pixels, level eight 3×1.

Dropping to `levels={6}` measured **~1 ms/frame at 1080p and ~3 ms at 720p**. It
is *not* free visually: those two levels are a broad structureless wash over the
whole frame, and removing them lifts a little of the wide glow off the fire —
0.11 mean subpixel difference on the lobby pose, 0.34 on a hovered tent, with
visible broad structure when the difference is amplified twelve times. Below
what most people would notice; not below what a diff notices.

Left at 8. `BLOOM_LEVELS` in `CampHero.tsx` is the single number to change.

---

## What is left on the table

Ranked by what they would buy, all of them requiring a visible change — which is
why none of them were taken.

1. **Render scale.** Untouched by this pass, and now the biggest lever by a wide
   margin: before the fog and bark changes, halving the resolution bought almost
   nothing, so the render-scale ladder had nothing to trade. It does now. The
   controls are `PIXEL_BUDGET`, `DPR_MIN`/`DPR_MAX` and the
   `PerformanceMonitor` bounds in `CampHero.tsx` — currently a 2.1-megapixel
   budget with bounds of 38–55 fps. Raising the bounds makes the scene walk its
   own resolution down until it hits the target, automatically, per machine.
   This is the only lever that can reach an arbitrary frame rate on arbitrary
   hardware, and it is the one to reach for if the readout in the corner is
   short of where you want it.
2. **Foliage two-sidedness.** Rendering grass and leaf cards single-sided is
   worth ~4 ms each on the test GPU, because roughly half the randomly-oriented
   cards then cull. It is not viable as-is — half the foliage would vanish — but
   it is the largest single cost left in the frame, and a foliage shader that
   flips its own normal on a doubled, wound-both-ways geometry would get the
   look back at the same fragment count.
3. **`BLOOM_LEVELS`**, as above.
4. **Point lights.** Ten of them, evaluated per fragment of every lit surface.
   After the fog change they measure at only ~1.7 ms, so this is no longer the
   headline it looks like — but it is still ten lights on a forward renderer.

---
---

# Second pass — 2026-08-15 (evening)

Four separate complaints, and only one of them was a performance problem. Each
section says what was wrong, what changed, and exactly what to put back to
revert it on its own. Nothing here depends on anything else here.

Measured the same way as the pass above: production build (`npm run build` +
`npm run preview` on port 4173), headless Chrome over the DevTools protocol,
RTX 3060.

**A note on frame-rate numbers in this section.** Headless Chrome alternates
between vsync-locked and free-running from one launch to the next, so a run
reports either a flat 17.63 ms median or a flat 5.89 ms median for the same
build. Only the free-running runs mean anything as a cost measurement, and only
the *long frames* within a run mean anything as a stall measurement. Every
number below is one or the other, never a raw average across runs.

---

## 6. The whole scene was rendering below native resolution

**The complaint.** Everything soft — treeline, grass, the journal's type — as
if the render scale had been dropped.

**It had been.** Not by the previous pass, which genuinely did not touch it, but
by a floor that had been wrong the whole time and only bites on a large window.

```tsx
dpr={[1, dprCap]}
```

reads as a range with a floor of 1. R3F resolves it as
`min(max(dpr[0], devicePixelRatio), dpr[1])` — the **cap is the last word**. So
any `dprCap` below 1 renders below native however high the first element is, and
`pixelBudgetDpr` returned exactly that on any window past the 2.1-megapixel
budget:

| Window (dpr 1) | old opening scale | buffer drawn | then upscaled to |
| --- | --- | --- | --- |
| 1920x1080 | 1.00 | 1920x1080 | native |
| 2560x1240 | 0.96 | 2466x1194 | 2560x1240 |
| 3440x1440 | 0.65 | 2239x937 | 3440x1440 |

Measured directly off `gl.drawingBufferWidth`, not inferred. The
`PerformanceMonitor` then walked it back up in 0.15 steps, so on a 2560 window
the scene sharpened about ten seconds in — and on a wider one, or once
`flipflops` pinned the monitor, never.

**The change.** `DPR_MIN` 0.62 -> **1** in `CampHero.tsx`. Below-native is no
longer a lever the scene can pull; the monitor still has all its room between 1
and `DPR_MAX` (1.6) on a high-density display, which is where the pixels that
actually cost something are.

Verified after the change: 2560x1240 and 3440x1440 both report a drawing buffer
equal to the window from the first frame.

**To revert:** set `DPR_MIN` back to `0.62` and restore the lower clamp in
`pixelBudgetDpr`. Note this is the same lever the "What is left on the table"
section recommends reaching for — it is still there, it just cannot go below
native now.

---

## 7. The 1.9-second freeze on the walk-in

**Found by profiling, not by reading.** A CPU profile across a tent click, prod
build:

```
   1879ms  getProgramParameter
```

That is three.js asking the driver whether a program has finished linking, which
blocks until it has. Programs were still being compiled in the frame the walk-in
starts — despite the load-time warm-up that exists precisely to stop that.

Counted them, by diffing `gl.info.programs` across the click: **seven**. Five
`physical`, one `basic`, one `depth`.

**Why the warm-up missed them.** It runs once, immediately after the kit
resolves. A material's program is keyed on *the set of maps it has*, and several
of this scene's materials do not have their full set at that moment — the
journal's canvases are painted in a layout effect, the bench's contact shadow
arrives on its own promise. A map assigned to an already-compiled material
invalidates its program, and the rebuild then lands wherever the object is first
drawn: the click.

**The change.** `Warmup` in `CampHero.tsx` now schedules the same sweep twice
more, at 1.5 s and 5 s, rendered **into a 4x4 render target**. Every object is
temporarily shown, so lit *and* depth programs get built, and the result goes to
a buffer four pixels across that is thrown away. Nothing reaches the screen —
which is what makes it safe to do after the loading curtain has lifted. It costs
one frame of vertex and draw-call work with essentially no fill, twice.

**Measured**, rAF deltas across a click on the middle tent, prod build:

| | before | after |
| --- | --- | --- |
| worst frame | **1888 ms** | **77 ms** |
| programs linked at click | 7 | 1 |
| long frames (>26 ms) | 88, 1888, 41 | 77, 41, 41 |

The one program left is a depth variant. It is worth about 40 ms and has not
been chased.

**To revert:** delete `warmOffscreen` and the `timers` array in `Warmup`, and
drop the `timers.push(...)` line from `done()`.

---

## 8. The hover highlight was a glowing slab, not an outline

**The complaint.** Hovering a tent lit the whole tent — fabric, stripes, trim
and doorway all gone into one block of colour. The reference is a neon *edge*.

**Why the old approach could not get there.** It was a Fresnel rim, and a
Fresnel term is bright where a surface turns away from the eye. A tent is four
flat panels pointing more or less at the camera; there is no grazing angle
anywhere on it except a pixel or two at the silhouette. So the term had been
widened until it was visible — `pow(rim, 0.62) * 6.0` plus a flat `0.7` — and a
0.62 exponent barely falls off at all while a constant does not fall off by
definition. Both are the whole face.

**The change.** Two parts.

1. **`campsite/outline.ts` (new).** An inverted hull: the tent's own geometry
   drawn a second time, vertices pushed 0.034 object units along their normals,
   back faces only, additive, no depth write, not tone-mapped. Where the swollen
   copy is behind the real tent the depth test discards it; where it pokes past
   the silhouette it survives, as a band of constant width running over the roof
   ridge, down the poles and along the guy ropes. Colour is driven to 7x so the
   bloom pass already running throws the halo.

   Chosen over the post-processing `Outline` effect, which draws the same
   picture and costs a depth pre-pass, a mask render and a two-stage blur on
   *every* frame the scene ever renders, for something on screen a second at a
   time. This is **one extra draw per hovered tent and nothing at all otherwise**
   — the shell group is `visible = false` below a strength of 0.004, and a
   hidden object still gets its program built by `Warmup`, which walks with
   `traverse`.

2. **`campsite/glow.ts`.** The rim is now tight and does nothing else:
   `pow(rim, 2.2)` and `rim * 20.0`, with the wide term and the flat pedestal
   gone. It is a soft sheen on the fabric under the hull, not the highlight.

   And in `CampHero.tsx`, the matching emissive lift on the tent materials came
   down from `glowNow * 0.11` to `glowNow * 0.018` — that term is a uniform wash
   on every panel, which is the one thing that cannot draw an edge.

**To revert:** restore the single line in `glow.ts` to
`gl_FragColor.rgb += uGlowColor * uGlowStrength * (pow(rim, 0.62) * 6.0 + rim * 16.0 + 0.7);`
with `rim = pow(rim, 2.2)` above it, put the emissive multiplier back to `0.11`,
and delete the `<group ref={shellGroup}>` block, the `shell` memo, the
`shell.set(...)` lines and the `outline.ts` import. `outline.ts` is standalone
and can be left in place.

---

## 9. Lighting

Art change, requested against a reference frame — a brighter, warmer camp with a
treeline that reads as foliage rather than as a black mass. **This is the one
section here that deliberately changes what the scene looks like.** All of it is
the `NIGHT` block at the top of `CampHero.tsx`.

| | before | after |
| --- | --- | --- |
| `moon.intensity` | 1.55 | 2.45 |
| `rim.intensity` | 0.5 | 0.82 |
| `hemisphere.ground` | `#05070f` | `#080b14` |
| `hemisphere.intensity` | 0.2 | 0.48 |
| `ambient.intensity` | 0.05 | 0.085 |
| `fog.density` | 0.0142 | 0.0100 |
| `exposure` | 1.0 | 1.1 |
| `grassWarm.fireRadius` | 4.2 | 4.6 |
| `grassWarm.torchRadius` | 2.3 | 2.8 |

Costs nothing measurable — these are uniform values, not passes. The warning at
the top of the `NIGHT` block still stands: ambient is the knob that greys out
the shadows, and it is the one that moved least on purpose.

**To revert:** put the "before" column back. Nothing else reads these values.

---

## 10. Tried and rejected: deferring the page-turn repaint

A page turn costs three full 796x1180 canvas paints and three texture uploads,
all in the frame the click lands in, and it measures as **one 70 ms frame**.

Only two of the three are strictly needed in that frame — the block underneath
the lifting sheet is still fully covered at t=0 — so painting it on the next
animation frame should have taken a third out of the spike. It did not: 82 ms
and 70 ms across two runs against a 70 ms baseline, which is noise. The cost is
somewhere other than that paint, and the change was reverted rather than left in
as an unmeasured behavioural risk.

Worth knowing if anyone picks this up: the remaining candidates are the two leaf
textures (about 7.5 MB of upload that genuinely cannot be deferred) and the
`setHits([])` React commit in the same frame. The paint itself did not show as a
distinct block in a 200 microsecond-interval CPU profile.

---

## Also fixed in passing

Two pre-existing TypeScript errors that were failing `npm run build`:
`gl.info.programs` is nullable, so `.length` on it needs `?.length ?? 0`. Two
sites, both in `Warmup`'s dev-only diagnostics. Without this the build did not
complete at all.

---
---

# Third pass — 2026-08-15 (late)

Three changes. Costs nothing measurable: the lobby frame time is 5.89 ms median
before and after, over four runs each (free-running headless, 1920x1080, prod
build). Everything here is either a uniform value or one level of indirection on
a write that was already happening.

---

## 11. `uTime` never reached the sky, the stars or the fireflies — fixed

Flagged in §"What is left on the table" of the first pass and left as a decision.
Taken now.

**Proved, not assumed.** With the frame callback writing both the memoised
uniforms object *and* a window global, on the running dev scene:

```
{"skyTick":13.025, "matUTime":0, "sameObject":false, "sameSlot":false}
```

`<shaderMaterial uniforms={…}>` does not hand three the object it is given. The
uniforms are deep-cloned on the way in, so the material ends up with its own
`{ value }` slot for every entry and a write to the memo lands nowhere. Same
result for the star field and the firefly points, which are written the same
way. The flames and the smoke were never affected — `fire.ts` builds its
materials imperatively and mutates them through the material itself, which is
exactly the shape of the fix.

**The change**, in `campsite/Effects.tsx`. Each of the three components now
holds a `useRef<THREE.ShaderMaterial>` on its `<shaderMaterial>` and writes
`mat.current.uniforms.<name>.value` instead of writing the memo:

* `NightSky` — `uTime` and `uSpin`
* `Stars` — `uTime`, and `uPixelRatio` in its layout effect
* `Fireflies` — `uTime`, and `uPixelRatio` in its layout effect

The memoised object stays as the initial value handed to the material; it is
just no longer the thing anyone writes to afterwards.

`AURORA_SPIN` back to **0.03** — the value the shader always asked for — now
that the uniform carrying it arrives. Verified live: `uTime` advances on all
three materials and `uSpin` reads a real rotation matrix rather than identity.

**What now moves that did not before:** the aurora's octave warp turns, the
stars twinkle on their own phases, the fireflies breathe.

**To revert:** set `AURORA_SPIN` back to `0` for a still aurora while keeping
the twinkle. To go all the way back, drop the three `ref={mat}` props and point
the writes at the memo objects again.

Note `uPixelRatio` had the same bug and so has been pinned at 1 the whole time.
On a 1x display that is the correct value anyway; on a 2x display the stars and
fireflies were drawing at half the intended point size, and now will not.

---

## 12. Hover outline turned down

Same mechanism as §8, lower numbers. The band was reading as a lit tube rather
than as a line.

| | §8 | now |
| --- | --- | --- |
| `uThickness` (`campsite/outline.ts`) | 0.034 | 0.028 |
| shell colour gain | 7.0 | 4.0 |
| Fresnel rim gain (`campsite/glow.ts`) | 20.0 | 11.0 |

The rim is the term that sat on the fabric *inside* the outline, so it came down
proportionally more — the highlight should be the edge, and the face under it
should stay a tent.

**To revert:** the "§8" column.

---

## 13. The trees

**The complaint:** you can barely see them. Not the fog — the fog term is gated
off entirely inside 26 m and the near wood is well inside that. It was the
canopy's own sky floor.

Every tree in frame is back-lit: the moon is behind the camp, so the face
turned toward the lens receives the hemisphere term and nothing else, which is
why `useKit.ts` gives the leaf material an emissive floor in the colour of the
sky. That floor was set dark enough that the whole wood collapsed into one flat
navy mass with no canopy texture in it.

| `useKit.ts`, leaf material | before | after |
| --- | --- | --- |
| `emissive` | `#1a3059` | `#213f6b` |
| `emissiveIntensity` | 0.55 | 0.68 |

Deliberately modest, and deliberately still routed through `emissiveMap` rather
than flat. A constant emissive is the same value on every fragment of the
canopy, which fills the silhouette in and turns fifty trees into fifty cutouts —
an intermediate try at `#274a7d` / 0.8 did exactly that, and was backed off. At
these values the leaf map still modulates it, so the canopy keeps its shape and
the per-instance autumn tints still read.

**To revert:** the "before" column. Nothing else reads these.

---
---

# 14. The hover wash that only existed in production

Reported as "4173 still has the old changes". It did not — the served bundle was
current, verified by fetching the hashed chunk over HTTP and finding the new
shader text in it. What was actually happening is worse and more useful to know
about: **the development build and the production build were rendering the tent
highlight differently, from identical scene state.**

## What it looked like

| | dev (5175) | prod (4173) |
| --- | --- | --- |
| hovered tent fabric | dark, edges only | roof washed pale cyan, doorway blown white |

## How it was found

Not by reading. `window.__camp` was temporarily un-gated from `import.meta.env
.DEV`, prod rebuilt, and the same probe run against both servers with the mouse
parked on the middle tent. Scene state came back **identical** — same shell
strength (1.12 vs 1.11), same fourteen light intensities, same material colours,
same `emissive`, same `side`. One number differed:

```
uGlowStrength   prod 1.208     dev 0
```

read off the compiled program through `gl.properties.get(material)`.

## Why

The Fresnel rim's uniform handles were built inside the `parts` memo and stashed
on a ref:

```tsx
const list = tintParts(kit.parts(TENT.node), …)   // clones the materials
glowRefs.current = list.map((p) => applyRimGlow(p.material, neon))
```

React's StrictMode runs that memo **twice** in a development build. Two sets of
cloned materials get made; the meshes on screen use one and the handles on the
ref belong to the other, so every write went to materials nobody was drawing.
Dev therefore showed a clean tent — and the production build, with StrictMode a
no-op and only one set of clones, showed the rim doing its worst.

Which means the entire §8 tuning pass, and the §12 reduction after it, were
judged from dev screenshots in which the rim contributed **exactly nothing**.
The hull was doing all the work in every picture that got approved, and the rim
was an unseen extra term waiting in the production build. That is the real
defect here; the wash was only its symptom.

## The change

The Fresnel rim is gone from the tent path. `applyRimGlow` is no longer called
and `glowRefs` is replaced by a plain `glow` ref carrying the damped 0-1
strength, written straight onto the materials the meshes are actually using.
What draws the outline is the hull in `campsite/outline.ts` — which is what has
been drawing it all along.

`campsite/glow.ts` is left in the tree, unreferenced and tree-shaken out of the
bundle, because the Fresnel approach is worth keeping documented alongside the
reason it does not work on flat panels.

Verified on the **production** build at the same pose that showed the wash: dark
fabric, edges only, matching the approved dev frame. 170 fps / 5.9 ms.

**To revert:** restore the `applyRimGlow` import and the `glowRefs` ref, put the
`glowRefs.current = list.map(…)` line back in the `parts` memo with `neon` in its
dependency array, and drive `glowNow` through the handles again. Be aware that
reverting also restores the dev/prod divergence.

## The general lesson

Anything built inside a `useMemo` and stashed on a ref during render is
unreliable under StrictMode, and unreliable *in a direction that hides the bug
during development*. The scene has one other structure of this shape —
`useKit`'s `leafCache` / `grassCache` and the wind uniforms they register — but
those are self-contained: the material registers its own uniforms and no outside
code writes to them, so a duplicate set is inert rather than wrong. It is worth
re-checking if anything new starts writing to them.

## Tooling

`tools/shot.mjs` gained two flags while chasing this, both useful generally:

* `--hover x,y` — dispatches a pointer move at a fraction of the viewport before
  capturing, so hover states can be screenshotted on the **production** build
  where the `?hot=` freeze does not exist.
* `--scroll <px>` — scrolls the page before capturing.
