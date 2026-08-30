# Lighting tuning — 2026-08-17

## How to revert

```bash
git log --oneline lighting-rework   # see the five commits, one per item below
git checkout main                   # or: git checkout master
```

Manual fallback if git history is unavailable: every changed constant below has
its old value in the "Before" column. `git diff master lighting-rework` shows
the full patch.

**The previous hand-tuned reference frame (documented in the memory note
`portfolio-sky-aurora-moon-shader`) is superseded as of this session.** A new
target reference (`tools/ref/target.png`, 1774x887) replaces it. That memory
note has been updated to point here.

## Method

`tools/lighting-diff.mjs <shot> <ref>` — custom region sampler built for this
pass (the stock `tools/imagestats.mjs` grid doesn't cover cots/torches/radial
falloff/doorway spill). Samples: outer-grass hue/lum, global 5th-percentile
black floor, radial falloff from the fire, foreground cot top faces, ground
under each of the 6 torches, treeline vs tent-roof bands, grass at each
doorway. Every number below is from that script, before/after, against
`tools/ref/target.png`.

## Value table

| # | File | Constant | Before | After | Region targeted | Measured delta |
|---|------|----------|--------|-------|------------------|----------------|
| 1 | CampHero.tsx | `NIGHT.hemisphere.sky` | `#3f3c44` | `#2a3050` | (a) outer grass hue | hue 8.3°/3.0° → 4.3°/354.5° (ref 1.8°/7.5°) |
| 1 | CampHero.tsx | `NIGHT.hemisphere.ground` | `#0a0a08` | `#070a14` | (a) | — |
| 1 | CampHero.tsx | `NIGHT.ambient.color` | `#22345e` | `#1c2c5c` | (a) | — |
| 1 | grade.ts | `SplitToneEffect` shadow color | `#2c56b4` | `#2748c8` | (a), (b) | 5th-pct lum 2.1 → 1.9 |
| 1 | grade.ts | `SplitToneEffect` shadowAmount | `0.048` | `0.065` | (a), (b) | — |
| 2 | CampHero.tsx | `Bloom.luminanceThreshold` | `0.80` | `0.87` | (b) black floor | 5th-pct 1.9 → 1.4 |
| 2 | CampHero.tsx | `Bloom.luminanceSmoothing` | `0.16` | `0.11` | (b) | — |
| 2 | CampHero.tsx | `BrightnessContrast.contrast` | `0.085` | `0.105` | (b) | — |
| 3 | Effects.tsx | `FIRELIGHT.key.intensity` | `26` | `34` | (c) radial falloff core | r=0.03 lum 87.7 → 129 (ref 124) |
| 3 | Effects.tsx | `FIRELIGHT.key.distance` | `12` | `11` | (c) mid/far field | r=0.45 9.4 → 2.3 (ref 2.2) |
| 3 | CampHero.tsx | `NIGHT.grassWarm.fireRadius` | `5.6` | `4.8` | (c) | see above |
| 3 | CampHero.tsx | `NIGHT.grassWarm.firePower` | `1` | `1.1` | (c) | — |
| 3 | Effects.tsx | flame core quad opacity | `0.38` | `0.50` | (c) core, unlit additive | tuned by eye — see note below |
| 3 | Effects.tsx | fire ground-glow quad opacity | `0.22` | `0.30` | (c) core | — |
| 3 | CampHero.tsx | `earthMat` — **bug fix, not tuning** | no `applyGroundGlow` | `applyGroundGlow` wired + composed with `applyParallax`'s `onBeforeCompile` | (c) whole clearing floor | see "Bugs found" below |
| 4 | fog.ts | `FOG_NEAR` | `26` | `20` | (f) treeline recede | see note below — inconclusive |
| 4 | fog.ts | `FOG_FAR` | `78` | `58` | (f) | — |
| 5 | Effects.tsx | `TorchFlame` ground pool | none | added (shared texture, opacity `0.30 * flicker`) | (e) torch ground pools | torch1 -8.0→-8.4, torch3 -11.8→-13.1 (measurement likely miscalibrated — see note) |
| 5 | CampHero.tsx | `DoorwaySpill` per tent | none | added (per-tent tinted texture) | (g) doorway spill | visually confirmed present (crop), region-box measurement unreliable |
| — | package.json | `lil-gui` | not installed | `^0.x` added | debug panel | dev-only, lazy-imported behind `?debug` |

