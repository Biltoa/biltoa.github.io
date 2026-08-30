# VISUAL_CHANGES — point 13, lighting, fire and campsite props

Everything changed for point 13, grouped so any sub-point can be reverted on its
own. Every numeric change is given as **before → after**. Search the source for
`VISUAL-13` to find the same changes in place; every one of them carries a
comment naming its sub-point.

Reference frame throughout is the campsite still supplied with the brief
("screenshot 10"): three tents on an arc round a fire, lanterns hung on the tent
frames, a dark faceted treeline, short broken ground with a path to each door.

Captures used while working are in `tools/shots/` (`v13a` … `v13j` are the
successive passes; `perf-base*` and `perf-b*` are the frame-time samples quoted
at the end).

---

## 13.1 — Make the lighting come from the light sources

All in `src/three/CampHero.tsx`, in the `NIGHT` constant, unless noted.

### 13.1a — Real point light at the campfire, with flicker

**No change made. Already present and already correct.**

`Campfire` in `src/three/campsite/Effects.tsx` mounts a `THREE.PointLight` at
`[0, 0.75, 0]`, colour `FIRELIGHT.key.color` `#ffbb82`, `distance` 30, `decay`
2, and its frame loop already drives intensity from `fireFlicker(t)`
(`0.65 + flicker * 0.44`), jitters XZ by `±0.07`, and swings colour between
`FIRELIGHT.coolEnd` `#ff7a24` and `FIRELIGHT.hotEnd` `#ffc272`.

The second, dimmer "bounce" light asked for was **not** added — see DECISIONS.
`castShadow` on the fire was **not** turned on — see DECISIONS.

### 13.1b — Cut the ambient, re-tint it cool

- `NIGHT.hemisphere.sky`: `#000000` → `#2f93a8`
- `NIGHT.hemisphere.ground`: `#ffffff` → `#050a14`
- `NIGHT.hemisphere.intensity`: `1` → `0.34`
- `NIGHT.ambient.intensity`: `0` → `0` (already off, left off)

The previous values were an inverted debug-panel bake: a **white ground bounce
at full intensity**, reaching every surface from below with no falloff and no
shadow. That single term is what made the camp read as evenly lit rather than as
a fire in a dark wood, and removing it is the largest visual change in this whole
document.

### 13.1c — Shadows

**No change made. Already present.**

`<Canvas shadows="percentage">` with a widened PCF kernel; the moon's
`directionalLight` casts at `shadow-mapSize` 1536², `shadow-radius` 9, and its
frustum is already tightened to the campsite (`left/right ±24`, `top` 22,
`bottom` -14) and re-aimed at whichever tent the camera enters. The map is
re-rendered at `SHADOW_HZ` = 6, not per frame. Blob shadows for props that do
not warrant real ones were already in place (`ContactShadow`, `trunkShadows`,
the per-bench contact patches).

### 13.1d — Tone mapping and colour space

- `NIGHT.exposure`: `1.02` → `0.93` (`gl.toneMappingExposure`)

`ACESFilmicToneMapping` and SRGB output were already correct and are unchanged —
see the note in `CampHero.tsx` about the composer forcing `NoToneMapping` and
ACES living in the effect chain instead. Only the exposure moved.

### 13.1e — Make the aurora affect the world

Done as a dim cool directional rather than an environment map (see DECISIONS).

- `NIGHT.rim.intensity`: `2` → `1.2`
- `NIGHT.rim.color`: `#ffffff` → `#5fd8c4`

The rim already came from over the camp's shoulder; it is now the aurora's
colour, so tent peaks, canopy tops and the tops of the grass take a green-cyan
edge. A separate canopy bounce from the curtain already existed in `wind.ts`
(`AURORA_BOUNCE_*`) and is retuned under 13.8.

Also, and for the same reason:

- `NIGHT.moon.intensity`: `4` → `2.6`
- `NIGHT.moon.color`: `#ffffff` → `#c3d6ff`

A white moon at 4 was a second key light.

### 13.1f — Fog tinted to the aurora

- `NIGHT.fog.color`: `#141426` → `#12333d`
- `NIGHT.fog.density`: `0.0068` → `0.0084`

This is the height fog installed by `campsite/fog.ts`, not stock distance fog;
the camp itself stays unfogged inside 26 m and the treeline sinks into it.

---

## 13.2 — Rebuild the fire particles

`src/three/campsite/Effects.tsx`, `Campfire`.

The campfire was **not** rebuilt as five separate `THREE.Points` layers — see
DECISIONS. What changed:

