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