## Bugs found while wiring this up (not tuning choices)

1. **`earthMat` never got `applyGroundGlow`.** Only the surrounding `grassMat`
   had it. The trodden-earth disc under the fire (the single biggest patch of
   ground in frame) was lit by nothing but the physical point light's N·L
   term, which is weak because the fire sits low and nearly level with a flat
   ground normal. Wiring it up exposed a second bug:
2. **`applyParallax`'s `mat.onBeforeCompile = ...` is a bare assignment, not
   a chain.** Calling it after `applyGroundGlow` on the same material silently
   discarded the glow patch — no error, no visible warmth, at any gain value.
   Fixed by capturing both callbacks and composing them manually in
   `CampHero.tsx`'s `Ground()`.
3. **`applyGroundGlow` only registers a material for live `uWarmCount` updates
   when an `aurora` block is passed** (see `wind.ts`'s `patched` list, driven
   by `setWarmLights`). Without one, the uniform freezes at whatever
   `warmCount` was when the material compiled — 0, since ground materials
   compile before the camp's first `setWarmLights()` call. `earthMat`'s call
   now includes a (deliberately faint, gain 0.03) aurora block to get onto
   that list, matching `grassMat`.

## Values tuned by eye, not from a number in the brief

- Flame core/ground-glow quad opacities (0.38→0.50, 0.22→0.30): these quads
  are `toneMapped={false}` additive — see the `portfolio-post-chain-tonemapping`
  memory note — so raising the point light's intensity does not move their
  brightness at all; the imagestats r=0.03 sample plateaued at 87 no matter
  what `FIRELIGHT.key.intensity` was set to, until these were touched.
- `FIRELIGHT.key.distance` (12→9.5→11): first pass at 9.5 fixed the far-field
  overshoot but collapsed the mid-field; landed on 11 as the split.

## Known-inconclusive: item 4 (fog) and part of item 3/5 (cots, torches)

- **Fog**: `FOG_NEAR`/`FOG_FAR` were moved to a geometrically-justified range
  (camera at world z=14, tents ~22m out, near tree ring as close as ~20m —
  the old 26m gate excluded them). But the (f) treeline/tent-roof delta this
  was meant to fix (+19.9/+13.4 lum before, +22.3/+10.8 after — barely moved)
  turned out on inspection to be **canopy silhouetted against the
  aurora/sky**, not ground-level fog. That system is explicitly hand-tuned
  and protected (`portfolio-sky-aurora-moon-shader` memory note) — did not
  touch it without sign-off. Fog's own change is still defensible on its own
  geometric terms and was kept, but it is not what's driving (f).
- **Cot top faces (d)**: still ~-10 lum off after item 3. Crop inspection
  shows this is a grazing-incidence problem — the fire sits close to the
  cots' own height, so a flat Lambert top face gets almost no N·L from it no
  matter the light's intensity. Target's rim is a highlight along the top
  *edge*, which reads as a geometry/shading-model fix (a fresnel-style rim
  term on the Bench material, same shape as `applyGroundGlow` but for a
  different surface), not a light-parameter one. Flagged, not attempted —
  out of "retune don't rebuild" scope without sign-off.
- **Torch ground pools (e) / doorway spill (g) numeric readback**: added and
  visually confirmed present via crops (see session record), but this
  script's region boxes for these two were coordinates guessed against the
  reference image's composition and are demonstrably miscalibrated in a few
  cases (e.g. `door1`'s box mostly captures the campfire itself, not the
  middle tent's threshold; some torch boxes land on the stake rather than
  the pool). Trust the crops over these specific numbers.
- **r=0.22 in the radial falloff**: stays a hard cliff (-20 lum) in every
  pass. Traced to the `WALK_R` alpha-mask edge on the earth disc — a
  geometry seam between "inside the trodden-earth circle" and "grass beyond
  it" — not a light-falloff shape. Widening `grassWarm.fireRadius` to try to
  bridge it (tried 5.4) made the far tail worse without closing the gap;
  reverted. Would need a softer mask or a wider earth disc to actually fix.

## Performance