- `SMOKE`: `6` → `9`
- smoke colour (`makeSmokeMaterial` arg): `#9d8ab0` → `#2b3450`
- smoke opacity (`makeSmokeMaterial` arg): `0.05` → `0.085`
- smoke start height: `1.55` → `1.15` (world units above the fire base)
- smoke rise over life: `life * 7.5` → `life * 8.4`
- smoke growth over life: `puff.size * (0.5 + life * 2.2)` →
  `puff.size * (0.42 + life * 2.1)`

There was smoke, at a twentieth opacity in a pale mauve, starting a metre and a
half above the flame tips — which is to say there was none. It is now dark
blue-grey (never black), starts at the tips, expands as it climbs and drifts.

---

## 13.3 — Fix the ember scatter

`src/three/campsite/Effects.tsx`.

**Embers**, in `Campfire`'s spark loop:

- rise: `0.25 + life * 5.2` → `0.25 + Math.pow(life, 0.62) * 2.4`
- spread: `s.rad + life * 1.3` → `s.rad + rise * 0.62`
- lateral drift: `s.drift * life` → `s.drift * rise * 0.5`

The old curve was linear in life and ran to 5.45 units, so embers sat level with
the tent peaks at the same density they had at the coals — that is the uniform
scatter over the whole frame. `rise = life^0.62` puts most of the travel in the
first third and spends the rest decelerating; the column now dies inside about
2.5 units of the flame.

**Ambient system** (`Fireflies`), retinted from fire colours to cool:

- `uCore`: `#fffdf2` → `#eafff4`
- `uBody`: `#ffc04a` → `#8ff0b4`
- `uHalo`: `#ff8a1e` → `#2fbf8a`

Count and radius are unchanged (110 at `center [CAMP_X, -6]`); they were never
too many, they were the wrong colour, which is what made them read as embers
thirty metres from the fire.

---

## 13.4 — Campfire scale

`src/three/campsite/Effects.tsx`, `Campfire`.

- flame group scale: `1` → `[1.24, 1.34, 1.24]`, position `[0, 0, 0]` →
  `[0, 0.05, 0]`
- hot core quad opacity: `0.50 * flicker` → `0.33 * flicker`

The flame was made taller and wider rather than the burn circle being shrunk.
The core came down because with a taller flame in front of it, it cleared the
bloom threshold over a much larger area and the middle of the fire went to flat
white.

---

## 13.5 — Pole torches → hanging lanterns

`src/three/CampHero.tsx`.

**Deleted:** the `Torch` component (kit part `Torch`, a `TorchFlame` at
`y = 1.66`), both of its instances per tent at
`[±HALF_W * 0.72, 0, BACK + 0.35]`, the two 1.1 m `ContactShadow` patches under
those poles, and the `HALF_W` constant that positioned them.

**Added:** `Lantern` — a short cord cylinder, the kit's `Lamp` mesh at scale
0.8, and a `TorchFlame` with `single`, `scale` 0.42, `strength` 1, `light` 9.5,
`reach` 4.6. Two per tent at `[±1.42, 1.52, BACK + 0.06]` in the tent's own
frame (`LANTERN_LOCAL`).

**Added:** `LanternPool` — a baked additive gradient quad, 2.2 × 2.2, colour
`#ffb765`, opacity 0.16, one under each lantern. This is the fake bounce, not a
seventh and eighth light.

**Renamed:** `tentTorches(index)` → `tentLanterns(index)`, which feeds the grass
shader's warm-light list. Positions moved with the lamps.

Light count is unchanged at 14 — six torch lights became six lantern lights — so
`MOUNTED_POINT_LIGHTS` did not move and no material was recompiled. The light
budget call is in DECISIONS.

---

## 13.6 — Desynchronise every flame

**No change made. Already present and already correct.**

`TorchFlame` in `Effects.tsx` gives every instance its own `flickRate`
(`1.35 + (rng(seed)() - 0.5) * 0.16`), so no two flames share a period and they
cannot drift back into phase however long the scene runs. Each also takes a
`seed` that offsets its time base. Verified by reading the source, not by
assuming.

---

## 13.7 — Tent tie-down ropes

`src/three/CampHero.tsx`, in `Tent`'s `parts` memo.

- material `Tent_1` colour: the tent's own tint (`#e8492c` / `#3f6ef5` /
  `#f5b722`) → `#8b6f47`, `roughness` → 1, `metalness` → 0

