# Change log — night lighting pass, camera path, page turn

Written so any part of this can be undone on its own. Each section lists the
files touched, the old value and the new one. Nothing here changes geometry,
composition, object placement, UI, copy or interactions.

Date: 2026-08-15

---

## 1. Tent-entry light transition (issue 1)

**Files:** `src/three/CampHero.tsx`, `src/three/campsite/Effects.tsx`

The interior lights used to switch configuration the instant `travel` passed
0.05 — the first frame of the walk-in — and the other two tents' torches went
out at the same moment. Both are now ramped, and both happen once the lens is
already through the doorway.

| Thing | Before | After |
| --- | --- | --- |
| Interior ramp | boolean `readingLight = roomLit && active`, flips at travel > 0.05 | `inside` ref = `smoothstep(0.62, 0.99, easeInOutCubic(travel))`, per frame |
| Tent lamp | position/intensity/distance switched between two prop values | lerped per frame on `k^0.55`: pos y 1.15→1.5, z −0.3→0.95, intensity 7.5→2.4, distance 6.4→5.2 |
| Reading light over bench | `intensity 2.0`, mounted/unmounted | `1.5 × k`, mounted whenever the room is live |
| Lantern | `2.1/1.2 × flicker` on a boolean | `2.2 × flicker × k` |
| Candles | `lit` boolean mounted the point light | still mounted, but scaled by a `gain` ref (`TorchFlame`'s new `gain` prop) |
| Other tents' lights | culled on `roomLit` (travel > 0.05) | culled on new `deep` state, hysteresis: on at travel > 0.985, off below 0.9 |
| Tent lamp colour | `#ffab5e` | `#ffab5e` lerped 0.32 toward the tent's own accent — stand-in for light transmitted through dyed canvas; without it the blue tent went grey |

**To revert:** restore the `readingLight` boolean, drop the `inside` / `deep`
refs and the `gain` prop on `TorchFlame`.

---

## 2. Page turn (issue 2)

**Files:** `src/three/campsite/Book.tsx`, `src/three/campsite/bookGeometry.ts`

Three separate faults: the block underneath kept the outgoing page until the
sheet had landed, the sheet was a rigid flat rectangle, and it hovered above
the block at both ends of the swing.

* **Content.** New `shown` ref tracks which spread each half is displaying. On
  `go(dir)` the half the sheet lifts *off* is repainted with the incoming page
  immediately, so the new content is visible under the turning sheet. The
  `document.fonts.ready` repaint now goes through `shown` too — it previously
  closed over the pre-turn spread and put the old page straight back.
* **Curl.** `makeLeafMaterial` replaces the single `uBend` sine bow with a
  per-vertex rotation about the spine: `lag = min(0.55·sin πe, 0.7πe,
  0.7π(1−e))` radians at the fore edge, falling to 0 at the binding, plus a
  `0.055·sin πe` mid-sheet bulge. Normals are rotated to match. The two extra
  clamps stop the fore edge trailing further than the sheet has turned, which
  is what pushed it through the block at the start of the swing.
* **Rest profile.** The sheet now samples the same `pageLift` curve the page
  blocks are built to (`leafLift` in the vertex shader), faded out through the
  middle of the swing, so it lies *on* the block it leaves and the one it
  lands on.
* `LEAF_Y`: `COVER_T + 0.075` → `HINGE_Y + 0.005`.
* Plane segments across the sheet: 14 → 32.
* Turn duration: `dt × 1.85` (0.54s) → `dt × 1.15` (0.87s).
* `bookGeometry.ts` exports `PAGE_MAX_LIFT`; `HINGE_Y` is now derived from it.
* Dev only: `?turn=0.5` starts a forward turn and pins it mid-swing.

**To revert:** restore the old `makeLeafMaterial` (uBend), `showSpread`, and
`LEAF_Y`.

---

## 3. Bare patch in the foreground grass (issue 3)

**File:** `src/three/CampHero.tsx`, `Scatter`

The sow rejected every blade with `z > 4.5 && |x| < 2.4` — a 4.8m corridor
straight down the middle of the frame, which from the lobby camera is the whole
near apron.

| Before | After |
| --- | --- |
| `if (z > 10.5) continue` | `if (z > 11.6) continue` |
| `if (z > 4.5 && abs(x) < 2.4) continue` | `if (z > 10.3 && abs(x) < 1.7) continue` |
| two sows: 4400 over 2–32m, 2600 over 3.1–9.5m | plus a third: **2200 over 4.2–11.5m**, bias 1.15, scale 1.05 |

---

## 4. Camera path through the doorway (issue 4)

**File:** `src/three/CampHero.tsx`, `CameraRig`

| Leg | Before | After |
| --- | --- | --- |
| Approach (t < 0.42) | ends y 1.12, looks at y 0.95, fov 42→46 | ends **y 0.9**, looks at **y 0.62**, fov 42→**44** |
| Doorway (0.42–0.72) | `DUCK_Y = 0.8`, plateau then rise to 1.16 inside the leg, fov 46→**50** | `DUCK_Y = 0.58` (new module constant), **flat across the whole leg**, fov 44→**39** |
| Settle (0.72–1) | starts at y 1.16 | starts at `DUCK_Y`, rises to `BOOK_LOCAL.y + READ_RISE` with a `+0.15 · sin(πe)` arc over the top, fov 39→42 |

The fov change matters as much as the height: at 50° vertical on a 2:1 viewport
the horizontal field is 82°, which puts the frame edges inside the door posts
even when the centre line is clear.

---

## 5. Firelight on the journal (issue 5)

**Files:** `src/three/campsite/Book.tsx`, `src/three/CampHero.tsx`

* `makePaperMaterial` now applies a Reinhard shoulder before
  `<opaque_fragment>`: `outgoingLight /= 1 + 0.62 · outgoingLight`. The ink is
  composited into the same diffuse term as the paper, so where the paper blew
  out the type went with it; the shoulder keeps the gradient and pulls its top
  back under the ceiling.
* Reading light over the bench: `y BENCH.top + 0.9 → + 1.15`, `distance 3.4 →
  4.6`, `intensity 2.0 → 1.5` (× the entry ramp). Higher and further-reaching
  flattens the falloff across the spread, which was the actual problem — not
  the average level.
* Candles: `intensity 0.16 → 0.055`, `reach 1.5 → 1.1`.

Measured on the reading pose, page luminance now spans 147–198/255 across the
whole spread (it clipped before).

---

## 6. Sky, moon and aurora

**File:** `src/three/campsite/Effects.tsx`

| Value | Before | After |
| --- | --- | --- |
| Sky `top` / `mid` / `horizon` | `#02040f` / `#061031` / `#0f2154` | `#01030c` / `#061436` / `#123064` |
| Horizon lift | warm `(0.055, 0.020, 0.008)` | cold `(0.026, 0.042, 0.096)` + a small warm `(0.030, 0.011, 0.004)` over the camp |
| Milky way gain | 0.30 | 0.20 |
| `AURORA_GAIN` | 3.6 | **1.35** |
| Aurora coverage gate | none | `smoothstep(0.034, 0.150, peak)` — kills the low-coverage wash, leaves the filaments |
| Aurora tint | as marched | `× (0.66, 0.90, 1.32)` — teal/blue/violet, green end pulled down |
| Aurora zenith cutoff | `smoothstep(0.72, 1.0, rd.y)` | `smoothstep(0.46, 0.86, rd.y)` |
| Airglow bleed | 0.34 | 0.14 |
| Moon brightness | `moonCol × 4.4` | `moonCol × 1.34` — the sky bypasses tone mapping, so 4.4 was *clipped*, not rolled off, and the whole disc was flat white |
| Moon surface | maria fbm ×1.9, pits ×6.5, mixes 0.85 / wide smoothsteps | maria ×1.15 → `#667aa8`-ish, highland ×3.6, pits ×11.0, narrow smoothstep bands |
| Limb darkening | `0.86 + 0.14 · limb` | `0.55 + 0.45 · limb` |
| Halo | `e^(-d·9000)·0.30 + e^(-d·1600)·0.055 + e^(-d·220)·0.016` | `e^(-d·14000)·0.20 + e^(-d·2600)·0.030 + e^(-d·420)·0.009` |
| `MOON_LIGHT` | `(-0.45, 0.72, -0.53)` | `(-0.32, 0.72, -0.62)` — bearing now agrees with the painted disc; elevation still lifted |
| Stars | 5200, uniform over the sphere | **6600**, 34% pulled toward the galactic band |
| Far treeline (impostors) | `#33547c` / emissive `#0a1830` | `#26456a` / `#081226` |
| Ridge band | `#111f47` | `#0b1839` |

---

## 7. Scene lighting rig

**File:** `src/three/CampHero.tsx` — all of it grouped in the new `NIGHT` const.

| Light | Before | After |
| --- | --- | --- |
| Moon directional | 1.9, `#a6c6ff` | **1.55**, `#9dbdf5` (shadow map, frustum and re-aim unchanged) |
| Cool rim directional | 1.1, `#7ec8ff` | **0.5**, `#6fb4ff` |
| Magenta directional | 0.35, `#c264d6`, from `[30, 11, -24]` | **removed** |
| Warm fill directional | 0.3, `#ffb072`, from `[4, 3.5, 12]` | **removed** |
| Hemisphere | `#4f6fd0` / `#160d24`, 0.32 | `#2b4f96` / `#05070f`, **0.2** |
| Ambient | 0.14, `#6b7fd0` | **0.05**, `#4a63a8` |
| Fog | `#122448`, 0.0128 | `#0a1836`, **0.0142** |
| Tone-mapping exposure | 1.14 | **1.0** |

The two removed directionals are where the muddy red-violet over the forest came
from: a directional has no falloff, so a light added to warm three tent fronts
also warmed fifty trees behind them. The tent fronts are lit by the campfire's
pool instead, which falls off.

---

## 8. Campfire and torches

**File:** `src/three/campsite/Effects.tsx` — grouped in the new `FIRELIGHT` const.
`src/three/campsite/fire.ts` for the flicker.

| Value | Before | After |
| --- | --- | --- |
| Campfire key | 46, distance 13 | **34, distance 10** |
| Campfire pool | 24, distance 26 | **15, distance 16** |
| Campfire shadows | none | **cube shadow map, 512, bias −0.006, normalBias 0.06, far = 10** (`FIRELIGHT.shadow.enabled`) |
| Flame colour | fixed `#ff9b3d` | swings `#ff7a24` ↔ `#ffc272` on the new `fireTemp(t)` |
| `fireFlicker` | three sines | plus two slow irrational terms (0.618, 1.732 Hz) so the beat never repeats |
| Torch light | 18, reach 14 | **9.5, reach 7.5** |
| Ground-glow plane | 11.5 × 11.5 @ 0.30 | **9 × 9 @ 0.22** |
| Hot-core plane | 0.50 | **0.38** |
| Flame layer opacity | 0.62 / 0.50 / 0.40 | **0.52 / 0.42 / 0.32** |
| Flame output scale | `0.85 + 0.40 · flicker` | **`0.62 + 0.30 · flicker`** — these bypass tone mapping and three layers stack, so the old value clipped the core to featureless white |

Cost of the campfire shadow pass, measured headless at 1600×900: 49 fps with,
52 fps without. Flip `FIRELIGHT.shadow.enabled` to drop it.

---

## 9. Grass, ground and trees

**Files:** `src/three/campsite/wind.ts`, `src/three/campsite/useKit.ts`,
`src/three/CampHero.tsx`

### Grass now reacts to the real lights

`wind.ts` gains `setWarmLights(...)`, a shared `vec4 uWarm[8]` of
`(x, z, radius, power)`. `CampHero` publishes seven entries — the campfire and
all six torches — and each blade sums `power · e^(−d²/radius²)` from its own
world position. The old version had a single hard-coded fire position and a
`farTint` blend.

| Value | Before | After |
| --- | --- | --- |
| Blade albedo | `#877153` | `#8d7a5c` |
| Root tint | `#4a3520` (warm) | `#212c44` (navy) |
| Tip tint | `#d9a869` (warm) | `#7d9cd6` (moonlit blue) |
| Far tint | `#74879c`, blended by distance | removed — the cool tint *is* the default |
| Tint gain | `× 2.15 / 1.95` | `coolGain 1.25`, released toward 1.0 inside a flame's radius so the point lights' own warmth survives |
| Warm add | `#ff7326`, single radius 5.4, `× 0.32` | `#ff9a4a`, per-light radii, `warmGain 0.6` |
| Warm radii | — | campfire **4.2m** power 1; each torch **2.3m** power 0.6 |

### Ground plane

`color` `#584734` → **`#3a4055`**. Out past the fire's reach the soil between
the blades is most of what the eye sees of the field; painted warm it held the
bottom third of the frame the colour of firelight however dark the grass went.
(The trodden earth disc keeps `#5a3f28` — the fire genuinely lights that.)

### Trees

| Value | Before | After |
| --- | --- | --- |
| `TREE_TINTS` | `#8a3a1c #9c6420 #73271a #3f5c2c #96742c` | `#4a2c17 #523719 #3d1d15 #2c3a22 #4c3d1e` |
| `TREE_MOONLIT` | `#3f6ea8` | `#25456f` |
| Moonlit blend | `0.08 + depth · 0.34` | `0.34 + depth · 0.46` |
| `TREE_VIOLET` | `#8f4bb4`, applied to the right-hand trees | **removed** |
| Overall scalar | `× 0.86` | `× (0.62 − depth · 0.12)` |
| Leaf material emissive | none | `#1a3059`, `emissiveMap` = the leaf map, intensity **0.55** |

The leaf emissive is a floor, not a lift. The moon is behind the camp, so the
face of every near tree turned toward the lens gets the hemisphere term and
nothing else, and at the new ambient levels that measured (1, 0, 2) — literally
crushed. Routed through the leaf map rather than applied flat, so it lifts the
canopy to a dark navy without filling the silhouette in. Near trees now measure
about (10, 30, 70); far ones stay lighter through the haze.

---

## 10. Post-processing

**File:** `src/three/CampHero.tsx`

| Pass | Before | After |
| --- | --- | --- |
| Bloom (tight) | 0.7 @ threshold 0.78, smoothing 0.2 | **0.62 @ 0.86**, smoothing 0.16 |
| Bloom (wide) | 0.16 @ threshold 0.68, smoothing 0.4 | **0.13 @ 0.80**, smoothing 0.35 |
| HueSaturation | +0.20 | **+0.14** |
| BrightnessContrast | +0.02 / +0.06 | **−0.015 / +0.11** |
| SplitTone | unchanged (`#2c56b4` 0.085 shadows, `#ff9a3c` 0.06 highlights) | unchanged |
| Vignette | offset 0.32, darkness 0.52 | offset 0.32, darkness **0.5** |
| Outline, MSAA ×4 | unchanged | unchanged |

---

## 11. Performance pass

The scene ran at 12 fps / 84 ms at 1920×1080 on this machine, and in single
figures on a larger display. Profiled by A/B — load the scene, mutate one
system through `window.__camp`, read the `?fps=1` overlay — which found no
single hotspot: removing all the point lights, all the grass, the whole forest,
the entire sky or every shadow map each moved the frame by 3–13 ms of 84. The
cost was spread across everything, and the largest single variable was simply
**how many pixels were being drawn**.

### Resolution is now a budget, not a device ratio

`CampHero.tsx` — `pixelBudgetDpr()`

The old cap was `dpr={[1, 1.75]}`. A device pixel ratio says nothing about how
much work a frame is: 1.75 on a 1280×720 panel is 2.8 megapixels and the same
1.75 on a 4K desktop is 25. The starting ratio is now derived from a
**2.1-megapixel budget** and clamped to 0.62–1.6, so every display size starts
somewhere sane; `PerformanceMonitor` adjusts from there in 0.15 steps against
looser bounds (38–55 fps, was 50–60).

This is the change that matters most for a large screen and it does nothing at
all on a small one.

### Two materials moved from PBR to Lambert — the single biggest win

`useKit.ts` (grass), `CampHero.tsx` (ground plane, trodden earth disc)

These are the two largest runs of fragments in the frame: the ground is the
whole lower half, and the field is several thousand alpha-cutout blades layered
over it — and alpha cutout is the one case where the depth test cannot reject a
fragment before shading it. Every one of those fragments was evaluating a full
GGX specular lobe per light, across nine lights, for surfaces at roughness 1
whose specular response is a flat colourless sheen. `MeshLambertMaterial` has no
specular term.

**45.6 ms → 27.6 ms**, in one change.

### Everything else

| Change | File | Why |
| --- | --- | --- |
| MSAA 4× → 0 | `CampHero.tsx` | Four samples of a half-float target is a 66MB allocation at 1080p and every opaque draw pays the bandwidth. Measured 13 ms. |
| Two bloom passes → one | `CampHero.tsx` | Each is a full mipmap chain, ~8 downsamples and 8 upsamples over the frame. |
| `Outline` pass removed | `CampHero.tsx`, `glow.ts` | Depth pre-pass + mask render + two-stage blur, **every frame**, for an effect visible a second at a time. The Fresnel rim in `glow.ts` now drives past the bloom threshold and gets the same halo out of the bloom pass that is running anyway. |
| Shadow maps at 6 Hz, not 60 | `CampHero.tsx` (`SHADOW_HZ`) | `shadowMap.autoUpdate = false` with a timed `needsUpdate`. Nothing that casts a shadow here moves except a tent bobbing 5cm. |
| Directional shadow 2048 → 1536 | `CampHero.tsx` | |
| Campfire cube shadow off | `Effects.tsx` (`FIRELIGHT.shadow`) | A point-light shadow is six depth passes **and** a 20-tap cube lookup in every lit material's fragment shader. |
| Campfire's two lights → one | `Effects.tsx` | Retuned to 49 / distance 11, which reproduces the old key-plus-pool curve to within a few percent at 2m, 4m and 8m. |
| Grass warm term moved to the vertex shader | `wind.ts` | It was eight distances and eight exponentials **per fragment** on the most overdrawn surface in the scene, computing something that varies smoothly across the ground. |
| Moon and milky-way `fbm`s gated | `Effects.tsx` | Five `fbm` calls — 75 noise lookups — ran for every sky pixel to shade a disc covering under a thousandth of the sky. |
| Aurora march 42 layers → 26 | `Effects.tsx` | Every constant keyed to the count was rescaled with it (ramp step, falloff, height curve, both smoothsteps, and a 1.55 gain). Measured identical sky colour: (44, 69, 111) before, (41, 69, 109) after. |
| Parallax march 16 → 9 steps | `CampHero.tsx` | A texture fetch per iteration on the largest unbroken surface in frame. |
| Journals built on entry, not at load | `CampHero.tsx` | Each of the three owned seven 796×1180 canvases — 26MB of texture apiece, 78MB across the camp — all resident while the reader looks at a campfire. Now only the tent being entered has one. |
| Tent clutter built on entry | `CampHero.tsx` (`dressed`) | The shelf, glassware, pack and heaped cushions sit against walls the doorway does not show. |
| Grass 9,200 → 6,900 blades, impostors 108 → 76, fireflies 165 → 110, leaves 85 → 55, sparks 110 → 70, smoke 10 → 6 | | Blade and impostor scale went up to hold the coverage. |
| Trodden disc `#5a3f28` → `#694c30`, POM occlusion 0.42 → 0.34 | `CampHero.tsx` | Recovers the value Lambert's missing sheen was carrying. |

### Result

At 1920×1080, device ratio 1, headless on this machine:

| | before | after |
| --- | --- | --- |
| lobby | 12 fps · 84 ms | **34 fps · 30 ms** |
| inside a tent | — | **36 fps · 28 ms** |

That is at device ratio 1. On a display where the old `[1, 1.75]` cap was
rendering four or nine megapixels, the budget above compounds with it.
`?fps=1` prints frames, mean and worst-frame in the corner.

Region colours across the frame are within a few percent of the pre-optimisation
render — earth (138, 80, 38) → (120, 70, 15), tents (84, 44, 18) → (82, 44, 18),
grass (35, 23, 30) → (34, 22, 27), trees (12, 23, 59) → (12, 24, 59).

### Tried and reverted

Merging each tent's two door torches into one light. The pair stand 2.2m either
side of the doorway and rake across the canvas at a glancing angle; a single
light between them is 35cm from that canvas and square on to it, and inverse
square over that difference is two orders of magnitude. Tuned to match the
fabric it went dark on the grass; tuned to match the grass it lit the tent front
like a stage (the right-hand tent measured 84 → 153). Three point lights is
about 2 ms of a 32 ms frame — the wrong 2 ms to spend.

### Dev switches added

`?msaa=N`, `?post=0` (skip the whole composer) and `?hot=N` (pin a tent's hover
highlight), alongside the existing `?travel=`, `?book=`, `?reveal=`, `?turn=`,
`?aurora=` and `?fps=1`. All dev-only.

---

## Verification

Headless captures via `node tools/shot.mjs <name> "<query>" --port 5173`:

* lobby, 1600×900 — region means: grass at the bottom-left corner (35, 23, 30),
  grass in the fire ring (130, 73, 32), near trees (12, 23, 59). Navy where no
  flame reaches, amber where one does, no crushed black in the wood.
* `?room=1&travel=0.30 / 0.50 / 0.65 / 0.80` — the doorway leg clears the
  frame with margin at every step, no light pops.
* `?room=1&travel=1&book=1&reveal=1` — page luminance 147–198 across the spread.
* `?room=1&travel=1&book=1&reveal=1&turn=0.2 / 0.45 / 0.7` — sheet lies on the
  block at the start, curls through the swing, and the new page is visible
  underneath from the moment it lifts.
* `?fps=1`, 1600×900 headless: 49 fps / 20.5 ms avg / 23.6 ms worst.
* 720×1000 and 2200×950 both render correctly; no console errors and no shader
  warnings in either the lobby or the reading pose; `npm run build` clean.
</content>