Baseline: 14.5ms avg / 17.7ms worst (1600x900). Final (1774x887, matching the
reference's own size): 13.9ms avg / 17.7ms worst. No regression — every
change here is either a post-processing parameter (free), a constant on an
existing light, or a reuse of an already-existing additive-quad/shader-patch
technique (torch/doorway pools, ground glow). Total real (non-fake) lights in
the scene: unchanged. `?debug` panel is lazy-imported and gated, zero cost
when absent from the URL.

## White edge outline on props (third pass — the real cause)

Report: a white outline on the edges of *some* parts of *some* objects (cot
rails, tent trim, guy-ropes), flickering as the camera rotates, gone with the
lights off. Two earlier passes at this — stripping the shared
roughness/metalness map, then upgrading the kit to `MeshPhysicalMaterial` and
pinning `specularIntensity` — landed in `useKit.ts` and **never ran**:

```
console: KITPROBE-throw Cannot read properties of undefined (reading 'x')
  at _Vector2.copy
  at MeshPhysicalMaterial.copy
```

`new THREE.MeshPhysicalMaterial().copy(standardMaterial)` reads physical-only
fields off the source (`source.clearcoatNormalScale.copy(...)`), which a
`MeshStandardMaterial` doesn't have. It threw on the first mesh in the
traversal; the once-only guard was already set, so every later `useKit()` call
skipped the block. Nothing was upgraded, `specularIntensity` was never written,
and `ALL_STANDARD_MATERIALS` stayed empty — so the `?debug` panel's metalness
and specular sliders were bound to an empty list, which is why moving them
"helped but didn't clear it."

Copy with `THREE.MeshStandardMaterial.prototype.copy.call(phys, m)` and restore
`defines = { STANDARD: '', PHYSICAL: '' }` afterwards (the standard `copy`
overwrites defines and dropping `PHYSICAL` compiles the standard shader, which
has no `specularIntensity` in it).

Ruled out on the way, each with a headless A/B (`tools/shot.mjs`, fixed crop,
count of near-neutral bright pixels — 196 baseline):

| Suspect | Test | Count | Verdict |
|---|---|---|---|
| Geometry aliasing | `?msaa=4` on the composer | 185 | not it (and costs 13ms) |
| Texture minification | anisotropy 16 → 1 | 195 | not it |
| Specular (as shipped) | `?spec=0` | 196 | no effect — the block was dead |
| Albedo highlights in the pack's atlas | shader roll-off probe | 196 | no effect — same dead block |
| Specular (block fixed) | `specularIntensity` 1.0 → 0.15 | 134 | **it** |

Values: `useKit.ts` `specularIntensity` 0.15 (sweep: 1.0→196, 0.3→151,
0.15→134, 0.04→113; under ~0.1 the tent weave and the glassware lose their
surface). `CampHero.tsx` tent `roughness` 1.0 → 0.9 — the flattening was a
workaround for the dead specular clamp, and at 0.9 the canvas gets its weave,
seams and sag back with no edge highlight.

Side effect worth knowing: the roughness/metalness-map strip and the specular
clamp are now actually in force scene-wide, so the whole frame reads a little
deeper and more saturated than the shots taken before this fix.

## Aurora losing its shape after a long session

Report: the curtains flatten into smooth bands/lines, no reliable repro —
"maybe alt-tabbing or switching browser, so waiting a while."

Cause is the sky clock's *magnitude*, not the lights or any tuned constant.
`aurora()` drifts the sample point with `p.x += t * 0.035`, a straight
translation, so the coordinate handed to `triNoise2d` grows without bound —
and that field is built from `fract()`, whose resolution is the float ulp at
whatever magnitude it gets. Reproduced in one shot with a dev offset
(`?skyt=<seconds>`):

| sky clock | drift in p.x | curtains |
|---|---|---|
| 0 | 0 | crisp |
| 900 | 32 | crisp |
| 1800 | 63 | indistinguishable from 0 |
| 3600 | 126 | visibly broadened |
| 7200 | 252 | flat wash, horizontal striping |
| 36000 | 1260 | no structure at all |

Isolated to that one term: at `?skyt=36000`, wrapping *the drift* restores the
curtains exactly; wrapping the rotation inside `triNoise2d` (the only other
place time enters) changes nothing.

Fix, in `Effects.tsx`'s `Sky` — the shader and every tuned constant are
untouched:

1. The sky advances on clamped frame deltas instead of `clock.elapsedTime`. A
   hidden tab stops rendering but the wall clock keeps counting, so coming back
   to a tab left open for half an hour used to hand the shader a clock 1800s
   further along in one step. Only time the sky was on screen counts now.
2. The accumulator wraps at 1800s as a backstop, which the table above puts
   well inside the clean range.