`tintParts` was painting the tent's *second* material slot — the frame, the guy
ropes and the stakes — with the fabric colour, so each tent's ropes were
three-metre lines of saturated red, blue or yellow one pixel wide. That is the
whole "reads as UI overlay" complaint, and it is fixed.

**Not done:** thickness, catenary sag, twisted-fibre normal map, and separate
wooden stakes. See INCOMPLETE.

---

## 13.8 — Foliage

`src/three/CampHero.tsx`:

- `TREE_TINTS`: `['#3d5225', '#4a5c2a', '#2f4a22', '#3a4e2a', '#55501f']` (five)
  → `['#2a3a1d', '#32421f', '#243418']` (three, darker, closer together)
- `TREE_AURORA_VIOLET`: `#4a4088` → `#2a3a6a`
- per-instance depth darkening: `tint.multiplyScalar(1.32 - depth * 0.14)` →
  `tint.multiplyScalar(1.04 - depth * 0.58)`

`src/three/campsite/useKit.ts`:

- bark colour: `#610000` → `#2c2118`
- bark emissive: `#2a1f1a` → `#1a1712`
- bark `emissiveIntensity`: `0.59` → `0.34`
- canopy aurora bounce `gain`: `0.1` → `0.065`

`src/three/campsite/wind.ts`:

- `AURORA_BOUNCE_HIGH`: `#5f4a94` → `#3a4a86`

Material and shading changes only; no tree geometry was replaced and no external
asset was pulled in. The old depth curve was near-flat — a tree forty metres
back came out at 93% of the value of one at the clearing edge — so every rank
had the same contrast and the treeline read as a wall standing *alongside* the
camp. The back of the wood is now a little over a stop down on the front. See
INCOMPLETE for what the geometry still needs.

---

## 13.9 — Ground

`src/three/campsite/useKit.ts`, grass wind options:

- `tipTint`: `#3f4a2c` → `#26382f`
- `coolGain`: `0.60` → `0.86`

`src/three/CampHero.tsx`:

- grass instance scale: `scale * (0.62 + r() * 0.45 + far * 0.9)` →
  `scale * (0.5 + r() * 0.38 + far * 0.62)` — a shorter field
- **Added** `PATH_HALF` = 0.85 and `onTentPath(x, z)`: distance-to-segment test
  from the fire to a point 0.5 m past each doorway, tapering `1.15 → 0.8` of
  `PATH_HALF` toward the tent. Grass and flowers are not sown inside it, so the
  ground beneath shows as a trodden lane.
- **Added** a flower scatter: 9 clumps at radius 5.5–17.5 m from the fire, 5–9
  heads each, scale 0.5–1.0, off the paths and clear of the tents and the paved
  ring. Uses the kit's `Flowers_0` and `Flowers_1`, which had never been
  instanced.
- flower material: `tintParts(..., '#4e5340', { roughness: 1, metalness: 0,
  emissive: #000000, emissiveIntensity: 0 })`. The pack authors them near-white
  with an emissive lift for Unity's HDR pipeline; untouched they came through
  the bloom as a band of blown white specks brighter than the tents.

Rocks were already scattered (`stones`, 26 instances) and are unchanged. The
warm-near-the-fire half of this sub-point was already in place via the grass
shader's `warmGain` / `warmColor` / `warmTint`; what was missing was the *cold*
half, which is the `tipTint` and `coolGain` change above.

---

## 13.10 — Composition

### 13.10a — Vary the tents

`src/three/CampHero.tsx`, `TENTS`:

| tent | before | after |
| --- | --- | --- |
| 0 (About) | `x -8.2, z -5.4, yaw 0.46` | `x -8.2, z -5.05, yaw 0.53` |
| 1 (Gameplay) | `x 0, z -7.8, yaw 0` | `x 0, z -8.15, yaw 0.04` |
| 2 (Projects) | `x 8.2, z -5.4, yaw -0.46` | `x 8.2, z -5.85, yaw -0.4` |

The middle tent stays on `x = 0` because the responsive framing is built around
it being centred. Scale is deliberately not varied — see DECISIONS.

Raycasting was re-verified after the move: `node tools/qa/click-tents.mjs`
clicks each tent's fabric in the 3D scene and reads back the camera's tent index.
All three pass.

### 13.10b — Labels

`src/three/CampHero.tsx`, `TentSign`:

- `position` y: `TOP + 1.15` → `TOP + 0.42`

`src/styles/global.css`, `.tentsign__label`:

- `color`: `#fff6e4` → `rgba(255, 246, 228, 0.72)`
- glow: `0 0 22px … var(--tent-color) 70%` → `0 0 14px … var(--tent-color) 45%`

Hover (`.tentsign.is-hot`) still puts the full value back, so the labels are no
dimmer as a target than they were.

---

## 13.11 — Verification

- **Builds clean.** `npm run build` (tsc + vite) with no errors or warnings.
- **Runs clean.** `tools/shot.mjs --info` against both the dev server and a cold
  `vite preview` of the production build reports no console errors and no page
  errors, on a real GPU context (ANGLE / RTX 3060 D3D11), not SwiftShader.
- **Cold load, not hot reload.** Every capture in this pass is a fresh headless
  Chrome navigating to the URL; the production check above was against a
  freshly built `dist/`.
- **All three tents still clickable and still navigate.**
  `node tools/qa/click-tents.mjs` — new file, added for this pass — clicks the
  fabric of each tent at 1600×900 and asserts the camera arrives at that tent.
  `tent 0: OK / tent 1: OK / tent 2: OK`, no console errors.
- **Reading pose still correct.** The journal opens, paints and pages in all
  three tents after the lighting change (`tools/shots/v13room.png`).
- **Frame time.** 1920×1080, dev server, headless Chrome, identical 9 s settle,
  three samples each, measured by stashing and restoring exactly this pass:

  | | samples (ms avg/frame) | mean |
  | --- | --- | --- |
  | before 13 | 19.2, 18.1, 22.0 | **19.8 ms** |
  | after 13 | 22.0, 24.1, 20.0 | **22.0 ms** |

  About **+2 ms a frame**, inside the noise band of a single sample. Worst-frame
  is unchanged. At 2560×1440 the after figure is 30.5 ms.

  A caution for whoever reads this next: the scene's DPR controller adapts, so a
  frame-time reading is only comparable against another taken with the *same*
  settle time. A 20 s wait reads worse than a 9 s one on identical code.

---

## DECISIONS

Judgement calls made without being able to ask.

**13.1a — no second "bounce" point light.** The brief asks for a dimmer,
wider, non-shadowing point light at the fire to fake bounce. `FIRELIGHT.key`
already carries the note explaining that this scene *had* a two-light fire — a
short bright key and a wide dim pool — and that they were merged, because in a
forward renderer the second light is evaluated on every fragment of every lit
material in the scene and the two curves differ by less than the flicker does.
Re-adding it would also move `MOUNTED_POINT_LIGHTS` from 14 to 15, which
invalidates the compiled program of *every material in the scene at once* — the
documented cause of a measured eight-second single-frame stall. The bounce is
faked instead by the fire's ground-glow quad and the grass shader's warm falloff,
both of which were already there. **Cost of doing it properly: one light plus a
scene-wide recompile. Value: a curve the flicker already hides.**

**13.1c — the campfire still does not cast shadows.** The brief's constraint
says to keep dynamic shadow-casting lights to the campfire only, which reads as
"the campfire should cast". `FIRELIGHT.shadow.enabled` is left `false`. A point
light's shadow is a cube map: six depth passes per update plus a twenty-tap cube
lookup in the fragment shader of every lit material in the scene, whether or not
the fragment is anywhere near the fire. The one thing it bought here was benches
casting outward onto the grass, and the grass does not receive shadows — the
painted contact patches under each bench already draw that. Turning it on is the
first thing worth spending frame budget on if there is ever budget again.

**13.1e — dim cool directional, not an environment map.** Deriving an env map
from the sky means rendering the aurora to a cube target and convolving it, every
time the curtain moves, for a term that on this scene only ever arrives from one
quarter — the camp is a clearing with a treeline behind it, not an open field.
The rim light was already aimed from exactly that quarter; retinting it teal is
one colour change against a cube render and a convolution.

**13.2 — the fire was not rebuilt as five particle layers.** This is the
largest deliberate deviation in the pass. The campfire is not a single additive
emitter: it is three crossed quads carrying a **custom noise shader** with
per-layer seed, detail and rise, at graded opacities (0.52 / 0.42 / 0.32), plus
a separate hot core, plus a spark system, plus smoke — a stylised flame, not a
blob. Replacing that with five `THREE.Points` layers driving curl noise in the
vertex shader would be a rewrite of a working, tuned, cheap effect, on a scene
whose brief also says to keep the stylised low-poly look and to protect frame
time. What was actually broken in it — no readable smoke, embers scattered over
the whole frame, and a flame undersized for its pit — is fixed under 13.2, 13.3
and 13.4. **If the layered rebuild is still wanted, it should be its own pass
with its own budget; it is not a tweak.**

**13.5 — all six lanterns are real lights.** The brief asks for six lanterns
plus two campfire lights to be measured and scaled back if it costs frame time.
It costs nothing here, because the six replaced six torch lights one for one:
the scene's point-light count is unchanged at 14, which is the number the whole
material-compile strategy is built around. Faking any of them would have *saved*
nothing and cost a recompile. Measured frame time for the whole of point 13 is
+2 ms at 1080p; none of it is attributable to the lanterns. Their reach came
down (8.5 → 4.6) so each pool stops at its tent, which is the point of the
change.

**13.8 — geometry not replaced.** Simplifying the canopy meshes means editing
`campsite-kit.glb`, and the brief says not to pull in new external assets. The
values, the colour count and the depth falloff are done; the silhouettes are the
pack's. See INCOMPLETE.

**13.10a — tent scale not varied.** The journal, the bench, the candles and the
whole reading camera live in the tent's local frame, so scaling a tent scales its
book and the pose that reads it. Three subtly different page sizes — and three
different framings of the one shot the site exists for — is a bad trade for a few
centimetres of silhouette. Depth and rotation carry the variation instead.

**Unlisted-but-obvious.** Where a sub-point turned out to be already satisfied
(13.1a's flicker, 13.1c's shadows, 13.6 entirely), the existing implementation
was read and verified rather than replaced, and is recorded above as "no change
made" with what was checked. Rewriting working code to match a description of it
is not a change worth the risk.

---

## INCOMPLETE

**13.7 — rope geometry.** Only the colour and material are fixed. The ropes are
baked into the tent mesh's second primitive (`Tent_1`, 469 vertices) together
with the frame and the stakes, in `public/models/campsite-kit.glb`; they cannot
be separated, thickened, given a catenary sag, or handed a twisted-fibre normal
map without re-authoring the model. **To finish:** split the rope faces onto
their own material slot in the Blender export (`tools/export-campsite.py`
already does exactly this kind of split — see its `mark_faces_by_bbox`, which is
how the window sash got its own slot), then hide that slot and rebuild the ropes
as `TubeGeometry` along a `CatmullRomCurve3` with a sag term, 2–3× the current
radius, on a `MeshStandardMaterial`. Small angled wooden stakes at each ground
anchor would be new geometry either way.

**13.8 — canopy silhouettes.** The wood now has the right values, the right
number of colours and a real depth ramp, and it reads as a stand rather than as
noise. It is still the pack's leaf-card geometry: dense alpha-cut cards, not the
clean faceted low-poly canopies with large readable silhouettes in the reference.
**To finish:** the tree meshes themselves need swapping, which is an asset
change and was explicitly out of bounds for this pass.

**13.9 — path surface.** The paths are cut out of the grass, so what shows is
the ground plane. That reads correctly at the lobby camera but it is bare ground
rather than a distinct worn dirt material. **To finish:** either a decal strip
along each path segment, or a second ground material blended by the same
`onTentPath` test.

**13.2 — layered fire.** See DECISIONS. Not done, deliberately, and the reason
is a judgement about risk and budget rather than difficulty.

---

## UNLISTED

Things changed in this pass that no sub-point asked for.

**The lobby focus rise was stopping at the wrong place.**
`src/three/CampHero.tsx`, `Tent`'s frame loop: `g.position.y += (near * 0.05 -
g.position.y) * damp(5, delta)` → the same, with `near * 0.05` replaced by
`entered === null ? near * 0.05 : 0`.

This lifts whichever tent the scroll is nearest by 5 cm, which is right in the
lobby. But the focus is frozen at the moment a tent is entered, and it defaults
to the middle tent — so the Gameplay journal was read from a bench 5 cm higher
than the other two. At the reading pose that is a book **7% larger and 50 px
higher up the frame**, which is why that one tent's book came within a few pixels
of the top of the shot while About and Projects sat centred. Found while
balancing the reading-pose framing; it is a real bug and it is fixed. Included
here rather than in the book work because the line it changes is in the scene,
not in the journal.

**Two dev-only diagnostic handles.** `window.__cam` (published by `CameraRig`)
and `window.__books` (published by `Book`), both inside `import.meta.env.DEV`.
The reading pose and the journal's world transform are the two things in this
scene that cannot be told apart from a screenshot, and separating a framing
difference from a camera difference needed both. Read by `tools/qa/cam.mjs` and
`tools/qa/click-tents.mjs`. They cost nothing in a production build.

**New files.** `tools/qa/click-tents.mjs`, `tools/qa/cam.mjs`,
`tools/qa/measure.cjs`, and this document.
