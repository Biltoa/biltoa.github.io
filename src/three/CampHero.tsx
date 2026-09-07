import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Canvas, useFrame, useLoader, useThree, type RootState } from '@react-three/fiber'
import { Html, useGLTF, useProgress, useTexture } from '@react-three/drei'
import {
  Bloom,
  BrightnessContrast,
  EffectComposer,
  HueSaturation,
  Outline,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing'
import { KernelSize, ToneMappingMode, type OutlineEffect } from 'postprocessing'
import * as THREE from 'three'
import { clamp01, damp, easeInOutCubic, scrollDriver } from '../lib/scroll'
import { GRAPHICS_DPR } from '../lib/graphics'
import { sfxEnter, sfxExit, sfxHover, sfxUiClick, sfxUiHover, tickAudio } from '../lib/audio'
import {
  ALL_STANDARD_MATERIALS,
  collectParts,
  TENT_MATERIALS,
  tintParts,
  useKit,
} from './campsite/useKit'
import {
  applyGroundGlow,
  AURORA_BOUNCE_HIGH,
  AURORA_BOUNCE_LOW,
  AURORA_BOUNCE_MID,
  setWarmLights,
  tickWind,
} from './campsite/wind'
import { applyParallax } from './campsite/parallax'
import { installHeightFog } from './campsite/fog'
import { fireFlicker } from './campsite/fire'
import { SplitToneEffect } from './campsite/grade'
import Book, { type PageScreenRect } from './campsite/Book'
import { loadBookFonts, waitForBookImages } from './campsite/bookPaint'
import {
  Campfire,
  FIRELIGHT,
  Fireflies,
  Haze,
  InstancedParts,
  Leaves,
  makeGlowTexture,
  MOON_LIGHT,
  NightSky,
  Stars,
  TorchFlame,
  buildMatrices,
  rng,
} from './campsite/Effects'
import { debugEnabled, mountDebugPanel } from './campsite/debugPanel'
import { attachDebugGain, GRASS_GAIN } from './campsite/debugGain'
import { LANTERN_CANDLE_TOP_DROP, useBenchSetup } from './campsite/useBenchSetups'

/* -------------------------------------------------------------------------- */
/*  Night lighting, in one place.                                               */
/*                                                                              */
/*  Everything cold is here; everything warm is FIRELIGHT in Effects.tsx. The   */
/*  whole rig is built round one relationship — a cool, dim, directional moon    */
/*  against a warm, bright, local fire — and the single most common way to lose  */
/*  it is to add a little more ambient until the shadows go grey. Ambient here   */
/*  is deliberately far lower than looks right in isolation: the fire is what    */
/*  should be revealing the camp, and the sky is only what stops the parts it    */
/*  cannot reach from being black holes.                                        */
/* -------------------------------------------------------------------------- */
const NIGHT = {
  /** Key: the moon. Aligned with the disc painted in the sky shader.
      LIGHTING-REWORK (2026-08-17): baked from the ?debug panel at the
      user's request — intensity 1.55->4, color '#93b4ee'->'#ffffff'. */
  // VISUAL-13.1 (2026-08-30): 4 -> 2.6, '#ffffff' -> '#c3d6ff'. A white moon at
  // four is a second key light, not a night sky, and it is half of why every
  // surface in the frame had the same value regardless of how far it was from
  // the fire. Cool and dimmer: the moon separates shapes, the fire lights them.
  moon: { intensity: 3.05, color: '#b9d6ff' },
  /** Cool rim from behind and above, which is what separates tent from tree.
      LIGHTING-REWORK (2026-08-17): baked from ?debug — intensity 0.62->2,
      color '#5aa9ff'->'#ffffff'. */
  // VISUAL-13.1e (2026-08-30): 2 -> 1.2, '#ffffff' -> '#5fd8c4'. This is the
  // aurora's contribution to the world, done as a dim cool directional from
  // over the camp's shoulder rather than as an environment map — it is one
  // light against a convolution and a cube target, and on this scene the rim is
  // the only direction the curtain would have reached anyway. Teal, so tree
  // canopies, tent peaks and the tops of the grass take a green-cyan edge.
  rim: { intensity: 0.92, color: '#69d2c7' },
  /**
   * Sky and ground bounce. Navy above, near-black below: a hemisphere light
   * with a lifted ground colour is exactly the grey-shadow failure mode.
   *
   * Cut to a third of what it was, which is the single biggest thing that was
   * wrong with the frame. A hemisphere light reaches every surface in the scene
   * from every direction at once — it is the one term with no falloff, no
   * shadow and no direction — so it sets the *black level* of the whole
   * picture. At 0.88 the wood measured rgb(39,41,70) against a reference that
   * measures rgb(2,4,13), and no amount of grading recovers a silhouette from a
   * forest that is genuinely lit.
   *
   * It cannot go to zero: the moon is behind the camp, so the face of every
   * tree the reader is looking at is turned away from the only directional
   * source in the scene. This is what keeps that face from being a hole.
   */
  // LIGHTING-REWORK (2026-08-17): sky pushed from #3f3c44 (grey-warm) to a
  // colder navy, ground from #0a0a08 to a blue-black. imagestats on the
  // outer-grass corner (item a) showed a faint warm cast where the target is
  // near-neutral/cool at the same near-black luminance — this is a small,
  // low-cost push in that direction. See LIGHTING_TUNING.md.
  // LIGHTING-REWORK (2026-08-17): baked from ?debug — sky '#2a3050'->'#000000',
  // ground '#070a14'->'#ffffff' (was '#d1d1d1' in an earlier bake this same
  // session), intensity 0.23->1.
  // VISUAL-13.1b (2026-08-30): sky '#000000' -> '#2f93a8', ground '#ffffff' ->
  // '#050a14', intensity 1 -> 0.34.
  //
  // The previous values were a debug-panel bake that had ended up inverted: a
  // *white* ground bounce at full intensity, reaching every surface from below
  // with no falloff and no shadow. That is a flat warm-grey wash over the whole
  // frame, and it is the single reason the camp read as evenly lit rather than
  // as a fire in a dark wood. Cyan-blue above, near-black blue below, and low.
  hemisphere: { sky: '#789dbb', ground: '#131b23', intensity: 0.88 },
  /** The last resort against crushed black.
      LIGHTING-REWORK (2026-08-17): baked from ?debug, second pass — turned
      off (intensity 1->0) once the hemisphere alone was carrying enough. */
  ambient: { intensity: 0.48, color: '#6c89af' },
  /**
   * Depth haze. See campsite/fog.ts — this is height fog, not distance fog.
   *
   * Darker and thinner. Fog is additive over distance, so its colour is a floor
   * under everything past 26 metres — which is the entire treeline. At
   * `#132a58` that floor was brighter than the reference's *trees*.
   */
  // VISUAL-13.1f (2026-08-30): '#141426' -> '#12333d', density 0.0068 ->
  // 0.0084. Tinted to the aurora's teal and thickened, so the back rows of the
  // wood sink toward the curtain's own colour instead of holding the same
  // contrast and saturation as the trees at the edge of the clearing.
  fog: { color: '#12333d', density: 0.0084 },
  /** ACES exposure. */
  // VISUAL-13.1d (2026-08-30): 1.02 -> 0.93. ACES and SRGB output were already
  // correct; the exposure was not, and a scene that is meant to be a night with
  // one fire in it should be sitting under the shoulder, not on it.
  exposure: 1.05,
  /**
   * Radii the grass shader uses for its warm falloff. See wind.ts.
   *
   * These are e-folding radii on a gaussian. The torches were at 2.8, which put
   * one at a tenth of its strength by five metres — less than the gap to the
   * next torch, so the field between them saw neither and the camp read as a
   * green carpet with lamps standing on it. 6.2/3.9 was the overcorrection: a
   * fire radius over six metres reaches past the benches and out to the lens,
   * and the whole foreground went to straw.
   *
   * These sit between the two. Seven readable pools, and cold grass in the gaps
   * and at the front of frame.
   */
  // LIGHTING-REWORK (2026-08-17): fireRadius 5.6->4.3. This gaussian, not the
  // physical point light, was the main driver of the far field reading
  // brighter than the new target reference (item c) — a shader term with no
  // hard cutoff reaches well past where FIRELIGHT.key's distance cuts it off.
  // LIGHTING-REWORK (2026-08-17, revised): 4.3->4.8, paired with the
  // FIRELIGHT.key.distance revision above — same reasoning, mid-field was
  // undershooting the new target reference.
  grassWarm: { fireRadius: 5.6, firePower: 0.72, torchRadius: 3.25, torchPower: 0.5 },
} as const

/**
 * Maximum shadow-map refresh rate while a shadow caster is moving, in hertz.
 *
 * Not sixty. The only shadow caster in this scene that moves at all is a tent
 * bobbing a couple of centimetres as the scroll focus passes it, and a shadow
 * two frames stale at that amplitude is a shadow nobody can tell from a fresh
 * one. Everything else — benches, stones, torch stakes, the firewood — is
 * bolted to the ground. Once those tent transforms settle there is no periodic
 * shadow work at all.
 */
const SHADOW_HZ = 6

/**
 * **The number of point lights in this scene never changes.** Fourteen, from
 * the first frame to the last.
 *
 * One for the fire, six for the door torches, three for the tent lamps, and
 * two interior sources — the lantern and the reading light — which belong to
 * whichever tent is `active` and to no other. Exactly one tent is ever active,
 * so the pair exists exactly once (at zero intensity while still outside).
 *
 * This is not a tidiness rule, it is the difference between the walk-in being
 * an animation and being a freeze. Three.js bakes `NUM_POINT_LIGHTS` into every
 * shader as a compile-time constant, so the count is part of each material's
 * program cache key — change it by one and *every material in the scene* needs
 * a new program. The old rig mounted the interior lights on entry and then
 * culled the far tents' lights once the camera arrived, walking the count
 * 10 → 14 → 8. Measured, that click compiled **forty** programs and stalled a
 * single frame for eight seconds.
 *
 * So nothing here is ever mounted or unmounted to save light cost. Sources that
 * should not be contributing are held at zero intensity, which produces an
 * identical image — the `here` gate in `Tent`, the `lit` prop on `TorchFlame`,
 * and the `inside` ramp all became multipliers rather than mounts.
 *
 * The two extra lights that burn at zero in the lobby preserve the shader
 * program across entry without doing any lighting work.
 *
 * **If you add a light to this scene, mount it unconditionally.**
 */
const MOUNTED_POINT_LIGHTS = 12

/**
 * Mip levels in the bloom's blur stack. **The one knob left on the table.**
 *
 * A mipmap bloom is not one blur, it is a stack of them: every level is a
 * downsample render and an upsample render of its own, and at the library's
 * default of eight this single effect is fifteen of the eighteen render passes
 * the whole frame does. Those passes are not free even when they are tiny — the
 * cost of one here is almost all target switch and state change rather than
 * pixels — and they are *very* tiny at the top: the effect runs at half
 * resolution, so on a 1600x900 frame the chain starts at 800x450 and level
 * seven is six pixels by three, level eight three by one.
 *
 * Dropping to 6 measured about a millisecond a frame at 1080p and three at
 * 720p. It is left at 8 anyway, because it is not free *visually*: those two
 * levels are a broad structureless wash over the whole frame, and taking them
 * out lifts a measurable — if barely perceptible — amount of the wide glow off
 * the fire. See OPTIMIZATION.md for the measured difference either way; this is
 * the number to change if the frame budget is ever worth that much.
 */
const BLOOM_LEVELS = 8

// Before any material in this module tree is constructed: the fog chunks are
// pasted in at compile time, so a material built before the swap keeps the
// stock distance-only fog and would haze at a different rate to everything
// around it.
installHeightFog()

/* -------------------------------------------------------------------------- */
/*  Three tents around a fire in a night forest. Scroll moves focus; clicking    */
/*  one walks the camera in through the doorway and down to the journal lying    */
/*  open inside.                                                                */
/* -------------------------------------------------------------------------- */

export type TentIndex = 0 | 1 | 2

/** Optimized Meshy A-frame tent from the clean blue-painted Blender source. */
const CABIN_BLUE_URL = '/models/tent-painted-blue-final.glb?v=4'
const TENT = {
  scale: 3.55,
  /** The supplied GLB already faces +Z, toward the clearing. */
  flip: 0,
  /** Meshy exports the tent around its origin; lift its lowest vertex to y=0. */
  rawBaseOffset: 0.40039,
  rawDepth: 0.82813,
  rawHeight: 0.79687,
  rawWidth: 1,
} as const
useGLTF.preload(CABIN_BLUE_URL)

/**
 * Exact red channels from the four neutral Fabric030 maps, packed RGBA as
 * colour / height / roughness / AO. Runtime tint remains the source of hue.
 */
const TENT_CLOTH = '/textures/tent-cloth/fabric030-neutral/Fabric030_Packed.webp'
const TENT_LEATHER_GRAIN = '/textures/tent-cloth/leather-grain.webp'
/** Dense weave, with mipmaps/anisotropy keeping it stable at campsite distance. */
const TENT_CLOTH_SCALE = 3.2
/**
 * Reversible fabric trial. The normal site shows the weave; append
 * `?tentFabric=off` to compare against the untouched painted-canvas look.
 */
const TENT_FABRIC_PREVIEW =
  typeof window === 'undefined' ||
  new URLSearchParams(window.location.search).get('tentFabric') !== 'off'
// Keep high-frequency colour contrast restrained; the normal response carries
// most of the close detail and mipmaps remove it cleanly at distance.
const TENT_FABRIC_COLOR_STRENGTH = TENT_FABRIC_PREVIEW ? 0.32 : 0
const TENT_FABRIC_NORMAL_STRENGTH = TENT_FABRIC_PREVIEW ? 0.09 : 0
const TENT_FABRIC_ROUGHNESS_STRENGTH = TENT_FABRIC_PREVIEW ? 0.28 : 0
const TENT_FABRIC_AO_STRENGTH = TENT_FABRIC_PREVIEW ? 0.045 : 0
const TENT_CANVAS = {
  roughness: 0.93,
  metalness: 0,
  envMapIntensity: 0.35,
  aoMapIntensity: 0.75,
  normalStrength: 0.065,
} as const
useTexture.preload(TENT_CLOTH)

const BACK = (TENT.rawDepth * TENT.scale) / 2
const HALF_W = (TENT.rawWidth * TENT.scale) / 2
const TOP = TENT.rawHeight * TENT.scale

/**
 * The camp is centred on the fire, and the outer tents are pulled forward and
 * turned inward so the three sit on an arc rather than in a shop-window row.
 */
const CAMP_X = 0
// Development-only treeline audit pan. It lets QA bring edge instances into
// the centre of the browser without changing their transforms or the shipped
// camera. Example: `?treeAudit=-8` inspects the far-left outer band.
const TREE_AUDIT_PAN =
  import.meta.env.DEV && typeof window !== 'undefined'
    ? THREE.MathUtils.clamp(
        Number.parseFloat(new URLSearchParams(window.location.search).get('treeAudit') ?? '0') || 0,
        -20,
        20
      )
    : 0
/*
  VISUAL-13.10a (2026-08-30): the two outer tents were mirror images at the same
  depth and the same angle — was z -5.4 / yaw ±0.46 for both.

  Three identical meshes recoloured, evenly spaced, at one depth, on a flat
  horizon is a menu. Pitching them at slightly different depths and angles is
  what makes it a place somebody set up. The variation is deliberately small:
  the middle tent stays on x = 0 because the responsive framing is built around
  it being centred, and all three still sit comfortably inside the lobby frame
  at every aspect the site supports.

  Scale is *not* varied. The journal, the bench and the reading camera all live
  in the tent's own frame, so scaling a tent scales its book and the pose that
  reads it — three differently sized spreads for the sake of a few centimetres
  of silhouette is the wrong trade. See DECISIONS in VISUAL_CHANGES.md.
*/
const TENTS = [
  { x: CAMP_X - 8.2, z: -5.05, yaw: 0.53 },
  // Exactly square to the lobby camera when the pointer is centred.
  { x: CAMP_X, z: -8.15, yaw: 0 },
  { x: CAMP_X + 8.2, z: -5.85, yaw: -0.4 },
]
const MOON_KEY_NAME = 'camp-moon-key'

/** Aim the existing moon shadow camera without changing the light itself. */
function aimMoonShadow(
  light: THREE.DirectionalLight,
  tentIndex: number | null
) {
  const cam = light.shadow.camera as THREE.OrthographicCamera
  if (tentIndex !== null) {
    const tent = TENTS[tentIndex]
    const size = 3.4
    cam.left = -size
    cam.right = size
    cam.top = size
    cam.bottom = -size
    light.position.set(
      tent.x + MOON_LIGHT.x * 26,
      MOON_LIGHT.y * 26,
      tent.z + MOON_LIGHT.z * 26
    )
    light.target.position.set(tent.x, 0.7, tent.z)
  } else {
    cam.left = -24
    cam.right = 24
    cam.top = 22
    cam.bottom = -14
    light.position.set(MOON_LIGHT.x * 42, MOON_LIGHT.y * 42, MOON_LIGHT.z * 42)
    light.target.position.set(CAMP_X, 0, -3)
  }
  // The target is not in the scene graph, so the shadow camera cannot update
  // it automatically before reading its world position.
  light.target.updateMatrixWorld()
  cam.updateProjectionMatrix()
}
const FIREFLY_TENT_EXCLUSIONS = TENTS.map(({ x, z, yaw }) => ({
  x,
  z,
  yaw,
  halfWidth: HALF_W + 0.12,
  halfDepth: BACK + 0.16,
  maxY: TENT.rawHeight * TENT.scale + 0.12,
}))
/** Exact sRGB canvas bases: About maroon, Gameplay sand, Projects charcoal. */
const TENT_TINT = ['#5A2F38', '#9A896C', '#394A53'] as const
/**
 * Screen-space accents matched to the canvas as it appears under camp light:
 * brick-maroon, warm sand, and muted blue-teal. They are lifted only enough
 * to remain legible against the trees; the previous pastel values drifted too
 * far toward pink, white, and cyan.
 */
const TENT_GLOW = ['#a84f50', '#c8aa70', '#54777b'] as const
/** Dyed leather accents shared by all three variants of the About book mesh. */
const BOOK_ACCENT = ['#7f3443', '#8b7650', '#3b8f91'] as const
/** One weathered, neutral wood base shared by every tent frame. */
const TENT_WOOD = '#5B3B29'
const TENT_WOOD_ROUGHNESS = 0.82
const TENT_RIBBON = '#24170F'
const TENT_RIBBON_ROUGHNESS = 0.78
const TENT_INTERIOR_LIGHT = '#ffb06a'
const TENT_INTERIOR_COLOR = /* @__PURE__ */ new THREE.Color(TENT_INTERIOR_LIGHT)
const TENT_LABEL = ['About', 'Gameplay', 'Projects']
/** One shared post-exit guard for both the tent outline and hover scale. */
const EXIT_HOVER_GUARD_MS = 1000
/** Shared delay from choosing a tent to both glowing and opening its book. */
const BOOK_INTERACTION_DELAY_MS = 1300
/** Rate used by the camera's exponential walk-in progress. */
const TENT_TRAVEL_DAMPING = 1.33
/** Travel reached after the shared interaction delay at the rate above. */
const BOOK_OPEN_TRAVEL_THRESHOLD =
  1 - Math.exp((-TENT_TRAVEL_DAMPING * BOOK_INTERACTION_DELAY_MS) / 1000)

const EYE = 2.15

/** Enables production diagnostics only when the local profiling harness asks. */
const PROFILE_INSPECT =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('profile') === '1'

/**
 * Dev-only freezes, so a damped animation can be screenshotted.
 *
 * `?travel=` pins the walk-in, `?book=` pins how far the journal has opened.
 * Both exist because the headless capture runs at about a frame a second, so
 * anything that eases toward a target never arrives inside a sane wait.
 */
function frozen(param: string) {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get(param)
  return v === null || Number.isNaN(Number(v)) ? null : Number(v)
}
const FROZEN_TRAVEL = frozen('travel')
const FROZEN_BOOK = frozen('book')
/** `?hot=1` pins a tent's hover highlight on, so it can be screenshotted. */
const FROZEN_HOT = frozen('hot')
/** Dev-only profiler switches; production always renders the complete preset. */
const PROFILE_SHADOWS = frozen('shadows') !== 0
const PROFILE_FIREFLIES = frozen('fireflies') !== 0
const PROFILE_LEAVES = frozen('leaves') !== 0
const FIRE_POS: [number, number, number] = [CAMP_X, 0, 1.2]

/**
 * The low bench the journal lies open on, in the tent's own frame.
 *
 * The journal used to lie on the ground, which meant the only pose that could
 * read it was a near-horizontal one looking along the page. On a bench the
 * camera can come down over the top of it instead.
 *
 * The camp bench, not the pack's table: the table is a trestle a metre and a
 * half tall, which inside a tent this size is a workbench filling the room.
 * Raw mesh is 0.929 x 0.648 x 2.004, turned a quarter so the long axis runs
 * across the tent rather than into it.
 */
const BENCH = {
  scale: 0.78,
  top: 0.648 * 0.78,
  z: -BACK * 0.5,
} as const

/** Where the journal lies inside a tent, in the tent's own frame. */
const BOOK_LOCAL = new THREE.Vector3(0, BENCH.top, BENCH.z + 0.02)
/**
 * Width of the *open spread*, in metres — the shut board is a little over half.
 *
 * Down from 0.6 with the deeper page (see `PAGE_DEPTH`). The two together are
 * what turn the journal from a wide slab into a portrait book: the board keeps
 * its height in the frame and loses about 6% across, and the candles either
 * side of it — which are placed in the tent, not on the book — stay where they
 * were, so the shot gains the air around the journal that it was missing.
 */
const BOOK_WIDTH = 0.561

/**
 * Reading pose, relative to the journal: how far back toward the door the eye
 * sits and how far above it. Roughly 66 degrees down from horizontal — near
 * enough over the top of the spread that the type is square to the lens, while
 * keeping enough of an angle that it still reads as a book on a bench rather
 * than as a flat scan of one. It was 57, and at 57 the head of both pages
 * raked away far enough to cost legibility.
 *
 * The distance is set by the page, not by the pitch: closer than about 0.8m
 * the open spread is deeper than the frame is tall and the foot of both pages
 * is cropped.
 */
const READ_BACK = 0.33
const READ_RISE = 0.73

/**
 * Aspect the reading shot is composed at, and the vertical field it is composed
 * with.
 *
 * The pose is 0.80m off the board, pitched about 66 degrees down. The authored
 * Unity layouts span the full bench, so the reading field is intentionally
 * wider than the old book-only composition: the journal remains central while
 * the lantern, tools, and outermost props all stay inside the frame.
 */
const READ_ASPECT = 1810 / 869
const BENCH_READ_FOV = 72
const OPEN_BOOK_FOV = 42

/**
 * The reading field at a given aspect: contain, not cover.
 *
 * A fixed vertical field is a *cover* fit. Narrow the window and the horizontal
 * field closes with it, so the journal grows across the frame until the boards
 * run off both edges and the candles are gone. Holding the *horizontal* field
 * and letting the vertical one open instead means a narrower viewport shows
 * more tent above and below the book and never less of it across — the book
 * cannot swell into the frame or be cropped out of it.
 *
 * The vertical field is never allowed below its composed value, so a viewport
 * wider than the reference gets more room at the sides rather than a bigger
 * book. There is a stop at the other end: a contain fit on a window taller than
 * it is wide asks for better than 80 degrees, and by then the frame has run off
 * the far edge of the bench and is showing what is under it. The stop is set
 * where it is — not tighter — because the two candles are the first thing a
 * tighter one costs, and the brief for this shot is that they stay in it. It
 * only starts to bite below about 1.3:1, and portrait on touch is behind the
 * landscape gate anyway.
 */
const BENCH_READ_FOV_MAX = 82
const OPEN_BOOK_FOV_MAX = 76
function containedReadFov(aspect: number, baseFov: number, maxFov: number) {
  const halfV = Math.tan(THREE.MathUtils.degToRad(baseFov) / 2)
  const half = Math.min(
    Math.tan(THREE.MathUtils.degToRad(maxFov) / 2),
    Math.max(halfV, (halfV * READ_ASPECT) / aspect)
  )
  return THREE.MathUtils.radToDeg(Math.atan(half)) * 2
}

/** Wide while surveying the setup, then back to the original book close-up. */
function readFov(aspect: number, open: number) {
  const bench = containedReadFov(aspect, BENCH_READ_FOV, BENCH_READ_FOV_MAX)
  const book = containedReadFov(aspect, OPEN_BOOK_FOV, OPEN_BOOK_FOV_MAX)
  return THREE.MathUtils.lerp(bench, book, smoothstep(0.05, 0.9, open))
}

/**
 * How far the reading pose drops below the pitch line, in metres.
 *
 * The journal was not centred in its own shot: shut, it left 190px of tent
 * above it and 63px below on a 900px viewport, so it read as having slid down
 * out of frame. The eye and the aim point are dropped *together*, which leaves
 * the view direction — and so the angle the spread is read at — untouched and
 * simply moves the book up the frame. Both gaps scale with frame height, so
 * the balance holds at any aspect.
 *
 * At -0.088 the shut book sits at about 104 above / 91 below and the open
 * spread at 122 / 123;
 * the two states cannot be perfect at once because the spread is shallower
 * than the board, so this splits them.
 */
const READ_FRAME_LIFT = -0.088

/**
 * And how far it then slides *in the frame*, in metres at the book's distance.
 *
 * Not the same move as the lift above. Raising the eye and the aim point
 * through world Y leaves the view direction alone but carries the eye away
 * from the book along it, so the journal changes size as well as position —
 * which is why every attempt to nudge the composition down also shrank it by
 * a tenth. This shift is struck along the frame's own up axis, perpendicular
 * to the view, and is therefore a pure translation of the picture: positive
 * raises the camera in its own plane, which walks the whole scene — book,
 * candles, rails and the tabletop's horizon together — down the frame.
 */
const READ_FRAME_SHIFT = 0.022

/**
 * Height the lens holds while it is threading the doorway.
 *
 * Ray-casting the tent along its centre line puts the lintel at about 1.22m.
 * The old 0.8 cleared that on paper and hit it in practice, because the camera
 * follows a damped target and trails it by half a metre whenever the target is
 * moving quickly. Dropping to well under half the opening's height buys enough
 * margin for the lag, and it is also what the reference sketch asks for: the
 * path goes *down* to pass the door, not through the middle of it.
 */
const DUCK_Y = 0.58

/**
 * Points in a tent's own frame, in world space.
 *
 * Once the outer tents were turned to face the fire, treating "into the tent"
 * as -Z walked the camera into the side wall. Everything below is derived from
 * the tent's forward vector instead.
 */
function tentFrame(index: number) {
  const t = TENTS[index]
  const fx = Math.sin(t.yaw)
  const fz = Math.cos(t.yaw)
  const at = (side: number, depth: number) =>
    new THREE.Vector3(
      t.x + fx * depth + fz * side,
      0,
      t.z + fz * depth - fx * side
    )
  return {
    yaw: t.yaw,
    fx,
    fz,
    /** Doorway plane. */
    door: at(0, BACK),
    /** Standing spot inside, just past the flap. */
    inside: at(0, BACK - 0.9),
    /** Approach point, out in the clearing. */
    approach: at(0, BACK + 2.1),
    origin: new THREE.Vector3(t.x, 0, t.z),
    /**
     * Where the label, chevron and bead trail hang.
     *
     * Derived from the tent's forward vector like everything else here. Placed
     * at a flat world +Z offset instead, the trails on the two outer tents
     * drifted off their own doorways as soon as those tents were turned to
     * face the fire — the offset has to follow the tent, not the world.
     */
    sign: at(0, BACK * 0.45),
    /** The journal, and the pose that reads it. */
    book: at(BOOK_LOCAL.x, BOOK_LOCAL.z),
    readEye: at(BOOK_LOCAL.x, BOOK_LOCAL.z + READ_BACK),
    /**
     * Where the lens is aimed as it settles onto the spread — a little past
     * the book on the way in, a little short of it once it has arrived.
     *
     * Both are struck along the *tent's* forward axis rather than by nudging
     * the world Z of `book`. A raw Z offset is only the same thing for the
     * middle tent: the outer two are turned 26 degrees to face the fire, so a
     * few centimetres of world Z lands sideways of their books and yaws the
     * camera off the spine by two or three degrees. That is exactly the tilt
     * that made the About and Projects journals sit crooked on the table while
     * the Gameplay one looked square.
     */
    bookLookFar: at(BOOK_LOCAL.x, BOOK_LOCAL.z + 0.06),
    bookLookNear: at(BOOK_LOCAL.x, BOOK_LOCAL.z - 0.02),
  }
}

/** Ground point just outside a tent's doorway, for the spill pool. */
function tentDoorSpill(index: number) {
  const t = TENTS[index]
  const fx = Math.sin(t.yaw)
  const fz = Math.cos(t.yaw)
  const depth = BACK + 0.85
  return { x: t.x + fx * depth, z: t.z + fz * depth }
}

/** World positions of a tent's two door torches. */
/** World positions of a tent's two door torches. */
function tentTorches(index: number) {
  const t = TENTS[index]
  const fx = Math.sin(t.yaw)
  const fz = Math.cos(t.yaw)
  const depth = BACK + 0.35
  return [-1, 1].map((s) => {
    const side = s * HALF_W * 0.72
    return { x: t.x + fx * depth + fz * side, z: t.z + fz * depth - fx * side }
  })
}

/** Hermite ramp, clamped. */
function smoothstep(a: number, b: number, x: number) {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/* ------------------------------------------------------------------ ground */

/** Radial alpha mask reused by the campsite's broad contact shadows. */
function makeDiscMask(stops: [number, number][]) {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.5)
  for (const [at, a] of stops) g.addColorStop(at, `rgba(255,255,255,${a})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(c)
}

/** One texture for every tent's contact shadow — it never changes. */
const contactShadow = /* @__PURE__ */ (() =>
  typeof document === 'undefined'
    ? null
    : makeDiscMask([
        [0, 0.95],
        [0.42, 0.6],
        [1, 0],
      ]))()

/**
 * One authored shadow bake for the static furniture inside every tent.
 *
 * A single stretched disc made the whole bench-and-seat area read as one dark
 * puddle. This mask keeps the broad, soft occlusion under the bench separate
 * from the tighter floor-pillow contact and adds only a faint connecting penumbra.
 * It is still one texture and one draw per tent, with no shadow-map updates.
 */
function makeTentInteriorShadowMask() {
  const w = 256
  const h = 192
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'lighter'

  const ellipse = (x: number, y: number, rx: number, ry: number, strength: number) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(1, ry / rx)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
    g.addColorStop(0, `rgba(255,255,255,${strength})`)
    g.addColorStop(0.42, `rgba(255,255,255,${strength * 0.72})`)
    g.addColorStop(0.76, `rgba(255,255,255,${strength * 0.22})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, rx, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  ellipse(w * 0.5, h * 0.35, w * 0.44, h * 0.19, 0.92)
  ellipse(w * 0.5, h * 0.73, w * 0.19, h * 0.16, 0.9)
  ellipse(w * 0.5, h * 0.53, w * 0.27, h * 0.2, 0.18)

  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.NoColorSpace
  return texture
}

const tentInteriorShadow = /* @__PURE__ */ (() =>
  typeof document === 'undefined' ? null : makeTentInteriorShadowMask())()

/**
 * Soft, slightly irregular footprint for the close-detail soil inside a tent.
 *
 * The tent has no authored floor mesh: without this patch the reading camera
 * sees the 360m landscape material, whose maps repeat at landscape scale. A
 * distance field keeps the replacement entirely under the canvas and avoids a
 * rectangular decal edge at the doorway.
 */
function makeTentFloorMask() {
  const size = 192
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const image = ctx.createImageData(size, size)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5
      const v = (y + 0.5) / size - 0.5
      const edgeNoise =
        Math.sin(x * 0.31 + y * 0.17) * 0.006 +
        Math.sin(x * 0.071 - y * 0.113) * 0.009
      const qx = Math.abs(u) - (0.455 + edgeNoise)
      const qy = Math.abs(v) - (0.43 + edgeNoise * 0.7)
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
      const fade = clamp01(1 - (outside + 0.012) / 0.055)
      const a = fade * fade * (3 - 2 * fade)
      const i = (y * size + x) * 4
      image.data[i] = image.data[i + 1] = image.data[i + 2] = Math.round(a * 255)
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.NoColorSpace
  return texture
}

/**
 * Radius of the trodden clearing round the fire.
 *
 * Tighter than the paved circle it replaces. Bare earth reads as bare earth
 * only where there is a reason for it — inside the ring of benches, where feet
 * actually fall — and a wider patch than the firelight covers came out as a
 * flat grey pad in the middle of the frame.
 */
const WALK_R = 4.65

/**
 * Half-width of a trodden path, in metres.
 *
 * Wide enough to read from the lobby camera, narrow enough that it does not eat
 * the clearing. See VISUAL-13.9.
 */
const PATH_HALF = 0.85

/**
 * Whether a point falls on one of the three paths from the fire to a doorway.
 *
 * Distance from the point to each segment, done in the flat plane. The paths
 * run from the edge of the paved ring out to a metre short of each threshold,
 * so neither end is a hard stop against something else's boundary.
 */
function onTentPath(x: number, z: number) {
  for (let i = 0; i < TENTS.length; i++) {
    const t = TENTS[i]
    const fx = Math.sin(t.yaw)
    const fz = Math.cos(t.yaw)
    const depth = BACK + 0.5
    const ax = FIRE_POS[0]
    const az = FIRE_POS[2]
    const bx = t.x + fx * depth
    const bz = t.z + fz * depth
    const dx = bx - ax
    const dz = bz - az
    const len2 = dx * dx + dz * dz
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
    const px = ax + dx * u
    const pz = az + dz * u
    // Tapers toward the doorway, which is what a path worn by feet does.
    const half = PATH_HALF * (1.15 - 0.35 * u)
    if (Math.hypot(x - px, z - pz) < half) return true
  }
  return false
}

/**
 * The clearing's alpha, with the rim chewed away.
 *
 * A plain radial fade ends the bare ground on a perfect circle, and a perfect
 * circle in a wood reads as a texture decal. Punching irregular bites out of the
 * last fifth of the radius lets the earth run out in tongues with grass closing
 * over them, which is how ground that people have simply walked flat actually
 * ends.
 */
function makeWalkwayMask() {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.5)
  for (const [at, a] of [
    [0, 1],
    [0.62, 1],
    [0.82, 0.9],
    [0.95, 0.42],
    [1, 0],
  ] as [number, number][]) {
    g.addColorStop(at, `rgba(255,255,255,${a})`)
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const r = rng(4242)
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2
    const rad = size * (0.30 + r() * 0.21)
    const br = size * (0.02 + r() * 0.075)
    const x = size / 2 + Math.cos(a) * rad
    const y = size / 2 + Math.sin(a) * rad
    const bg = ctx.createRadialGradient(x, y, 0, x, y, br)
    bg.addColorStop(0, 'rgba(0,0,0,0.95)')
    bg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = bg
    ctx.beginPath()
    ctx.arc(x, y, br, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  return new THREE.CanvasTexture(c)
}

/**
 * Soft, irregular alpha for the three worn footpaths.
 *
 * The path geometry is deliberately simple; the edge is what stops it reading
 * as a rectangular decal. A blurred, slightly wandering capsule gives the dirt
 * a trampled boundary that grass can close over without introducing another
 * authored texture.
 */
function makePathMask() {
  const width = 256
  const height = 128
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')!
  const r = rng(8151)
  const top: [number, number][] = []
  const bottom: [number, number][] = []

  for (let i = 0; i <= 16; i++) {
    const x = 12 + (i / 16) * (width - 24)
    const endFade = Math.sin((i / 16) * Math.PI)
    const half = (42 + (r() - 0.5) * 13) * (0.38 + endFade * 0.62)
    top.push([x, height / 2 - half])
    bottom.push([x, height / 2 + half])
  }

  ctx.filter = 'blur(5px)'
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.moveTo(top[0][0], top[0][1])
  for (const [x, y] of top.slice(1)) ctx.lineTo(x, y)
  for (const [x, y] of bottom.reverse()) ctx.lineTo(x, y)
  ctx.closePath()
  ctx.fill()
  ctx.filter = 'none'

  // A few small bites keep even the blurred edge from becoming one perfect
  // stroke. They live at the sides, never in the path's readable centre.
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 24; i++) {
    const x = 18 + r() * (width - 36)
    const side = r() > 0.5 ? 1 : -1
    const y = height / 2 + side * (35 + r() * 18)
    const radius = 3 + r() * 9
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius)
    g.addColorStop(0, 'rgba(0,0,0,0.8)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'

  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.NoColorSpace
  return texture
}

/** World transforms for the paths, from the clearing to each doorway. */
function campPaths() {
  return TENTS.map((_, index) => {
    const door = tentDoorSpill(index)
    const dx = door.x - FIRE_POS[0]
    const dz = door.z - FIRE_POS[2]
    const full = Math.hypot(dx, dz)
    const ux = dx / full
    const uz = dz / full
    // Let the path disappear under the clearing instead of ending at its rim.
    const inset = WALK_R * 0.55
    const sx = FIRE_POS[0] + ux * inset
    const sz = FIRE_POS[2] + uz * inset
    const length = Math.hypot(door.x - sx, door.z - sz)
    return {
      x: (sx + door.x) * 0.5,
      z: (sz + door.z) * 0.5,
      yaw: Math.atan2(door.x - sx, door.z - sz),
      length,
      width: PATH_HALF * 2.25,
    }
  })
}

function Ground() {
  const [dirt, dirtN, clearingDirt, clearingDirtN] = useLoader(THREE.TextureLoader, [
    '/textures/T_Dirt_Ground_C.webp',
    '/textures/T_Dirt_Ground_N.webp',
    '/textures/T_Dirt_Ground_C_Clean.webp',
    '/textures/T_Dirt_Ground_N_Clean.webp',
  ])

  const walkMask = useMemo(makeWalkwayMask, [])
  const pathMask = useMemo(makePathMask, [])
  const paths = useMemo(campPaths, [])

  useMemo(() => {
    dirt.colorSpace = THREE.SRGBColorSpace
    clearingDirt.colorSpace = THREE.SRGBColorSpace
    for (const t of [dirt, dirtN, clearingDirt, clearingDirtN]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      // Four tiles across an 8.9m disc is a little over two metres of ground
      // per tile, which is close enough to the scale the pack authored it at
      // that the ruts come out life-sized rather than as gravel.
      t.repeat.set(4, 4)
      t.anisotropy = 8
    }
  }, [dirt, dirtN, clearingDirt, clearingDirtN])

  // The field under the grass blades is soil, not a second carpet of green.
  // Separate samplers let the same source map tile at landscape scale here and
  // at close-up scale on the fire circle without mutating either use.
  const fieldDirt = useMemo(() => {
    const t = dirt.clone()
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(120, 120)
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }, [dirt])
  const fieldDirtN = useMemo(() => {
    const t = dirtN.clone()
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(120, 120)
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }, [dirtN])

  // The reading camera is close enough to resolve individual ruts. Keep these
  // samplers independent from both the 120x landscape tiling and the 4x fire
  // clearing tiling so each tent gets roughly metre-scale authored detail.
  const tentFloorDirt = useMemo(() => {
    const t = clearingDirt.clone()
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1.65, 1.35)
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }, [clearingDirt])
  const tentFloorDirtN = useMemo(() => {
    const t = clearingDirtN.clone()
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1.65, 1.35)
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }, [clearingDirtN])
  const tentFloorMask = useMemo(makeTentFloorMask, [])

  /**
   * Where everyone stands: bare trodden earth, no grass and no paving.
   *
   * This was a laid cobble circle, and a laid circle of setts in the middle of
   * a wood is a piece of civic landscaping — it read as a set dressing rather
   * than as a camp somebody made. Ground that has simply been walked flat says
   * the same thing about use without claiming anybody built it.
   *
   * Still parallax-mapped. This disc is the single biggest unbroken surface in
   * frame and it sits right where the eye lands, so a flat colour on it undoes
   * the detail everywhere else, and on earth at a low angle a normal map alone
   * only shifts the shading — the ruts have to actually occlude.
   */
  const earthMat = useMemo(() => {
    // Lambert. There was never a specular term worth having here — see the note
    // on the roughness map below, which is the same argument — and this disc
    // sits in the middle of the frame under a parallax march, so it is the one
    // surface paying for both at once.
    const m = new THREE.MeshStandardMaterial({
      // The clearing uses a median-cleaned copy of the exact same authored
      // soil maps. It removes only the long twig/scratch strokes circled in the
      // reference; color grade, scale, lighting, relief, and edge mask stay put.
      map: clearingDirt,
      normalMap: clearingDirtN,
      // No roughness map. The pack authors this one for a daylit terrain
      // shader and its gloss reads as wet: under a point light a metre off the
      // ground the specular lobe swept the whole disc and the clearing came out
      // looking like a pond with the fire reflected in it.
      normalScale: new THREE.Vector2(0.82, 0.82),
      roughness: 0.96,
      metalness: 0,
      alphaMap: walkMask,
      transparent: true,
      // Warm, because this is the one patch of ground the fire genuinely
      // reaches — it is what the pool of light lands on — but dark enough that
      // the light is what brightens it rather than the texture.
      // A touch up from #5a3f28. Lambert has no specular term, and on this disc
      // the sheen it lost was the one thing carrying a little of the sky's
      // colour into the middle of the frame — the albedo has to make it back.
      color: '#4a2f20',
      emissive: new THREE.Color('#3b1809'),
      emissiveMap: clearingDirt,
      emissiveIntensity: 0.45,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
    // LIGHTING-REWORK (2026-08-17): applyGroundGlow was added here earlier
    // this session (see LIGHTING_TUNING.md for the two real bugs found while
    // wiring it up — worth keeping as a reference if this is revisited) to
    // brighten this disc relative to the surrounding grass. Reverted at the
    // user's explicit request: with the much brighter light budget baked in
    // since, the warm-pool overlay read as a second, different-looking
    // material rather than the same dirt lit brighter, and made the parallax
    // detail wash out to a flat orange disc. Plain dirt + normal map +
    // parallax again, same as every other ground surface in the scene — one
    // material, lit only by the real lights in the scene.
    //
    // Shallower than the paving's: a rut in packed earth is a couple of
    // centimetres, not the step down between two setts.
    //
    // Nine steps rather than sixteen. This is a ray march with a texture fetch
    // per iteration running on the single largest unbroken surface in frame; at
    // this depth the difference between nine samples and sixteen is not visible
    // and the cost of it is.
    applyParallax(m, { depth: 0.012, steps: 9, occlusion: 0.34 })
    return m
  }, [clearingDirt, clearingDirtN, walkMask])

  /** The same packed soil, cooler and drier where the central fire is absent. */
  const pathMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      map: dirt,
      normalMap: dirtN,
      normalScale: new THREE.Vector2(0.72, 0.72),
      roughness: 0.98,
      metalness: 0,
      color: '#6a3f25',
      emissive: new THREE.Color('#4a1d09'),
      emissiveMap: dirt,
      emissiveIntensity: 0.5,
      alphaMap: pathMask,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    })
    return m
  }, [dirt, dirtN, pathMask])

  useEffect(
    () => () => {
      walkMask.dispose()
      pathMask.dispose()
      earthMat.dispose()
      pathMat.dispose()
    },
    [walkMask, pathMask, earthMat, pathMat]
  )

  /*
    Lambert, like the field standing on it. This plane is the single largest
    run of fragments in the frame — it is the whole lower half — and a PBR
    specular lobe on soil at roughness 1 is a cost with no picture attached
    to it.

    Built through `applyGroundGlow` rather than as plain JSX props: the map
    is baked warm/yellow for a daylit field (see `desaturateMap` below), the
    fire and torches need a real pool at this scale rather than a flat tint,
    and the ground past their reach was going to literal (0,0,0) with nothing
    in the frame to read as grass. See wind.ts for why this is fragment-side
    rather than the blades' vertex-side sum — a two-triangle plane has no
    vertices to interpolate a pool between.
  */
  const grassMat = useMemo(() => {
    const m = new THREE.MeshLambertMaterial({
      map: fieldDirt,
      normalMap: fieldDirtN,
      normalScale: new THREE.Vector2(0.62, 0.62),
      color: '#ffffff',
    })
    applyGroundGlow(m, {
      desaturateMap: 0.28,
      mapTint: new THREE.Color('#574638'),
      // Same rust-orange the blades stand in, so the pool under everyone's
      // feet reads as one fire rather than the ground and the grass disagreeing
      // on what colour it is.
      warmColor: new THREE.Color('#e88d48'),
      warmGain: 0.1,
      // The far field's only light once it is out of the fire's reach: the
      // same teal-to-magenta ramp the canopies bounce, flat rather than
      // height-weighted because the ground has no crown to bias toward.
      aurora: { low: AURORA_BOUNCE_LOW, mid: AURORA_BOUNCE_MID, high: AURORA_BOUNCE_HIGH, gain: 0.034 },
      // A small constant lift so the plane past both of those never actually
      // hits (0,0,0) — see NIGHT.ambient for why the scene-wide version of
      // this stays just as small.
      floor: new THREE.Color('#3a332d'),
    })
    // LIGHTING-REWORK (2026-08-17): shares GRASS_GAIN with the blade
    // materials in useKit.ts, so the ?debug panel's "Grass" slider moves the
    // ground plane and the blades standing on it together.
    attachDebugGain(m, GRASS_GAIN)
    return m
  }, [fieldDirt, fieldDirtN])

  const tentFloorMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      map: tentFloorDirt,
      normalMap: tentFloorDirtN,
      normalScale: new THREE.Vector2(0.86, 0.86),
      roughness: 0.97,
      metalness: 0,
      color: '#5a4132',
      alphaMap: tentFloorMask,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    })
    // Five samples are enough at this shallow depth; these three small patches
    // are the only close ground surfaces besides the central clearing.
    applyParallax(m, { depth: 0.008, steps: 5, occlusion: 0.22 })
    return m
  }, [tentFloorDirt, tentFloorDirtN, tentFloorMask])

  useEffect(
    () => () => {
      fieldDirt.dispose()
      fieldDirtN.dispose()
      grassMat.dispose()
      tentFloorDirt.dispose()
      tentFloorDirtN.dispose()
      tentFloorMask.dispose()
      tentFloorMat.dispose()
    },
    [fieldDirt, fieldDirtN, grassMat, tentFloorDirt, tentFloorDirtN, tentFloorMask, tentFloorMat]
  )

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={grassMat}>
        <planeGeometry args={[360, 360]} />
      </mesh>

      <mesh
        rotation-x={-Math.PI / 2}
        position={[FIRE_POS[0], 0.012, FIRE_POS[2]]}
        material={earthMat}
        receiveShadow
      >
        <circleGeometry args={[WALK_R, 72]} />
      </mesh>

      {/* Worn lanes reuse the clearing's soil maps. Their soft masks keep them
          from reading as stamped rectangles. */}
      {paths.map((path, i) => (
        <group key={`path${i}`} position={[path.x, 0.018, path.z]} rotation-y={path.yaw}>
          <mesh rotation-x={-Math.PI / 2} material={pathMat} receiveShadow renderOrder={-1}>
            <planeGeometry args={[path.width, path.length]} />
          </mesh>
        </group>
      ))}

      {/* Close-scale dirt inside each canvas footprint. The bench and pillow
          shadows are painted separately in Tent, so the static lantern never
          pays for a six-face point-light shadow map. */}
      {TENTS.map((tent, i) => (
        <group key={`tent-floor${i}`} position={[tent.x, 0.024, tent.z]} rotation-y={tent.yaw}>
          <mesh rotation-x={-Math.PI / 2} material={tentFloorMat} receiveShadow renderOrder={-1}>
            <planeGeometry args={[HALF_W * 1.9, BACK * 1.78]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------- props */

/**
 * Autumn-heavy mix with a couple of evergreens for contrast.
 *
 * Darker and less saturated than the daylight set they started as. Under a
 * moon these are mostly silhouette; painted at full autumn strength the
 * treeline was the brightest, reddest thing in frame and the camp sat in the
 * middle of a bonfire-coloured wood.
 */
/*
  VISUAL-13.8 (2026-08-30): five tints -> three, and all of them darker and
  closer together.

  Was ['#3d5225', '#4a5c2a', '#2f4a22', '#3a4e2a', '#55501f']. Five species
  colours across seventy trees, each one picked at random per instance, is what
  made the wood read as noise rather than as a stand — the eye reads a canopy by
  its silhouette, and a silhouette needs the values inside it to agree. Three
  values, half a stop apart, in a darker green.
*/
const TREE_TINTS = ['#294131', '#344a36', '#22372b']

/**
 * What the wood is lit *by*, applied on top of the species colour.
 *
 * The autumn tints alone gave every tree in the frame the same warm value, and
 * fifty trees at one value is a silhouette rather than a forest. This pushes
 * the canopy toward the only light that actually reaches it — cold moonlight,
 * harder the further back a tree stands. It is the cheapest possible version of
 * what a real bounce pass would do (a per-instance colour costs nothing at draw
 * time) and it is what separates the near wood from the far one.
 *
 * The magenta companion this used to have is gone with the magenta light that
 * justified it: the wood is navy, and anything violet in it reads as the muddy
 * cast the whole pass exists to remove.
 */
const TREE_MOONLIT = /* @__PURE__ */ new THREE.Color('#25456f')

/**
 * The two quarters the cold light actually arrives from.
 *
 * A single navy target gave the whole wood one hue, and one hue over fifty
 * canopies is the flat wall the depth lerp above was already fighting. There
 * are two coloured sources over this forest, not one — the teal foot of the
 * aurora and the violet it climbs to — so the cold end of each tree's tint is
 * picked from between them by where the tree stands.
 *
 * This is the *static* half of the effect and it is deliberately the smaller
 * half: it is a per-instance colour, so it costs nothing, and it does the job
 * a real bounce pass would do at the scale of the whole stand. The shader term
 * in wind.ts does the rest, on the crowns, and moves.
 */
const TREE_AURORA_TEAL = /* @__PURE__ */ new THREE.Color('#1c6f78')
// VISUAL-13.8 (2026-08-30): '#4a4088' -> '#2a3a6a'. The violet quarter was the
// loudest colour in the wood and the one furthest from anything else in frame.
// Pulled to a blue that still differs from the teal without introducing a third
// hue family.
const TREE_AURORA_VIOLET = /* @__PURE__ */ new THREE.Color('#2a3a6a')

function Scatter() {
  const kit = useKit()

  const grassParts = [kit.grassParts('GrassA'), kit.grassParts('GrassB')]
  const stoneParts = kit.parts('Stone')
  // VISUAL-13.9 (2026-08-30): both flower meshes, sown together as one set.
  // VISUAL-13.9 (2026-08-30): tinted down hard. The pack authors these for
  // daylight with a near-white head and an emissive lift for Unity's HDR
  // pipeline, and dropped into this frame untouched they came out as a band of
  // blown white specks — brighter than the tents, through the bloom, across the
  // middle of the clearing. A flower at night is a pale shape, not a light.
  const flowerParts = useMemo(
    () =>
      tintParts([...kit.parts('Flowers_0'), ...kit.parts('Flowers_1')], '#4e5340', {
        roughness: 1,
        metalness: 0,
        emissive: new THREE.Color('#000000'),
        emissiveIntensity: 0,
      }),
    [kit]
  )
  const benchParts = kit.parts('Bench')

  const scatter = useMemo(() => {
    const r = rng(1337)
    const species = ['TreeA', 'TreeB', 'TreeC'] as const
    const tints = TREE_TINTS.map((c) => new THREE.Color(c))
    const treeGroups = new Map<
      string,
      { items: { pos: [number, number, number]; rotY: number; scale: number }[]; colors: THREE.Color[] }
    >()

    // One flat patch per trunk, gathered as the wood is sown.
    const trunkShadows: { pos: [number, number, number]; tiltX: number; scale: number }[] = []

    const addTree = (
      x: number,
      z: number,
      scale: number,
      random = r,
      fixed?: { species?: (typeof species)[number]; rotY?: number; groundY?: number }
    ) => {
      // Always consume the same three random values so fixed composition trees
      // cannot reshuffle any later tint or scatter placement.
      const speciesRoll = random()
      const picked = fixed?.species ?? species[(speciesRoll * 3) | 0]
      const randomRotY = random() * Math.PI * 2
      // TreeB's foliage contains isolated card fragments that become floating
      // black scratches after the surrounding canopy recedes into distance
      // fog. Reuse TreeC for those placements: the transforms, density, tints,
      // and RNG order remain unchanged, while the shared species batch avoids
      // the two draw calls TreeB used to add.
      const key = picked === 'TreeB' ? 'TreeC' : picked
      const group = treeGroups.get(key) ?? { items: [], colors: [] }
      group.items.push({
        // TreeA and TreeC both carry broad, asymmetric buttress geometry near
        // their bases. Mesh inspection shows it does not settle into a narrow
        // vertical trunk until roughly local y=4. A fixed world offset failed
        // on larger trees (notably outer8 at scale 0.409), so burial must scale
        // with the model and clear the complete authored flare.
        pos: [x, fixed?.groundY ?? -scale * 4.1, z],
        rotY: fixed?.rotY ?? randomRotY,
        scale,
      })
      trunkShadows.push({ pos: [x, 0.02, z], tiltX: -Math.PI / 2, scale: scale * 3.1 })
      // Depth into the frame.
      const depth = clamp01((-z - 7) / 30)
      const tint = tints[(random() * tints.length) | 0].clone()
      // Which of the two cold quarters this tree is standing under. A slow
      // diagonal across the wood, so a stand agrees with itself and the far
      // side of the clearing does not agree with the near one.
      const band = 0.5 + 0.5 * Math.sin(x * 0.085 - z * 0.048)
      const cold = TREE_AURORA_TEAL.clone().lerp(TREE_AURORA_VIOLET, band)
      // Only a trace of navy left in it.
      //
      // At 0.45 this was pulling both ends of the band most of the way back to
      // the one colour the band exists to get away from, and a hue that has
      // been half-mixed with its neighbour is grey — which is precisely what
      // the wood looked like. The aurora is still a fill on top of moonlight;
      // the moonlight is arriving from the key and the hemisphere, and it does
      // not also need to be baked into the albedo.
      cold.lerp(TREE_MOONLIT, 0.22)
      // Cold light climbs with distance — the far canopies are lit by sky and
      // nothing else — and the whole wood loses its own colour as it recedes,
      // which is what stops the treeline reading as a wall. Much further than
      // it went before: the near trees keep a trace of autumn and everything
      // behind them is sky-coloured.
      // The near trees are the ones that still read grey, and this is why: at
      // 0.44 more than half of a front-rank canopy was still the autumn brown
      // below, and a brown albedo under a blue-white key is grey by
      // construction — no amount of gain on the bounce fixes an albedo that is
      // fighting it. The wood keeps a trace of autumn now, not a majority.
      tint.lerp(cold, 0.08 + depth * 0.38)
      // And down overall, but not to silhouette. The pack paints its leaves for
      // daylight, so this still has to come down — the previous value took it
      // far enough that the wood was a black mass against a barely-lighter sky
      // and the frame had no depth behind the camp at all. Near unity for the
      // near trees, easing off with distance so the far band still recedes.
      /*
        VISUAL-13.8 (2026-08-30): 1.32 - depth * 0.14 -> 1.04 - depth * 0.58.

        The old curve was near-flat: a tree forty metres back came out at 93% of
        the value of one at the edge of the clearing, so every rank had the same
        contrast and the same saturation and the treeline read as one wall
        standing alongside the campsite rather than behind it. The back of the
        wood is now a little over a stop down on the front of it, which — with
        the thicker teal fog above — is what puts the camp in front of the
        forest instead of in it.
      */
      tint.multiplyScalar(1.08 - depth * 0.36)
      group.colors.push(tint)
      treeGroups.set(key, group)
    }

    // Close ring: trees crowding the tents, which is what makes the camp read
    // as a clearing in a forest rather than a lawn with props on it.
    for (let i = 0; i < 26; i++) {
      const a = Math.PI * 0.08 + r() * Math.PI * 0.84
      const rad = 12 + r() * 9
      const x = CAMP_X - Math.cos(a) * rad
      const z = -6 - Math.sin(a) * rad * 0.8
      if (z > -6.5) continue
      addTree(x, z, 0.22 + r() * 0.16)
    }

    // Outer band, kept behind the camp: anything out to the sides is off camera
    // and was pure draw-call tax.
    for (let i = 0; i < 46; i++) {
      const a = Math.PI * 0.02 + r() * Math.PI * 0.96
      const rad = 20 + r() * 26
      const x = CAMP_X + Math.cos(a) * rad
      const z = -Math.sin(a) * rad - 8
      if (z > -11) continue
      addTree(x, z, 0.3 + r() * 0.26)
    }

    // Final treeline composition: six real trees close only the visible holes
    // called out in the approved lobby frame. A separate seed keeps every
    // existing tree, grass clump, flower, and stone exactly where it was.
    // Their modest scale overlaps the neighbouring crowns without lifting the
    // skyline over the moon or closing off the aurora.
    const gapTreeR = rng(9041)
    const gapTrees: {
      x: number
      z: number
      scale: number
      species?: (typeof species)[number]
      rotY?: number
    }[] = [
      { x: -17.2, z: -15.4, scale: 0.34 },
      { x: -8.8, z: -16.2, scale: 0.34 },
      { x: -4.1, z: -16.8, scale: 0.34 },
      { x: 4.2, z: -17.1, scale: 0.36 },
      // The last two sit one rank nearer than the first pair on the left. Their
      // trunks and lower crowns close the final cyan openings in the approved
      // lobby frame without raising the treeline silhouette.
      { x: -16.4, z: -13.8, scale: 0.32, species: 'TreeA', rotY: 5.69 },
      { x: -8.1, z: -14.1, scale: 0.33, species: 'TreeA', rotY: 5.69 },
    ]
    gapTrees.forEach(({ x, z, scale, species: fixedSpecies, rotY }) =>
      addTree(x, z, scale, gapTreeR, {
        species: fixedSpecies,
        rotY,
      })
    )

    // Two clumps: GrassA is 40 triangles, GrassB is 200. Splitting evenly put
    // three quarters of the field's triangle count in one of them, so the cheap
    // clump carries the density and the expensive one adds variety.
    const grassItems: { pos: [number, number, number]; rotY: number; scale: number }[][] = [[], []]

    /**
     * @param rMin  inner radius, measured from the fire
     * @param rMax  outer radius
     * @param bias  1 spreads evenly over the annulus, >1 crowds the inner edge
     */
    const sowGrass = (count: number, rMin: number, rMax: number, bias: number, scale: number) => {
      for (let i = 0; i < count; i++) {
        const a = r() * Math.PI * 2
        const rad = rMin + Math.pow(r(), bias) * (rMax - rMin)
        const x = FIRE_POS[0] + Math.cos(a) * rad
        const z = FIRE_POS[2] + Math.sin(a) * rad
        // Nothing behind the lens.
        //
        // This used to cut a 4.8m-wide corridor out of everything past z = 4.5,
        // which from the lobby camera is the whole bottom of the frame: the
        // strip of ground the reader looks *across* to reach the fire came out
        // bald, and a bald strip right at the near edge reads as a hole in the
        // field.
        //
        // LIGHTING-REWORK (2026-08-17): 11.6/10.3 -> 13.2/12.2. The camera's
        // vertical FOV widens on narrower/taller windows to hold the
        // horizontal framing (see CameraRig's `fov` target), which exposes
        // more of the near-field ground than the default 16:9 composition
        // shows — reported as "an empty patch that looks like broken grass"
        // on a resized window. The flat, undressed `grassMat` colour reading
        // as a hole next to jagged, aurora/moonlit-tinted blades was the
        // actual bug; grass now comes in closer to the lens (still with a
        // ~0.8m clearance so blades don't poke through the near clip at
        // any aspect) rather than the bare plane showing at all.
        if (z > 13.2) continue
        if (z > 12.2 && Math.abs(x - CAMP_X) < 1.7) continue
        const dFire = Math.hypot(x - FIRE_POS[0], z - FIRE_POS[2])
        // Overlaps the paving slightly on purpose: tufts closing over the outer
        // setts are what tie the walkway into the clearing, and matching the two
        // radii exactly left a bald ring of bare ground between them.
        if (dFire < WALK_R - 0.75) continue
        // Clear of each tent's footprint, but only just — the old 3.6 left a
        // bare apron in front of every doorway.
        if (TENTS.some((t) => Math.hypot(x - t.x, z - t.z) < 2.85)) continue
        // VISUAL-13.9 (2026-08-30): a corridor of trodden ground from the fire
        // to each doorway. The camp is somewhere people walk between three
        // tents and a fire, and an unbroken field right up to every threshold
        // is the tell that nobody does. Blades inside the corridor are simply
        // not sown; the dirt underneath is what shows. See `PathDecal`.
        if (onTentPath(x, z)) continue
        const far = clamp01((dFire - 6) / 22)
        // VISUAL-13.9 (2026-08-30): 0.62 + r * 0.45 + far * 0.9 -> 0.5 + r *
        // 0.38 + far * 0.62. A shorter field. The old height put the near band
        // over the benches from the lobby camera and turned the bottom third of
        // the frame into one flat olive mass with nothing in it.
        grassItems[i % 3 === 0 ? 1 : 0].push({
          pos: [x, 0, z],
          rotY: r() * Math.PI * 2,
          scale: scale * (0.5 + r() * 0.38 + far * 0.62),
        })
      }
    }

    // The field, and then a heavy band packed against the paving. The clearing
    // is the part of the frame the eye lands on, and one even scatter over the
    // whole disc leaves it looking mown right where it matters.
    // Counts are down about a quarter from where they were. Alpha-cutout
    // foliage is the worst case for a GPU — the depth test cannot reject early,
    // so every blade behind another blade is shaded and then thrown away — and
    // the field is deep enough here that the overdraw is several layers over
    // most of the lower frame. The scale term below is up to compensate, which
    // holds the coverage while drawing fewer of them.
    sowGrass(3300, 2, 32, 0.5, 1.1)
    sowGrass(1950, WALK_R - 0.75, 9.5, 1.35, 1.02)
    // And a third pass over the near apron only — the band between the bench
    // ring and the bottom of the frame. The first two sows spread over a 32m
    // disc, so the few square metres the lens is closest to get the same
    // density as ground thirty metres away, which at this camera height is
    // nowhere near enough to close over.
    sowGrass(1650, 4.2, 11.5, 1.15, 1.16)

    /*
      Flowers, in loose clumps rather than an even sprinkle.

      The kit ships two flower meshes and neither was ever sown. A field broken
      up by a few dozen pale heads reads as ground; the same field without them
      reads as a texture. Kept off the paths and out of the deep field, where
      they would be sub-pixel and cost draw calls for nothing.
    */
    const flowers: { pos: [number, number, number]; rotY: number; scale: number }[] = []
    for (let c = 0; c < 9; c++) {
      const a = r() * Math.PI * 2
      const rad = 5.5 + Math.pow(r(), 0.8) * 12
      const cx = FIRE_POS[0] + Math.cos(a) * rad
      const cz = FIRE_POS[2] + Math.sin(a) * rad
      if (cz > 11) continue
      if (TENTS.some((t) => Math.hypot(cx - t.x, cz - t.z) < 3.1)) continue
      for (let i = 0; i < 5 + ((r() * 5) | 0); i++) {
        const x = cx + (r() - 0.5) * 2.4
        const z = cz + (r() - 0.5) * 2.4
        if (onTentPath(x, z)) continue
        if (Math.hypot(x - FIRE_POS[0], z - FIRE_POS[2]) < WALK_R) continue
        flowers.push({ pos: [x, 0, z], rotY: r() * Math.PI * 2, scale: 0.5 + r() * 0.5 })
      }
    }

    const stones = buildMatrices(
      Array.from({ length: 26 }, () => {
        const a = r() * Math.PI * 2
        const rad = 6 + Math.sqrt(r()) * 18
        return {
          pos: [CAMP_X + Math.cos(a) * rad, 0, Math.sin(a) * rad - 6] as [number, number, number],
          rotY: r() * Math.PI * 2,
          scale: 0.18 + r() * 0.35,
        }
      }).filter((s) => !(s.pos[2] > 2 && Math.abs(s.pos[0] - CAMP_X) < 5))
    )

    // Four benches on a ring round the fire, at the diagonals so the two at the
    // back frame the middle tent's doorway instead of blocking it. The mesh
    // runs along its own +Z, so facing the fire means turning that axis across
    // the ray.
    const BENCH_RING = 3.75
    const benches = buildMatrices(
      [0.25, 0.75, 1.25, 1.75]
        .map((turn) => {
          const a = turn * Math.PI
          return [
            FIRE_POS[0] + Math.sin(a) * BENCH_RING,
            FIRE_POS[2] + Math.cos(a) * BENCH_RING,
          ] as [number, number]
        })
        .map(([x, z]) => ({
          pos: [x, 0, z] as [number, number, number],
          rotY: Math.atan2(FIRE_POS[0] - x, FIRE_POS[2] - z) + Math.PI / 2,
          scale: 1,
        }))
    )

    return {
      trees: [...treeGroups.entries()].map(([key, g]) => ({
        key,
        // The colour list is per instance, so it goes through the same sort the
        // matrices do — see buildMatrices.
        matrices: buildMatrices(g.items, g.colors),
        colors: g.colors,
      })),
      grass: grassItems.map((clump) => buildMatrices(clump)),
      flowers: buildMatrices(flowers),
      stones,
      benches,
      trunkShadows: buildMatrices(trunkShadows),
      benchRing: [0.25, 0.75, 1.25, 1.75].map((turn) => {
        const a = turn * Math.PI
        const x = FIRE_POS[0] + Math.sin(a) * BENCH_RING
        const z = FIRE_POS[2] + Math.cos(a) * BENCH_RING
        return { x, z, yaw: Math.atan2(FIRE_POS[0] - x, FIRE_POS[2] - z) + Math.PI / 2 }
      }),
    }
  }, [])

  const shadowGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  const shadowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        alphaMap: contactShadow ?? undefined,
        color: '#04030a',
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    []
  )
  useEffect(
    () => () => {
      shadowGeo.dispose()
      shadowMat.dispose()
    },
    [shadowGeo, shadowMat]
  )

  return (
    <group>
      {scatter.trees.map(({ key, matrices, colors }) => (
        <InstancedParts
          key={key}
          parts={kit.treeParts(key as 'TreeA' | 'TreeB' | 'TreeC')}
          matrices={matrices}
          colors={colors}
          tintFrom={1}
        />
      ))}
      {grassParts.map((parts, i) => (
        <InstancedParts key={`grass${i}`} parts={parts} matrices={scatter.grass[i]} />
      ))}
      <InstancedParts parts={stoneParts} matrices={scatter.stones} castShadow receiveShadow />
      {/* VISUAL-13.9 (2026-08-30): the kit's flower meshes, sown in clumps.
          Not shadow casters — twenty draw-call-free instances of a two-card
          mesh are not worth a depth pass. */}
      <InstancedParts parts={flowerParts} matrices={scatter.flowers} />
      <InstancedParts parts={benchParts} matrices={scatter.benches} castShadow receiveShadow />

      {/* Contact patches: one per trunk, one under each bench. */}
      <instancedMesh
        args={[shadowGeo, shadowMat, Math.max(1, scatter.trunkShadows.length)]}
        frustumCulled={false}
        renderOrder={-2}
        ref={(mesh) => {
          if (!mesh) return
          scatter.trunkShadows.forEach((m, i) => mesh.setMatrixAt(i, m))
          mesh.instanceMatrix.needsUpdate = true
        }}
      />
      {scatter.benchRing.map((b, i) => (
        <ContactShadow
          key={i}
          position={[b.x, 0.02, b.z]}
          size={[2.6, 1.6]}
          rotation={-b.yaw}
          opacity={0.34}
        />
      ))}
    </group>
  )
}

/**
 * A soft dark patch on the ground under something.
 *
 * The shadow map only covers what the moon can see and only at the resolution
 * a 48-metre frustum allows, which at the foot of a tent is a couple of texels
 * — so the one shadow that decides whether an object is standing on the ground
 * or hovering above it is the one the map cannot draw. These are painted
 * instead: no light, no frustum, no cost worth measuring, and they are the
 * difference between props sitting *in* the clearing and props sitting *on* it.
 */
function ContactShadow({
  position,
  size,
  rotation = 0,
  opacity = 0.5,
  renderOrder = -2,
  alphaMap = contactShadow,
}: {
  position: [number, number, number]
  size: [number, number]
  rotation?: number
  opacity?: number
  renderOrder?: number
  alphaMap?: THREE.Texture | null
}) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, rotation]} renderOrder={renderOrder}>
      <planeGeometry args={size} />
      <meshBasicMaterial
        alphaMap={alphaMap ?? undefined}
        color="#04030a"
        transparent
        opacity={opacity}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  )
}

let lanternBounceTex: THREE.Texture | null = null
function getLanternBounceTex() {
  if (!lanternBounceTex) {
    lanternBounceTex = makeGlowTexture('rgba(255,244,208,0.95)', 'rgba(255,92,18,0.34)')
  }
  return lanternBounceTex
}

// One shared glow texture for the three warm doorway spill pools.
let doorwaySpillTex: THREE.Texture | null = null
function getDoorwaySpillTex() {
  if (!doorwaySpillTex) doorwaySpillTex = makeGlowTexture('rgba(255,255,255,0.85)', 'rgba(255,255,255,0.4)')
  return doorwaySpillTex
}

/**
 * Painted, not lit: a flat additive pool on the ground just outside each
 * tent's doorway, tinted to the same amber as the local interior light.
 *
 * imagestats (item g) showed the current frame's interior glow stopping dead
 * at the threshold where the new target reference has colour spilling out
 * onto the grass. `Tent`'s own `glowLight` is real and short-reach by
 * design (see its own comment — it exists to light the canvas from inside,
 * not the ground outside), so this is the same fake-pool trick as the
 * torches rather than a change to that light's reach.
 */
function DoorwaySpill({
  position,
  color,
  rotation = 0,
  opacity = 0.34,
}: {
  position: [number, number, number]
  color: THREE.Color
  rotation?: number
  opacity?: number
}) {
  return (
    <group position={position} rotation-y={rotation}>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[2.6, 2.6]} />
        <meshBasicMaterial
          map={getDoorwaySpillTex()}
          color={color}
          transparent
          opacity={opacity}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          fog={false}
        />
      </mesh>
      {/* A camera-facing low-frequency scattering lobe makes the warm doorway
          pool visible in the cool air from every approach angle. */}
      <sprite position={[0, 0.94, -0.18]} scale={[3.35, 2.35, 1]}>
        <spriteMaterial
          map={getDoorwaySpillTex()}
          color="#ff6730"
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          fog={false}
        />
      </sprite>
    </group>
  )
}

/* ------------------------------------------------------------------ torches */

/**
 * Ground torch: the pack's stake plus a shader flame and its own light.
 *
 * These were briefly merged — one source hung between each tent's pair, to save
 * three of the scene's point lights — and it did not survive contact with the
 * geometry. The pair stand 2.2m either side of the doorway and rake across the
 * canvas at a glancing angle; a single light in the middle of them is 35cm from
 * that canvas and square on to it, and inverse square over that difference is
 * two orders of magnitude. Tuned to match the fabric it went dark on the grass,
 * tuned to match the grass it lit the tent front like a stage. Three lights is
 * about 2ms of a 32ms frame — the wrong 2ms to spend.
 */
const TORCH_SELF_LUMINANCE_LIMIT = 0.72

/**
 * Keep the torch's original point light and therefore its exact illumination
 * on the campsite, but stop that near-coincident light from clipping the metal
 * basket to white. The limiter is applied only to cloned torch materials; the
 * flame and every surrounding surface still receive the untouched light.
 */
function makeTorchSelfLimitedMaterial(source: THREE.Material) {
  const material = source.clone()
  const previousCompile = source.onBeforeCompile?.bind(source)
  const previousCacheKey = source.customProgramCacheKey.bind(source)

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
       float torchSelfLuminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
       gl_FragColor.rgb *= min(1.0, ${TORCH_SELF_LUMINANCE_LIMIT.toFixed(2)} / max(torchSelfLuminance, 0.0001));`
    )
  }
  material.customProgramCacheKey = () => `${previousCacheKey()}|torch-self-luminance-v1`
  material.needsUpdate = true
  return material
}

function Torch({
  position,
  seed,
  lit = true,
}: {
  position: [number, number, number]
  seed: number
  lit?: boolean
}) {
  const kit = useKit()
  const parts = useMemo(
    () =>
      kit.parts('Torch').map((part) => ({
        ...part,
        material: makeTorchSelfLimitedMaterial(part.material),
      })),
    [kit]
  )
  useEffect(() => () => parts.forEach((part) => part.material.dispose()), [parts])

  return (
    <group position={position}>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geometry} material={p.material} castShadow />
      ))}
      <TorchFlame position={[0, 1.66, 0]} seed={seed} lit={lit} smoke />
    </group>
  )
}

/* ---------------------------------------------------------- tent interiors */

/** Unity-local wick positions after centring each setup on its Book3 pair. */
const BENCH_LANTERN_FLAME = [
  [0.2233434124, 0.1944315835 - LANTERN_CANDLE_TOP_DROP, -0.5452521079],
  [0.2233434124, 0.1944315835 - LANTERN_CANDLE_TOP_DROP, -0.5452521079],
  [0.2888698889, 0.1944315835 - LANTERN_CANDLE_TOP_DROP, 0.5702468261],
] as const

/** One exact layout from the Unity Props scene, fitted to the web tent. */
function TentInterior({
  index,
  lit,
  gain,
  readLight,
  lanternLight,
  lanternSpill,
}: {
  index: number
  /** Whether the interior sources are mounted at all. */
  lit: boolean
  /** 0 outside, 1 once the camera has arrived — see `Tent`. */
  gain: React.RefObject<number>
  readLight: React.RefObject<THREE.PointLight | null>
  lanternLight: React.RefObject<THREE.PointLight | null>
  /** Upward-only room light rooted at the lantern wick. */
  lanternSpill: React.RefObject<THREE.SpotLight | null>
}) {
  const kit = useKit()
  const setup = useBenchSetup(index)
  const flame = [...BENCH_LANTERN_FLAME[index]] as [number, number, number]
  const flameRoom = useMemo(() => {
    const p = new THREE.Vector3(...BENCH_LANTERN_FLAME[index])
    p.multiplyScalar(BENCH.scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    return p.add(BOOK_LOCAL)
  }, [index])
  const spillTarget = useMemo(() => new THREE.Object3D(), [])
  const floorBounce = useRef<THREE.MeshBasicMaterial>(null)
  const wallBounce = useRef<THREE.MeshBasicMaterial>(null)
  const target = useMemo<[number, number, number]>(
    () => [
      flame[0] + 0.18,
      flame[1] + 1.25,
      flame[2] - Math.sign(flame[2]) * 0.34,
    ],
    [flame[0], flame[1], flame[2]]
  )

  useFrame((state) => {
    const flick = fireFlicker(state.clock.elapsedTime * 0.8 + index)
    const k = lit ? gain.current : 0
    if (floorBounce.current) floorBounce.current.opacity = 0.105 * flick * k
    if (wallBounce.current) wallBounce.current.opacity = 0.065 * flick * k
  })

  return (
    <group>
      {/*
        The GLB is already centred on the midpoint of the two Unity Book3
        placeholders. Scale the entire authored arrangement by the same 0.78
        used by the former web bench, turn its long Z axis across the tent, and
        put that centre under the real generated journal.
      */}
      <group position={BOOK_LOCAL} rotation-y={Math.PI / 2} scale={BENCH.scale}>
        <primitive object={setup} dispose={null} />
        <primitive object={spillTarget} position={target} />
        <TorchFlame
          position={flame}
          seed={index * 4.7 + 2.2}
          scale={0.12}
          light={0}
          reach={0}
          strength={1.15}
          brightness={2.35}
          depthTest={false}
          lit={lit}
          hasLight={false}
          gain={gain}
          smoke={false}
          extras={false}
        />
        {lit && (
          <>
            <pointLight
              ref={lanternLight}
              position={flame}
              color="#ff9d52"
              intensity={0}
              distance={1.35}
              decay={2}
            />
            {/*
              The room cue comes from the visible wick, not from an invisible
              source near the entrance. Aim this spill above the lantern so it
              catches the canopy and upper props while the journal, entirely
              below the wick, remains outside the cone. The existing point
              lights that were tuned for the pages stay untouched.
            */}
            <spotLight
              ref={lanternSpill}
              target={spillTarget}
              position={flame}
              color="#ff9d52"
              intensity={0}
              distance={3.4}
              decay={2}
              angle={1.2}
              penumbra={0.78}
            />
          </>
        )}
      </group>

      {lit && (
        <>
          {/* Low-frequency bounced radiance. These cards do not light the
              journal; they only make the wick's position legible on the floor
              and rear canvas, like a tiny pre-baked irradiance probe. */}
          <mesh
            position={[flameRoom.x, 0.031, flameRoom.z + 0.04]}
            rotation-x={-Math.PI / 2}
            renderOrder={0}
          >
            <planeGeometry args={[2.35, 1.95]} />
            <meshBasicMaterial
              ref={floorBounce}
              map={getLanternBounceTex()}
              color="#ff6b22"
              transparent
              opacity={0}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped
              fog={false}
            />
          </mesh>
          <mesh position={[flameRoom.x, 1.18, -BACK + 0.035]} renderOrder={-1}>
            <planeGeometry args={[2.55, 2.05]} />
            <meshBasicMaterial
              ref={wallBounce}
              map={getLanternBounceTex()}
              color="#ff7a2f"
              transparent
              opacity={0}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped
              fog={false}
            />
          </mesh>
        </>
      )}

      {/* Restored exactly from the pre-layout interior: Pillow7 was the floor
          seat in front of the bench, not one of the randomized corner props. */}
      <group
        name={`RestoredPillow${index + 1}`}
        position={[0, 0, BENCH.z + 0.88]}
        rotation-y={0.24}
        scale={0.78}
      >
        {kit.parts('Pillow7').map((part, i) => (
          <mesh
            key={i}
            geometry={part.geometry}
            material={part.material}
            castShadow={false}
            receiveShadow
          />
        ))}
      </group>

      {/*
        The light that actually reads the page: one soft source above the
        bench, far enough up that the inverse square is nearly flat across the
        whole spread. Two wicks at page level cannot do this — they are close
        enough that the near edge of the paper gets ten times what the far edge
        does, which is a blown-out gutter and a black fore edge.

        Higher and dimmer than it was, and its reach is now well past the page.
        Both changes are the same fix: what made the type hard to read was never
        the average level, it was the *gradient* across the sheet, and every
        centimetre this rises flattens that gradient. Its intensity is driven
        per frame from `gain` so it fades up over the walk-in instead of
        snapping on the moment the tent is clicked.
      */}
      {lit && (
        <pointLight
          ref={readLight}
          position={[0, BENCH.top + 1.15, BENCH.z + 0.18]}
          color="#ffd9a8"
          intensity={0}
          distance={4.6}
          decay={2}
        />
      )}
    </group>
  )
}

/* ------------------------------------------------------------------- tents */

function Tent({
  index,
  focus,
  entered,
  active,
  hovered,
  bookOpen,
  roomLit,
  deep,
  exteriorHoverReady,
  rig,
  onEnter,
  onHover,
  onNavigate,
  onZoom,
  onBookOpenRequest,
  bookHovered,
  onBookHover,
  registerBookOutlineTarget,
  onClose,
  registerOutlineTarget,
  onShadowTransformChange,
}: {
  index: number
  focus: React.RefObject<number>
  entered: number | null
  /** True for the tent the camera is physically at — survives `entered` going
      null, which is what lets the journal shut before the camera backs out. */
  active: boolean
  /** True while the camera is in *some* tent — stays true through the walk out. */
  roomLit: boolean
  /** True only once the camera is right up at a journal — the light budget. */
  deep: boolean
  /** Shared one-second post-exit gate for both outline and hover scaling. */
  exteriorHoverReady: boolean
  /** The camera rig's own state, read per frame to drive the interior fade. */
  rig: React.RefObject<RigState>
  hovered: number | null
  bookOpen: React.RefObject<number>
  onEnter: (i: TentIndex) => void
  onHover: (i: TentIndex | null, source: 'tent' | 'label') => void
  onNavigate: (to: string, from?: PageScreenRect) => void
  onZoom?: (src: string, from: PageScreenRect) => void
  /** Fired when the reader clicks this tent's closed journal. */
  onBookOpenRequest: () => void
  bookHovered: boolean
  onBookHover: (index: number, hovered: boolean) => void
  registerBookOutlineTarget: (index: number, node: THREE.Object3D | null) => void
  /** Fired when the journal is closed from its own edge page. */
  onClose: () => void
  /** Registers the rendered tent's drawable meshes with the screen-space outline. */
  registerOutlineTarget: (index: TentIndex, node: THREE.Object3D | null) => void
  /** Marks the shared moon shadow map dirty while this tent's caster transform moves. */
  onShadowTransformChange: () => void
}) {
  // All three tents use the clean blue-painted Blender source. Runtime tinting
  // changes only its canvas pixels, preserving authored leather and wood.
  const cabin = useGLTF(CABIN_BLUE_URL)
  const [cloth, leather] = useTexture([
    TENT_CLOTH,
    TENT_LEATHER_GRAIN,
  ])
  const group = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const setBody = useCallback(
    (node: THREE.Group | null) => {
      body.current = node
      registerOutlineTarget(index as TentIndex, node)
    },
    [index, registerOutlineTarget]
  )
  /** Hover highlight, 0-1, damped per frame. */
  const glow = useRef(0)
  const appliedGlow = useRef(Number.NaN)
  const lantern = useRef<THREE.PointLight>(null)
  const lanternSpill = useRef<THREE.SpotLight>(null)
  const glowLight = useRef<THREE.PointLight>(null)
  const readLight = useRef<THREE.PointLight>(null)
  /**
   * How far inside this tent the camera has got, 0 to 1.
   *
   * Every interior light is driven off this rather than off a boolean, and that
   * is the whole fix for the transition reading as a glitch. The old rig
   * switched the tent's own lamp from its outside setting to its reading
   * setting — a different position, a third of the intensity and a shorter
   * reach — the instant `travel` passed 0.05, which is a step change on the
   * *first frame of the walk-in*: the tent visibly dropped a stop and the
   * torches either side of the door changed with it while the camera was still
   * out in the clearing. Ramped over the last third of the approach instead,
   * the change happens while the lens is already through the doorway and there
   * is nothing on screen for it to pop against.
   */
  const inside = useRef(0)

  const highlightColor = useMemo(() => new THREE.Color(TENT_TINT[index]), [index])
  /** Lamp colour for this tent — see the light itself. */
  const lampColor = TENT_INTERIOR_LIGHT
  const parts = useMemo(() => {
    // CSS hex input is sRGB; THREE.Color converts it to the renderer's linear
    // working space. Keep the specified design colours exact at this boundary.
    const tint = new THREE.Color(TENT_TINT[index])
    const woodTint = new THREE.Color(TENT_WOOD)
    // Every Fabric030 map is scalar data. Trilinear mipmaps and anisotropy are
    // important here because the weave is deliberately much finer than a pixel
    // in the campsite camera.
    for (const texture of [cloth]) {
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      texture.colorSpace = THREE.NoColorSpace
      texture.generateMipmaps = true
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      texture.anisotropy = 8
      texture.needsUpdate = true
    }
    return collectParts(cabin.scene).map(({ geometry, material }, partIndex) => {
      const source = material as THREE.MeshStandardMaterial
      const m = source.clone()
      const isCloth = source.name.includes('Tent_Canvas')
      const isRibbon = source.name.includes('Tent_Ribbon_Leather')
      const isBakedDetail = source.name.includes('Tent_Baked_Details')
      const isReferenceTent = source.name.includes('Tent_Reference_Baked')
      const isBluePaintedReference = source.name.includes('Tent_Reference_Baked_Blue')
      const role = isReferenceTent
        ? 'ReferenceBaked'
        : isCloth
          ? 'Cloth'
          : isRibbon
            ? 'RibbonLeather'
            : isBakedDetail
              ? 'BakedDetails'
              : 'Wood'
      m.name = `CanvasCabin_${role}_${index}_${partIndex}`
      m.metalness = 0
      m.side = THREE.DoubleSide
      m.emissive = new THREE.Color('#000000')
      // Meshy's emissive atlas contains isolated white flecks. They became
      // visible whenever the tent hover lift enabled emissive colour, including
      // on the rear canvas and at the leather/canvas UV boundary. The authored
      // campsite lights and hover hull provide all intended glow.
      m.emissiveMap = null
      m.emissiveIntensity = 1
      if (m.map) {
        m.map.anisotropy = 8
        m.map.needsUpdate = true
      }

      if (isReferenceTent) {
        // Ground truth: the optimized Meshy reference is one connected mesh
        // with one continuous baked atlas. Keep its UV-defined leather/wood
        // boundaries intact and tint only the light canvas texels per pixel.
        // This avoids every triangle-edge seam introduced by material splits.
        m.color.set('#ffffff')
        m.metalness = 0
        m.metalnessMap = null
        m.roughness = 0.96
        m.roughnessMap = null
        m.envMapIntensity = 0.18
        if (m.normalMap) {
          m.normalMap.anisotropy = 8
          m.normalMap.needsUpdate = true
        }
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uCabinTint = { value: tint }
          shader.uniforms.uReferenceRibbonTint = { value: new THREE.Color(TENT_RIBBON) }
          shader.uniforms.uClothMap = { value: cloth }
          shader.uniforms.uClothScale = { value: TENT_CLOTH_SCALE }
          shader.uniforms.uFabricStrength = { value: TENT_FABRIC_COLOR_STRENGTH }
          shader.uniforms.uCanvasNormalStrength = { value: TENT_FABRIC_NORMAL_STRENGTH }
          shader.uniforms.uFabricRoughnessStrength = {
            value: TENT_FABRIC_ROUGHNESS_STRENGTH,
          }
          shader.uniforms.uFabricAoStrength = { value: TENT_FABRIC_AO_STRENGTH }
          shader.vertexShader = shader.vertexShader
            .replace(
              'void main() {',
              'varying vec3 vReferencePosition;\nvarying vec3 vReferenceNormal;\nvoid main() {'
            )
            .replace(
              '#include <beginnormal_vertex>',
              '#include <beginnormal_vertex>\nvReferenceNormal = normalize(objectNormal);'
            )
            .replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\nvReferencePosition = position;'
            )
          shader.fragmentShader = shader.fragmentShader
            .replace(
              'void main() {',
              `uniform vec3 uCabinTint;
uniform vec3 uReferenceRibbonTint;
uniform sampler2D uClothMap;
uniform float uClothScale;
uniform float uFabricStrength;
uniform float uCanvasNormalStrength;
uniform float uFabricRoughnessStrength;
uniform float uFabricAoStrength;
varying vec3 vReferencePosition;
varying vec3 vReferenceNormal;

vec3 perturbReferenceCanvasNormal(
  vec3 surfPosition,
  vec3 surfNormal,
  vec2 heightGradient,
  float side
) {
  vec3 sigmaX = normalize(dFdx(surfPosition));
  vec3 sigmaY = normalize(dFdy(surfPosition));
  vec3 r1 = cross(sigmaY, surfNormal);
  vec3 r2 = cross(surfNormal, sigmaX);
  float determinant = dot(sigmaX, r1) * side;
  vec3 gradient = sign(determinant) * (heightGradient.x * r1 + heightGradient.y * r2);
  return normalize(abs(determinant) * surfNormal - gradient);
}

void main() {`
            )
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
               float referenceLuma = dot(
                 diffuseColor.rgb,
                 vec3(0.2126, 0.7152, 0.0722)
               );
               float referenceChannelSum = diffuseColor.r + diffuseColor.g + diffuseColor.b;
               float referenceBlueShare = diffuseColor.b / max(referenceChannelSum, 0.001);
               float referenceCanvasMask = ${isBluePaintedReference
                 ? 'smoothstep(0.34, 0.39, referenceBlueShare)'
                 : 'smoothstep(0.28, 0.48, referenceLuma)'};
               float referenceAbsX = abs(vReferencePosition.x);
               float referenceInnerBeamX = 0.207 - 0.70 * vReferencePosition.y;
               float referenceStrapCenterY = 0.13 * referenceAbsX - 0.131;
               float referenceEndpointX = smoothstep(
                 referenceInnerBeamX - 0.032,
                 referenceInnerBeamX - 0.020,
                 referenceAbsX
               ) * (1.0 - smoothstep(
                 referenceInnerBeamX + 0.006,
                 referenceInnerBeamX + 0.018,
                 referenceAbsX
               ));
               float referenceEndpointY = 1.0 - smoothstep(
                 0.035,
                 0.045,
                 abs(vReferencePosition.y - referenceStrapCenterY)
               );
               float referenceFront = smoothstep(0.26, 0.32, vReferencePosition.z);
               float referenceBrightGap = ${isBluePaintedReference
                 ? '0.0'
                 : 'smoothstep(0.30, 0.52, referenceLuma)'};
               float referenceEndpointRepair = referenceEndpointX
                 * referenceEndpointY * referenceFront * referenceBrightGap;
               referenceCanvasMask *= 1.0 - referenceEndpointRepair;
               float referenceCanvasSurface = clamp(
                  referenceLuma / ${isBluePaintedReference ? '0.06392' : '0.58'},
                  0.72,
                  1.12
                );
               vec3 referenceBlend = pow(abs(normalize(vReferenceNormal)), vec3(6.0));
               referenceBlend /= max(
                 referenceBlend.x + referenceBlend.y + referenceBlend.z,
                 0.001
               );
               vec4 referenceFabricX = texture2D(
                 uClothMap,
                 vReferencePosition.yz * uClothScale
               );
               vec4 referenceFabricY = texture2D(
                 uClothMap,
                 vReferencePosition.xz * uClothScale
               );
               vec4 referenceFabricZ = texture2D(
                 uClothMap,
                 vReferencePosition.xy * uClothScale
               );
               float referenceWeave = dot(
                 vec3(referenceFabricX.r, referenceFabricY.r, referenceFabricZ.r),
                 referenceBlend
               );
               float referenceHeight = dot(vec3(
                 referenceFabricX.g,
                 referenceFabricY.g,
                 referenceFabricZ.g
               ), referenceBlend);
               float referenceFabricRoughness = dot(vec3(
                 referenceFabricX.b,
                 referenceFabricY.b,
                 referenceFabricZ.b
               ), referenceBlend);
               float referenceFabricAo = dot(vec3(
                 referenceFabricX.a,
                 referenceFabricY.a,
                 referenceFabricZ.a
               ), referenceBlend);
               float referenceThread = smoothstep(0.27, 0.73, referenceWeave);
               float referenceFabricSurface = mix(
                 1.0,
                 mix(0.93, 1.07, referenceThread),
                 uFabricStrength
               );
               referenceFabricSurface *= mix(
                 1.0,
                 mix(0.97, 1.01, referenceFabricAo),
                 uFabricAoStrength
               );
               diffuseColor.rgb = mix(
                  diffuseColor.rgb,
                  uCabinTint * referenceCanvasSurface * referenceFabricSurface,
                  referenceCanvasMask
                );
               diffuseColor.rgb = mix(
                 diffuseColor.rgb,
                 uReferenceRibbonTint,
                 referenceEndpointRepair
               );`
            )
            .replace(
              '#include <roughnessmap_fragment>',
              `#include <roughnessmap_fragment>
               roughnessFactor = clamp(
                 mix(
                   roughnessFactor,
                   mix(0.84, 1.0, referenceFabricRoughness),
                   uFabricRoughnessStrength * referenceCanvasMask
                 ),
                 0.0,
                 1.0
               );`
            )
            .replace(
              '#include <normal_fragment_maps>',
              `#include <normal_fragment_maps>
               vec2 referenceHeightGradient = vec2(
                 dFdx(referenceHeight),
                 dFdy(referenceHeight)
               );
               normal = perturbReferenceCanvasNormal(
                 -vViewPosition,
                 normal,
                   referenceHeightGradient * uCanvasNormalStrength
                    * referenceCanvasMask,
                 faceDirection
               );`
            )
            .replace(
              '#include <opaque_fragment>',
              `vec3 referenceCanvasCeiling =
                 uCabinTint * 1.18 * referenceFabricSurface + vec3(0.018);
               outgoingLight = mix(
                 outgoingLight,
                 min(outgoingLight, referenceCanvasCeiling),
                 referenceCanvasMask
               );
               #include <opaque_fragment>`
            )
        }
      } else if (isCloth) {
        // The repaired GLB keeps canvas in its own primitive. A low-frequency
        // triplanar weave avoids depending on the source atlas or stretched UVs.
        m.color.set('#ffffff')
        m.map = null
        m.normalMap = null
        m.normalScale.set(TENT_CANVAS.normalStrength, TENT_CANVAS.normalStrength)
        m.roughness = TENT_CANVAS.roughness
        m.roughnessMap = null
        m.metalness = TENT_CANVAS.metalness
        m.metalnessMap = null
        m.envMapIntensity = TENT_CANVAS.envMapIntensity
        m.aoMapIntensity = TENT_CANVAS.aoMapIntensity
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uCabinTint = { value: tint }
          shader.uniforms.uRibbonTint = { value: new THREE.Color(TENT_RIBBON) }
          shader.uniforms.uClothMap = { value: cloth }
          shader.uniforms.uLeatherMap = { value: leather }
          shader.uniforms.uClothScale = { value: TENT_CLOTH_SCALE }
          shader.uniforms.uCanvasNormalStrength = { value: TENT_CANVAS.normalStrength }
          shader.vertexShader = shader.vertexShader
            .replace(
              'void main() {',
              'varying vec3 vCabinObjectPosition;\nvarying vec3 vCabinObjectNormal;\nvoid main() {'
            )
            .replace(
              '#include <beginnormal_vertex>',
              '#include <beginnormal_vertex>\nvCabinObjectNormal = normalize(objectNormal);'
            )
            .replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\nvCabinObjectPosition = position;'
            )
          shader.fragmentShader = shader.fragmentShader
            .replace(
              'void main() {',
              `uniform vec3 uCabinTint;
uniform vec3 uRibbonTint;
uniform sampler2D uClothMap;
uniform sampler2D uLeatherMap;
uniform float uClothScale;
uniform float uCanvasNormalStrength;
varying vec3 vCabinObjectPosition;
varying vec3 vCabinObjectNormal;

vec3 perturbCabinCanvasNormal(vec3 surfPosition, vec3 surfNormal, vec2 heightGradient, float side) {
  vec3 sigmaX = normalize(dFdx(surfPosition));
  vec3 sigmaY = normalize(dFdy(surfPosition));
  vec3 r1 = cross(sigmaY, surfNormal);
  vec3 r2 = cross(surfNormal, sigmaX);
  float determinant = dot(sigmaX, r1) * side;
  vec3 gradient = sign(determinant) * (heightGradient.x * r1 + heightGradient.y * r2);
  return normalize(abs(determinant) * surfNormal - gradient);
}

void main() {`
            )
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
               vec3 cabinBlend = pow(abs(normalize(vCabinObjectNormal)), vec3(6.0));
               cabinBlend /= max(cabinBlend.x + cabinBlend.y + cabinBlend.z, 0.001);
               float cabinWeaveX = texture2D(uClothMap, vCabinObjectPosition.yz * uClothScale).r;
               float cabinWeaveY = texture2D(uClothMap, vCabinObjectPosition.xz * uClothScale).r;
               float cabinWeaveZ = texture2D(uClothMap, vCabinObjectPosition.xy * uClothScale).r;
               float cabinWeave = dot(vec3(cabinWeaveX, cabinWeaveY, cabinWeaveZ), cabinBlend);
               float cabinThread = smoothstep(0.22, 0.78, cabinWeave);
               float cabinLowerEdge = 1.0 - smoothstep(-0.40, -0.19, vCabinObjectPosition.y);
               float cabinDirt = cabinLowerEdge * mix(0.06, 0.12, 1.0 - cabinThread);
               float cabinSurface = mix(0.98, 1.012, cabinThread);
               diffuseColor.rgb = uCabinTint * cabinSurface * (1.0 - cabinDirt);
               float canvasAbsX = abs(vCabinObjectPosition.x);
               float canvasInnerBeamX = 0.207 - 0.70 * vCabinObjectPosition.y;
               float canvasFront = smoothstep(0.27, 0.31, vCabinObjectPosition.z);
               float canvasStrapCenterY = 0.13 * canvasAbsX - 0.131;
               float canvasStrapStart = smoothstep(0.112, 0.122, canvasAbsX);
               float canvasStrapEnd = 1.0 - smoothstep(
                 canvasInnerBeamX - 0.010,
                 canvasInnerBeamX + 0.002,
                 canvasAbsX
               );
               float canvasStrapBand = 1.0 - smoothstep(
                 0.014,
                 0.020,
                 abs(vCabinObjectPosition.y - canvasStrapCenterY)
               );
               float canvasStrapMask = canvasFront * canvasStrapStart
                 * canvasStrapEnd * canvasStrapBand;
               float canvasStrapLength = max(canvasInnerBeamX - 0.105, 0.001);
               vec2 canvasLeatherUv = vec2(
                 mix(0.15, 0.85, clamp(
                   (canvasAbsX - 0.115) / canvasStrapLength,
                   0.0,
                   1.0
                 )),
                 mix(0.20, 0.80, clamp(
                   (vCabinObjectPosition.y - canvasStrapCenterY + 0.020) / 0.040,
                   0.0,
                   1.0
                 ))
               );
               vec3 canvasLeatherSample = texture2D(uLeatherMap, canvasLeatherUv).rgb;
               float canvasLeatherLuma = dot(
                 canvasLeatherSample,
                 vec3(0.2126, 0.7152, 0.0722)
               );
               float canvasLeatherGrain = clamp(canvasLeatherLuma / 0.055, 0.82, 1.16);
               diffuseColor.rgb = mix(
                 diffuseColor.rgb,
                 uRibbonTint * canvasLeatherGrain,
                 canvasStrapMask
               );`
            )
            .replace(
              '#include <roughnessmap_fragment>',
              `#include <roughnessmap_fragment>
               roughnessFactor = mix(
                 roughnessFactor,
                 ${TENT_RIBBON_ROUGHNESS.toFixed(2)},
                 canvasStrapMask
               );`
            )
            .replace(
              '#include <normal_fragment_maps>',
              `#include <normal_fragment_maps>
               vec2 cabinHeightGradient = vec2(dFdx(cabinWeave), dFdy(cabinWeave));
               normal = perturbCabinCanvasNormal(
                 -vViewPosition,
                 normal,
                 cabinHeightGradient * uCanvasNormalStrength,
                 faceDirection
               );`
            )
            .replace(
              '#include <opaque_fragment>',
              `vec3 cabinCanvasCeiling = uCabinTint * 1.16 + vec3(0.015);
               outgoingLight = min(outgoingLight, cabinCanvasCeiling);
               #include <opaque_fragment>`
            )
        }
      } else if (isRibbon) {
        // Original strap faces keep their authored size and position; the
        // repaired material uses a clean crop of the model's leather atlas.
        m.color.set(m.map ? '#ffffff' : TENT_RIBBON)
        m.normalMap = null
        m.roughness = TENT_RIBBON_ROUGHNESS
        m.roughnessMap = null
        m.metalnessMap = null
        m.envMapIntensity = 0.24
      } else if (isBakedDetail) {
        // The Meshy source combines the wooden frame and leather ties in one
        // atlas. Keep that full PBR texture set untouched: only the separately
        // exported Tent_Canvas primitive receives the three runtime tints.
        m.color.set('#ffffff')
        m.metalness = 0
        m.metalnessMap = null
        // Meshy's packed roughness makes the poles read as varnished under the
        // torches. The colour and normal maps carry the useful wood/leather
        // grain; a high uniform roughness keeps both materials naturally matte.
        m.roughness = 0.96
        m.roughnessMap = null
        m.envMapIntensity = 0.18
        if (m.normalMap) {
          m.normalMap.anisotropy = 8
          m.normalMap.needsUpdate = true
        }
        // A few decimated triangles cross the canvas/leather atlas boundary.
        // Tint their light canvas texels per pixel while leaving the dark strap
        // and wood texels fully baked, so no beige wedges appear beside a tie.
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uCabinTint = { value: tint }
          shader.uniforms.uRibbonTint = { value: new THREE.Color(TENT_RIBBON) }
          shader.uniforms.uClothMap = { value: cloth }
          shader.uniforms.uLeatherMap = { value: leather }
          shader.uniforms.uClothScale = { value: TENT_CLOTH_SCALE }
          shader.vertexShader = shader.vertexShader
            .replace(
              'void main() {',
              'varying vec3 vCabinObjectPosition;\nvoid main() {'
            )
            .replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\nvCabinObjectPosition = position;'
            )
          shader.fragmentShader = shader.fragmentShader
            .replace(
              'void main() {',
              `uniform vec3 uCabinTint;
uniform vec3 uRibbonTint;
uniform sampler2D uClothMap;
uniform sampler2D uLeatherMap;
uniform float uClothScale;
varying vec3 vCabinObjectPosition;

void main() {`
            )
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
               float cabinAbsX = abs(vCabinObjectPosition.x);
               float cabinInnerBeamX = 0.207 - 0.70 * vCabinObjectPosition.y;
               float cabinFront = smoothstep(0.27, 0.31, vCabinObjectPosition.z);
               float cabinVertical = smoothstep(-0.39, -0.37, vCabinObjectPosition.y)
                 * (1.0 - smoothstep(0.31, 0.33, vCabinObjectPosition.y));
               float strapCenterY = 0.13 * cabinAbsX - 0.131;
               float strapStart = smoothstep(0.112, 0.122, cabinAbsX);
               float strapEnd = 1.0 - smoothstep(
                 cabinInnerBeamX - 0.010,
                 cabinInnerBeamX + 0.002,
                 cabinAbsX
               );
               float strapBand = 1.0 - smoothstep(
                 0.014,
                 0.020,
                 abs(vCabinObjectPosition.y - strapCenterY)
               );
               float strapMask = cabinFront * cabinVertical * strapStart * strapEnd * strapBand;
               float strapVicinity = 1.0 - smoothstep(
                 0.024,
                 0.045,
                 abs(vCabinObjectPosition.y - strapCenterY)
               );
               float canvasWoodMargin = mix(0.040, 0.008, strapVicinity);
               float canvasInterior = 1.0 - smoothstep(
                 cabinInnerBeamX - canvasWoodMargin - 0.010,
                 cabinInnerBeamX - canvasWoodMargin,
                 cabinAbsX
               );
               float strayCanvas = cabinFront * cabinVertical * canvasInterior
                 * (1.0 - strapMask);
               float bakedWeave = texture2D(
                 uClothMap,
                 vCabinObjectPosition.xy * uClothScale
               ).r;
               float bakedThread = smoothstep(0.22, 0.78, bakedWeave);
               float bakedCanvasSurface = mix(0.98, 1.012, bakedThread);
               diffuseColor.rgb = mix(
                 diffuseColor.rgb,
                 uCabinTint * bakedCanvasSurface,
                 strayCanvas
               );`
            )
            .replace(
              '#include <color_fragment>',
              `#include <color_fragment>
               float strapLength = max(cabinInnerBeamX - 0.105, 0.001);
               vec2 leatherUv = vec2(
                 mix(0.15, 0.85, clamp((cabinAbsX - 0.115) / strapLength, 0.0, 1.0)),
                 mix(0.20, 0.80, clamp(
                   (vCabinObjectPosition.y - strapCenterY + 0.020) / 0.040,
                   0.0,
                   1.0
                 ))
               );
               vec3 leatherSample = texture2D(uLeatherMap, leatherUv).rgb;
               float leatherLuma = dot(leatherSample, vec3(0.2126, 0.7152, 0.0722));
               float leatherGrain = clamp(leatherLuma / 0.055, 0.82, 1.16);
               diffuseColor.rgb = mix(
                 diffuseColor.rgb,
                 uRibbonTint * leatherGrain,
                 strapMask
               );`
            )
            .replace(
              '#include <opaque_fragment>',
              `vec3 bakedCanvasCeiling = uCabinTint * 1.16 + vec3(0.015);
               outgoingLight = mix(
                 outgoingLight,
                 min(outgoingLight, bakedCanvasCeiling),
                 strayCanvas
               );
               #include <opaque_fragment>`
            )
        }
      } else {
        m.color.copy(woodTint)
        m.map = null
        m.normalMap = null
        m.roughness = TENT_WOOD_ROUGHNESS
        m.roughnessMap = null
        m.metalnessMap = null
        m.envMapIntensity = TENT_CANVAS.envMapIntensity
      }
      m.customProgramCacheKey = () =>
        `canvas-cabin-${role.toLowerCase()}-painted-v7-${TENT_FABRIC_PREVIEW ? 'fabric030-packed' : 'plain'}`
      ALL_STANDARD_MATERIALS.push(m)
      TENT_MATERIALS.push(m)
      return { geometry, material: m }
    })
  }, [cabin, cloth, leather, index])

  useEffect(() => () => parts.forEach((p) => p.material.dispose()), [parts])

  const glowParts = parts

  const isHovered = hovered === index
  const entering = entered === index
  const t = TENTS[index]
  /**
   * Light budget. Outside, every tent keeps its lantern and its two torches, so
   * the camp reads the way it always did. Once the camera is right up at a
   * journal, the other two go dark — nothing of them is on screen, and each
   * point light saved is one fewer evaluated per fragment across the whole
   * frame.
   *
   * `deep`, not `roomLit`: the old gate fired at the start of the walk-in, so
   * six torches went out across the clearing while the camera was still looking
   * at it.
   */
  const here = !deep || active
  /**
   * Whether the interior *props* are built. The interior *lights* are not gated
   * on this — see MOUNTED_POINT_LIGHTS.
   */
  const roomActive = roomLit && active

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    let shadowTransformChanged = false
    const near = clamp01(1 - Math.abs(focus.current - index))
    /*
      The focus rise is a lobby affordance, and it has to stop at the doorway.

      It lifts whichever tent the scroll is nearest by five centimetres, and the
      journal is inside that tent — so the middle tent, which is what the scroll
      rests on by default and what the focus is frozen at the moment a tent is
      entered, read its book five centimetres higher than the other two. At the
      reading pose that is a book seven per cent larger and fifty pixels up the
      frame, which is why the Gameplay journal alone came within a few pixels of
      the top of the shot while About and Projects sat centred.
    */
    const rise = entered === null ? near * 0.05 : 0
    const nextY = g.position.y + (rise - g.position.y) * damp(5, delta)
    if (nextY !== g.position.y) {
      g.position.y = nextY
      shadowTransformChanged = true
    }

    // How far in the camera is. Held at zero for the two tents it is not
    // walking into, so their interiors never light.
    //
    // Read through the same easing the rig uses, or the ramp and the camera
    // disagree about where "at the doorway" is: the walk-in is eased twice, so
    // a raw travel of 0.58 is already three quarters of the way through the
    // move, and a threshold set on the raw value fires with the lens well past
    // the flap.
    const k = active ? smoothstep(0.62, 0.99, easeInOutCubic(clamp01(rig.current.travel))) : 0
    inside.current = k

    // Outline and scale read the exact same one-second post-exit gate. Keeping
    // separate travel thresholds here made one response return well before the
    // other, so the tent looked like it changed interaction modes twice.
    const hoverEnabled = entered === null && exteriorHoverReady
    const b = body.current
    if (b) {
      const target = isHovered && hoverEnabled ? 1.03 : 1
      const s = THREE.MathUtils.lerp(b.scale.x / TENT.scale, target, damp(7.7, delta)) * TENT.scale
      if (s !== b.scale.x || s !== b.scale.y || s !== b.scale.z) {
        b.scale.setScalar(s)
        shadowTransformChanged = true
      }
      if (import.meta.env.DEV) {
        const w = window as unknown as {
          __tentHover?: { enabled: boolean; scale: number }[]
        }
        ;(w.__tentHover ??= [])[index] = { enabled: hoverEnabled, scale: s / TENT.scale }
      }
    }
    if (shadowTransformChanged) onShadowTransformChange()

    /*
      The hover highlight. Steady, not pulsing — a sine on `state.clock.
      elapsedTime` alone is the same phase for every tent, so all three beat in
      lockstep and only the brightest (the yellow one) made the flicker easy to
      see. That read as a bug because it was one: a highlight is either on or
      off, not breathing on a shared clock nobody asked for.

      **No Fresnel term any more.** There was one, patched into the tent's
      material through `onBeforeCompile` — and it was the thing that put a pale
      wash across the whole roof of a hovered tent, because a roof seen from the
      clearing is at a grazing angle and a Fresnel rim is at its brightest
      exactly there. The outline that is wanted is the single perimeter in
      `campsite/outline.ts`; a rim cannot draw one on flat panels and only ever
      muddied the fabric underneath it.

      Worth knowing why this took two passes to see: the rim's uniform handles
      were built inside the `parts` memo and stashed on a ref, and React's
      StrictMode runs that memo twice in a development build — so the handles on
      the ref belonged to one set of cloned materials and the meshes on screen
      to the other, and every write went to materials nobody was drawing. Dev
      therefore showed a *clean* tent and only the production build showed the
      rim doing its worst. Verified by reading `uGlowStrength` off the compiled
      program on both: 1.21 in prod, 0 in dev, from identical scene state.

      The emissive lift that remains is a trace, not a wash, and it is written
      straight onto the materials the meshes are using.
    */
    const hot = FROZEN_HOT !== null ? FROZEN_HOT === index : isHovered && hoverEnabled
    // Medium, and reached fast rather than eased in. A slow damp here used to
    // spend its first frames sitting under the bloom pass's threshold — a
    // bare outline with no halo — and only cross it a beat later, which read
    // as two different highlights rather than one settling in: dim, then
    // suddenly "a lot more glowy". Snapping to target keeps it on one side of
    // that threshold from the first hovered frame, and 0.55 is picked to sit
    // with some headroom over it without going as hot as 1.0+ did.
    const want = hot ? 0.55 : 0
    const glowNow = THREE.MathUtils.lerp(glow.current, want, damp(40, delta))
    glow.current = glowNow
    if (glowNow !== appliedGlow.current) {
      appliedGlow.current = glowNow
      for (const p of glowParts) {
        ;(p.material as THREE.MeshStandardMaterial).emissive
          .copy(highlightColor)
          .multiplyScalar(glowNow * 0.018)
      }
    }
    const flick = fireFlicker(state.clock.elapsedTime * 0.8 + index)
    // The visible wick remains a stable part of the room while the journal is
    // opened. Page readability is owned by the high, even reading source and
    // the page materials, so the book never appears to switch the lantern off.
    if (lantern.current) {
      lantern.current.intensity = 0.72 * flick * k
    }
    if (lanternSpill.current) lanternSpill.current.intensity = 3.2 * flick * k
    if (readLight.current) readLight.current.intensity = 0.6 * k
    if (glowLight.current) {
      // A localized lamp at the entrance, not tent-wide transmission. It keeps
      // the open doorway warm while the exterior canvas remains moon-lit PBR.
      // Ahead of the ramp, deliberately. The mid-point of a linear crossfade
      // between these two settings is brighter *and* closer to the bench than
      // either end, so the one frame the camera spends coming down over the
      // journal was the frame the bench was most blown out in.
      const g = Math.pow(k, 0.55)
      const l = glowLight.current
      // Keep the outside pose low and near the entrance. The short falloff
      // warms the opening and flap edges without turning the roof into a lamp.
      l.position.set(0, THREE.MathUtils.lerp(1.22, 1.5, g), THREE.MathUtils.lerp(0.18, 0.95, g))
      // `here` scales rather than unmounts — see MOUNTED_POINT_LIGHTS. A light
      // at zero intensity contributes exactly nothing, which is the same
      // picture the old `{here && …}` produced, at none of the cost.
      l.intensity = here ? THREE.MathUtils.lerp(1.35, 0.28, g) : 0
      l.distance = THREE.MathUtils.lerp(2.6, 3.1, g)
    }
  })

  return (
    <group ref={group} position={[t.x, 0, t.z]} rotation-y={t.yaw}>
        <group
          ref={setBody}
          scale={TENT.scale}
          rotation-y={TENT.flip}
          onClick={(e) => {
            e.stopPropagation()
            if (entered === null) {
              sfxUiClick()
              onEnter(index as TentIndex)
            }
          }}
          onPointerOver={(e) => {
            e.stopPropagation()
            onHover(index as TentIndex, 'tent')
          }}
          onPointerOut={() => onHover(null, 'tent')}
          onPointerLeave={() => onHover(null, 'tent')}
          onPointerCancel={() => onHover(null, 'tent')}
        >
          <group position-y={TENT.rawBaseOffset}>
            {parts.map((p, i) => (
              <mesh key={i} geometry={p.geometry} material={p.material} castShadow receiveShadow />
            ))}
          </group>
        </group>

      {/* Local entrance warmth. It moves behind the reading camera during the
          walk-in so it cannot wash out the book; `inside` drives that smoothly. */}
      {/* Always mounted; `here` scales its intensity instead. See
          MOUNTED_POINT_LIGHTS. */}
      <pointLight
          ref={glowLight}
          position={[0, 1.22, 0.18]}
          color={lampColor}
          intensity={1.35}
          distance={2.6}
          decay={2}
        />

      <TentInterior
        index={index}
        lit={active}
        gain={inside}
        readLight={readLight}
        lanternLight={lantern}
        lanternSpill={lanternSpill}
      />

      {/* One authored baked mask grounds the bench and floor seat separately.
          It never invalidates a shadow map when the flame flickers. */}
      <ContactShadow
        position={[0, 0.033, BENCH.z + 0.18]}
        size={[3.35, 2.42]}
        opacity={0.3}
        renderOrder={-2}
        alphaMap={tentInteriorShadow}
      />

      {/*
        The journal, mounted in all three tents from the first frame, built
        during the loading screen, and visible on the bench the whole time —
        it's a thing sitting there, not something that appears when you walk
        in. It stays *shut*, though: `enabled` (below) keeps it closed and
        un-lit until its own room lights, so what's visible from the clearing
        is a closed book, not one already open and readable.

        `here`, not always-on: from inside a *different* tent's reading pose
        the camera looks out over that tent's low walls into the open camp,
        and a book with nothing hiding it is a book in line of sight — its
        cover, which carries the same owner's name on all three, bled through
        as a soft ghost behind whichever tent was actually open. `here` is
        already how the torches decide the same thing.

        This used to be gated on `active` (exactly one journal, built for
        whichever tent the camera happened to be walking into) to dodge two
        costs: 78MB of resident texture across three journals instead of 26MB
        for one, and a four-second shader-compile stall the *first* time a
        second or third tent was ever entered, because its six materials
        (paper, ink, the turning leaf, the cover, the fore edge, the gutter)
        had never existed in the frame before. Paying the 78MB and the compile
        cost up front, on the loading screen, is the trade being made instead.
      */}
      <group visible={here}>
        <Book
          index={index}
          width={BOOK_WIDTH}
          position={[BOOK_LOCAL.x, BOOK_LOCAL.y, BOOK_LOCAL.z]}
          openRef={bookOpen}
          // `roomActive`, not `active`: the journal must stay shut and
          // unrevealed for as long as it is only in the scene to have its
          // shaders built and textures decoded.
          enabled={roomActive}
          accent={BOOK_ACCENT[index]}
          live={entering}
          onNavigate={onNavigate}
          onZoom={onZoom}
          onOpenRequest={onBookOpenRequest}
          closedHot={bookHovered}
          onClosedHover={onBookHover}
          registerOutlineTarget={registerBookOutlineTarget}
          onClose={onClose}
        />
      </group>

      {/* Torches flanking the entrance. */}
      <Torch position={[-HALF_W * 0.72, 0, BACK + 0.35]} seed={index * 2.3} lit={here} />
      <Torch position={[HALF_W * 0.72, 0, BACK + 0.35]} seed={index * 2.3 + 1.7} lit={here} />

    </group>
  )
}

/* ------------------------------------------------------------ tent signage */

function TentSign({
  index,
  hovered,
  onHover,
  onEnter,
  entered,
}: {
  index: number
  hovered: number | null
  onHover: (i: TentIndex | null, source: 'tent' | 'label') => void
  onEnter: (i: TentIndex) => void
  entered: number | null
}) {
  const sign = tentFrame(index).sign

  return (
    <Html
      center
      distanceFactor={13}
      // Removing the tall bead column already lowers the centred label/arrow
      // block on screen. Keep only a small additional drop while leaving clear
      // air between the chevron and the crossed poles.
      position={[sign.x, TOP + 0.77, sign.z]}
      style={{ pointerEvents: entered === null ? 'auto' : 'none', userSelect: 'none' }}
      zIndexRange={[8, 0]}
    >
      <div
        className={`tentsign${hovered === index ? ' is-hot' : ''}`}
        data-hidden={entered !== null}
        aria-hidden={entered !== null}
        style={{
          ['--tent-color' as string]: TENT_TINT[index],
          ['--tent-glow' as string]: TENT_GLOW[index],
        }}
        onPointerEnter={() => onHover(index as TentIndex, 'label')}
        onPointerLeave={() => onHover(null, 'label')}
        onClick={() => {
          if (entered !== null) return
          sfxUiClick()
          onEnter(index as TentIndex)
        }}
      >
        <span className="tentsign__label">{TENT_LABEL[index]}</span>
        {/* Hollow chevron with a short cap turning outward at the top of each
            arm, and a thin rail running out to either side of it. Drawn as
            strokes so the fill stays empty — a solid arrowhead reads as a play
            button. Each path is doubled in CSS: a blurred wide copy for the
            tube of light and a thin bright copy for the filament. */}
        <svg className="tentsign__arrow" viewBox="0 0 132 40" aria-hidden="true">
          <g className="tentsign__tube">
            <path className="tentsign__rail" d="M3 12 H33" />
            <path className="tentsign__rail" d="M99 12 H129" />
            <path className="tentsign__chev" d="M40 7 H47 L66 31 L85 7 H92" />
          </g>
          <g className="tentsign__core">
            <path className="tentsign__rail" d="M3 12 H33" />
            <path className="tentsign__rail" d="M99 12 H129" />
            <path className="tentsign__chev" d="M40 7 H47 L66 31 L85 7 H92" />
          </g>
        </svg>
      </div>
    </Html>
  )
}

/* ------------------------------------------------------------------ camera */

interface RigState {
  entered: number | null
  /** Which tent the camera is physically at — survives `entered` going null. */
  active: number
  travel: number
  /** Reading-lens amount held during exit; zero when the book was never opened. */
  exitBookZoom: number
}

/**
 * Walk-in, in three legs:
 *   0.00-0.42  lobby to the approach point out in the clearing
 *   0.42-0.72  through the doorway, ducked under the lintel
 *   0.72-1.00  down onto the journal
 *
 * Every follow in here is damped through `damp()` rather than a per-frame
 * constant, so the move has the same shape at 30fps as at 144.
 */
function CameraRig({
  state,
  bookOpen,
  focusRef,
  onFocus,
}: {
  state: React.RefObject<RigState>
  bookOpen: React.RefObject<number>
  focusRef: React.RefObject<number>
  onFocus: (i: TentIndex) => void
}) {
  const { camera, pointer, size } = useThree()
  const pos = useMemo(() => new THREE.Vector3(), [])
  const look = useMemo(() => new THREE.Vector3(), [])
  /** Scratch for the reading pose's in-frame slide. See READ_FRAME_SHIFT. */
  const frameUp = useMemo(() => new THREE.Vector3(), [])
  /** Scratch for the doorway segment; avoids allocating a vector every frame. */
  const passage = useMemo(() => new THREE.Vector3(), [])
  const smoothLook = useMemo(() => new THREE.Vector3(CAMP_X, EYE, -4), [])
  const smoothPointer = useMemo(() => new THREE.Vector2(), [])
  const reported = useRef<TentIndex>(1)
  const warmed = useRef(false)

  useFrame((frameState, delta) => {
    const st = state.current
    const cam = camera as THREE.PerspectiveCamera
    const dt = delta

    if (st.entered === null && st.travel < 0.02) {
      const f = clamp01(scrollDriver.smooth) * 2
      focusRef.current += (f - focusRef.current) * damp(6.3, dt)
      const nearest = Math.round(focusRef.current) as TentIndex
      if (nearest !== reported.current) {
        reported.current = nearest
        onFocus(nearest)
      }
    }

    // Follow the tent the camera is actually at. Reading the scroll focus here
    // made an exit start from whichever tent the scroll happened to be nearest,
    // so leaving tent 2 could swing through tent 1 on the way out.
    const idx = st.active
    const tent = TENTS[idx]
    const frame = tentFrame(idx)

    const aspect = Math.max(0.4, size.width / size.height)
    const wide = aspect >= 1.15
    // No sideways drift on a landscape viewport: all three tents already fit,
    // so the only thing the drift did was sit the lobby pose off to one side
    // of the fire, which reads as a mis-aimed camera rather than as parallax.
    // Narrow viewports keep it, because there the camera genuinely has to pan
    // to reach the outer tents.
    const drift = wide ? 0 : 7.6
    const lobbyX = (focusRef.current - 1) * drift
    const lobbyZ = THREE.MathUtils.clamp(
      9.4 / (Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * aspect),
      8.5,
      19
    )

    // Damped pointer. The raw value jumps when the cursor re-enters the window
    // or when a drei Html element swallows a move, which was the source of the
    // occasional camera snap.
    const px = THREE.MathUtils.clamp(pointer.x, -1, 1)
    const py = THREE.MathUtils.clamp(pointer.y, -1, 1)
    const slew = 3.6 * Math.min(dt, 0.1)
    smoothPointer.x += THREE.MathUtils.clamp(px - smoothPointer.x, -slew, slew)
    smoothPointer.y += THREE.MathUtils.clamp(py - smoothPointer.y, -slew, slew)

    const t = easeInOutCubic(clamp01(st.travel))
    let fov = 42

    if (t < 0.42) {
      const k = clamp01(t / 0.42)
      pos.set(
        THREE.MathUtils.lerp(
          CAMP_X + lobbyX + TREE_AUDIT_PAN + smoothPointer.x * 0.8,
          frame.approach.x,
          k
        ),
        // Ends the approach well below the lintel. Arriving at the doorway at
        // eye height and *then* crouching meant the descent had to happen
        // inside the last metre, which the damped follow could not keep up
        // with — see the duck below.
        THREE.MathUtils.lerp(EYE + 1.08 - smoothPointer.y * 0.35, 0.9, k),
        THREE.MathUtils.lerp(lobbyZ, frame.approach.z, k)
      )
      look.set(
        THREE.MathUtils.lerp(CAMP_X + lobbyX * 0.55 + TREE_AUDIT_PAN, frame.origin.x, k),
        // And already aimed low. Looking at the middle of the tent puts the
        // canvas above the door across the top of the frame for the whole
        // approach, which is the first half of "it hits the door frame".
        THREE.MathUtils.lerp(EYE - 0.76, 0.62, k),
        THREE.MathUtils.lerp(tent.z + 1.5, frame.origin.z, k)
      )
      fov = THREE.MathUtils.lerp(42, 44, k)
    } else if (t < 0.72) {
      // Duck through the doorway.
      //
      // Ray-casting the tent along its centre line puts the lintel at ~1.22m:
      // anything at 1.30 hits the front canvas, anything at 1.15 reaches the
      // back wall. Three things matter here.
      //
      // The crouch is keyed to signed distance from the door plane, not to the
      // leg's progress, so the low point lands on the doorway rather than
      // part-way up the approach.
      //
      // It is *flat* across the opening rather than a single dip. The camera
      // follows this target through a damped filter, so it trails the target
      // by a good half metre while the target is moving quickly — with a dip,
      // the lens was still coming down as the target passed under the lintel
      // and it clipped the canvas every time. A plateau from a metre out to
      // half a metre in gives the follow room to settle before the opening.
      //
      // And the eye is aimed at the journal from the moment the leg starts —
      // aiming at the tent's centre pointed the lens at the canvas above the
      // door and filled the screen with fabric for a second and a half.
      const k = clamp01((t - 0.42) / 0.3)
      const depthNow = THREE.MathUtils.lerp(BACK + 2.1, BACK - 0.9, k)
      const sd = depthNow - BACK
      const here = passage.copy(frame.approach).lerp(frame.inside, k)
      const y =
        sd > 1.2
          ? THREE.MathUtils.lerp(0.9, DUCK_Y, clamp01((2.1 - sd) / 0.9))
          : DUCK_Y
      pos.set(here.x, y, here.z)
      look.set(frame.book.x, THREE.MathUtils.lerp(0.66, BOOK_LOCAL.y + 0.02, k), frame.book.z)
      // Narrower through the opening, not wider.
      //
      // This used to open out to 50 at exactly the moment the lens was in the
      // doorway, and a wide lens at a doorway is the *other* half of hitting
      // the frame: the centre line can be perfectly clear while the frame edges
      // are inside the posts. On a 2:1 viewport 50 vertical is 82 horizontal —
      // ±0.87m of wall at a metre out, through an opening about half that wide.
      fov = THREE.MathUtils.lerp(44, 39, k)
    } else {
      // Rise over the journal and pitch down onto it.
      //
      // The whole climb happens here, a clear metre inside the tent, rather
      // than in the last few centimetres of the doorway where the damped follow
      // was still carrying the lens upward as it passed the lintel. The sine
      // term lifts the path a little above the reading height and lets it
      // settle back down onto the book, which is the arc in the reference
      // sketch — the eye comes up, looks over the spread, and drops onto it.
      const k = clamp01((t - 0.72) / 0.28)
      const e = easeInOutCubic(k)
      pos.set(
        THREE.MathUtils.lerp(frame.inside.x, frame.readEye.x, e),
        THREE.MathUtils.lerp(DUCK_Y, BOOK_LOCAL.y + READ_RISE, e) + Math.sin(Math.PI * e) * 0.15,
        THREE.MathUtils.lerp(frame.inside.z, frame.readEye.z, e)
      )
      look.copy(frame.bookLookFar).lerp(frame.bookLookNear, e)
      look.y = THREE.MathUtils.lerp(BOOK_LOCAL.y + 0.02, BOOK_LOCAL.y + 0.01, e)
      // Faded in over the last leg, so the arrival is still one move. See
      // READ_FRAME_LIFT — both are raised by the same amount, which shifts the
      // frame without touching the pitch.
      pos.y += READ_FRAME_LIFT * e
      look.y += READ_FRAME_LIFT * e
      // Then the pure in-frame slide. See READ_FRAME_SHIFT.
      frameUp.subVectors(look, pos).normalize()
      frameUp.set(-frameUp.x * frameUp.y, 1 - frameUp.y * frameUp.y, -frameUp.z * frameUp.y)
      if (frameUp.lengthSq() > 1e-6) {
        frameUp.normalize().multiplyScalar(READ_FRAME_SHIFT * e)
        pos.add(frameUp)
        look.add(frameUp)
      }
      // Once the cover opens, return to the original close reading lens. An
      // exit preserves that lens only if the cover was opened; a closed-book
      // exit retains the wide bench composition and immediately pulls away.
      const bookZoom = st.entered === null ? st.exitBookZoom : bookOpen.current
      fov = THREE.MathUtils.lerp(39, readFov(aspect, bookZoom), e)
    }

    if (st.travel > 0.02 && st.travel < 0.99) {
      pos.y += Math.sin(frameState.clock.elapsedTime * 5.2) * 0.02 * (1 - t)
    }

    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * damp(6.3, dt)
      cam.updateProjectionMatrix()
    }

    // A frozen walk-in has to snap: the screenshot harness renders at about a
    // frame a second, so a damped follow never reaches the pose being tested.
    if (!warmed.current || FROZEN_TRAVEL !== null) {
      warmed.current = true
      camera.position.copy(pos)
      smoothLook.copy(look)
      cam.fov = fov
      cam.updateProjectionMatrix()
    } else {
      // Tighter than the old 0.055-a-frame. The target is already eased twice
      // over — once by the travel ramp, once by easeInOutCubic — so most of
      // what the old filter added was lag rather than smoothness, and lag on a
      // camera that is threading a doorway is what puts the lens in the wall.
      const k = damp(5.5, dt)
      camera.position.lerp(pos, k)
      smoothLook.lerp(look, k)
    }
    camera.lookAt(smoothLook)

    // Dev-only: the reading pose is the one thing in here that cannot be read
    // off a screenshot, and the QA harness needs to be able to tell a framing
    // difference between tents from a camera difference.
    if (import.meta.env.DEV) {
      ;(window as unknown as { __cam?: unknown }).__cam = {
        idx,
        pos: camera.position.toArray(),
        look: smoothLook.toArray(),
        fov: cam.fov,
        travel: st.travel,
        bookOpen: bookOpen.current,
      }
    }
  })

  return null
}

/**
 * The split-tone pass, wrapped for the composer.
 *
 * `postprocessing` effects are plain objects rather than React components, so
 * the instance is built once and handed to the composer as a primitive — the
 * standard way of putting a custom effect in an `<EffectComposer>`.
 */
function SplitTone({ effectRef }: { effectRef?: React.RefObject<SplitToneEffect | null> }) {
  const effect = useMemo(() => new SplitToneEffect(), [])
  useEffect(() => {
    if (effectRef) effectRef.current = effect
    return () => effect.dispose()
  }, [effect, effectRef])
  return <primitive object={effect} dispose={null} />
}

type OutlineInternals = OutlineEffect & {
  maskPass: { overrideMaterial: THREE.ShaderMaterial }
  setFragmentShader: (shader: string) => void
  setChanged: () => void
}

type ActiveOutline = { kind: 'tent' | 'book'; index: TentIndex }

/**
 * Compatibility correction for postprocessing 6.39 with the current renderer.
 * The stock mask clear lands black here, even though the pass requests white,
 * leaving its red silhouette channel empty and the edge buffer blank. Write
 * the selected tent into red explicitly, then retain only samples outside
 * that mask. This preserves both boundaries shown in the reference — the
 * outer mesh silhouette and the doorway opening — without tracing surface
 * seams or putting the luminous band over the canvas.
 */
function configureExteriorOutline(effect: OutlineEffect) {
  const outline = effect as OutlineInternals
  const maskMaterial = outline.maskPass.overrideMaterial
  const originalMask = 'gl_FragColor.rg=vec2(0.0,depthTest);'
  const correctedMask = 'gl_FragColor.rg=vec2(1.0,depthTest);'
  if (maskMaterial.fragmentShader.includes(originalMask)) {
    maskMaterial.fragmentShader = maskMaterial.fragmentShader.replace(originalMask, correctedMask)
    maskMaterial.needsUpdate = true
  }

  const originalGate = 'edge*=(edgeStrength*mask.x*pulse);'
  const exteriorGate = 'edge*=(edgeStrength*(1.0-mask.x)*pulse);'
  const shader = outline.getFragmentShader()
  if (shader.includes(originalGate)) {
    outline.setFragmentShader(shader.replace(originalGate, exteriorGate))
    outline.setChanged()
  }
}

/* ------------------------------------------------------------------- scene */

function Scene({
  onFocus,
  entered,
  onEnter,
  onNavigate,
  onZoom,
  onBookOpenRequest,
  onBookClose,
  prewarmIndex,
}: {
  onFocus: (i: TentIndex) => void
  entered: number | null
  onEnter: (i: TentIndex) => void
  onNavigate: (to: string, from?: PageScreenRect) => void
  onZoom?: (src: string, from: PageScreenRect) => void
  onBookOpenRequest?: () => void
  /** Fired when an edge-page gesture closes the journal in place. */
  onBookClose?: () => void
  /** Interior state rendered only while the loading curtain is still opaque. */
  prewarmIndex: TentIndex | null
}) {
  const kit = useKit()
  const focusRef = useRef(1)
  const bookOpen = useRef(0)
  // Armed by clicking the closed journal — see the `openTarget` guard below.
  // Reset alongside `hovered` whenever `entered` changes, so walking into the
  // next tent asks to be opened again instead of inheriting the last click.
  const wantOpen = useRef(false)
  const rig = useRef<RigState>({
    entered,
    active: entered ?? 1,
    travel: entered === null ? 0 : 1,
    exitBookZoom: 0,
  })
  // Mirrors rig.active into React so the journal keeps rendering for the tent
  // the camera is still standing in after `entered` has gone null.
  const [active, setActive] = useState(entered ?? 1)
  // True from the moment a tent is entered until the walk out has finished, so
  // the interior lights do not snap off the instant Escape is pressed. One
  // state change per transition, not one a frame.
  const [roomLit, setRoomLit] = useState(entered !== null)
  const roomLitRef = useRef(entered !== null)
  /**
   * True only once the camera is right up at a journal.
   *
   * This is what turns the other two tents' lights off, and it deliberately
   * fires late. Gated on `roomLit` — which flips on the first frame of the
   * walk-in — six torches and two lanterns went out across the clearing while
   * the camera was still standing in it, which is the "torches change settings"
   * flicker. By the time this is true the frame is filled with one bench.
   */
  const [deep, setDeep] = useState(entered !== null)
  const deepRef = useRef(entered !== null)
  const renderedActive = prewarmIndex ?? active
  const renderedRoomLit = prewarmIndex !== null || roomLit
  const renderedDeep = prewarmIndex !== null || deep
  const [exteriorHoverReady, setExteriorHoverReady] = useState(entered === null)
  const exteriorHoverReadyRef = useRef(entered === null)
  const exteriorHoverResumeAt = useRef(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [bookHovered, setBookHovered] = useState<number | null>(null)
  const [bookCueReady, setBookCueReady] = useState(false)
  const bookCueReadyRef = useRef(false)
  const [bookCueDismissed, setBookCueDismissed] = useState(false)
  const hoverSource = useRef<{ tent: number | null; label: number | null }>({ tent: null, label: null })
  const pointerInsideCanvas = useRef(false)

  // Every tent visit gets the same affordance. The clock starts with the tent
  // click, reaches the journal once the camera has crossed the doorway, and is
  // reset rather than remembered when the reader returns to the fire.
  useEffect(() => {
    bookCueReadyRef.current = false
    setBookCueReady(false)
    setBookCueDismissed(false)
    setBookHovered(null)
    if (entered === null) return
    const id = window.setTimeout(() => {
      bookCueReadyRef.current = true
      setBookCueReady(true)
    }, BOOK_INTERACTION_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [entered])

  /**
   * The moon's shadow frustum, re-aimed at whichever tent is being read in.
   *
   * A 48-metre frustum at 1536 gives a shadow texel about three centimetres
   * across. Outdoors that is invisible; on a journal 60cm wide it is twenty
   * texels for the whole book, so the edge of the tent's shadow crossed the
   * open spread as a staircase with steps the height of a line of type. Pulling
   * the frustum in to six metres once the camera is inside gives a 4mm texel
   * over the only thing that is on screen, and the staircase goes away.
   */
  const keyLight = useRef<THREE.DirectionalLight>(null)
  const shadowDirty = useRef(false)
  const lastShadow = useRef(-1)
  const lastLightCheck = useRef(-1)
  const { gl } = useThree()

  // LIGHTING-REWORK (2026-08-17): refs for the ?debug panel — see
  // campsite/debugPanel.ts. Binds directly to the live objects rather than
  // to the NIGHT constants, since mutating a plain JS constant does not
  // itself trigger a React re-render.
  const rimLight = useRef<THREE.DirectionalLight>(null)
  const hemiLight = useRef<THREE.HemisphereLight>(null)
  const ambientLightRef = useRef<THREE.AmbientLight>(null)
  const fireKeyLight = useRef<THREE.PointLight>(null)
  const [tentOutlineTargets, setTentOutlineTargets] = useState<THREE.Object3D[][]>(() => [[], [], []])
  const registerOutlineTarget = useCallback((index: TentIndex, node: THREE.Object3D | null) => {
    const meshes: THREE.Object3D[] = []
    node?.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes.push(object)
    })
    setTentOutlineTargets((previous) => {
      const current = previous[index]
      if (current.length === meshes.length && current.every((object, i) => object === meshes[i])) {
        return previous
      }
      const next = previous.slice()
      next[index] = meshes
      return next
    })
  }, [])
  const [bookOutlineTargets, setBookOutlineTargets] = useState<THREE.Object3D[][]>(() => [[], [], []])
  const registerBookOutlineTarget = useCallback((index: number, node: THREE.Object3D | null) => {
    const targets = node ? [node] : []
    setBookOutlineTargets((previous) => {
      const current = previous[index]
      if (current.length === targets.length && current.every((object, i) => object === targets[i])) {
        return previous
      }
      const next = previous.slice()
      next[index] = targets
      return next
    })
  }, [])
  const flatTentOutlineTargets = useMemo(() => tentOutlineTargets.flat(), [tentOutlineTargets])
  const flatBookOutlineTargets = useMemo(() => bookOutlineTargets.flat(), [bookOutlineTargets])
  const hoverIntersections = useRef<THREE.Intersection[]>([])
  const readTentUnderPointer = useCallback(
    (state: RootState) => {
      state.raycaster.setFromCamera(state.pointer, state.camera)
      hoverIntersections.current.length = 0
      state.raycaster.intersectObjects(flatTentOutlineTargets, false, hoverIntersections.current)
      const hit = hoverIntersections.current[0]
      return hit ? tentOutlineTargets.findIndex((targets) => targets.includes(hit.object)) : -1
    },
    [flatTentOutlineTargets, tentOutlineTargets]
  )
  const adoptTentUnderPointer = useCallback((hitIndex: number) => {
    const next = hitIndex >= 0 ? (hitIndex as TentIndex) : null
    hoverSource.current.tent = next
    setHovered((previous) => {
      if (next !== null && previous !== next) sfxHover()
      return previous === next ? previous : next
    })
  }, [])
  const bloomRef = useRef(null)
  const outlineEffectRef = useRef<OutlineEffect | null>(null)
  const outlineStrength = useRef(0)
  const setOutlineEffect = useCallback((effect: OutlineEffect | null) => {
    outlineEffectRef.current = effect
    if (effect) {
      configureExteriorOutline(effect)
      effect.edgeStrength = outlineStrength.current
    }
  }, [])
  const contrastRef = useRef(null)
  const vignetteRef = useRef(null)
  const splitToneRef = useRef<SplitToneEffect | null>(null)
  useEffect(() => {
    if (!debugEnabled()) return
    let dispose: (() => void) | undefined
    mountDebugPanel({
      moon: keyLight.current,
      rim: rimLight.current,
      hemisphere: hemiLight.current,
      ambient: ambientLightRef.current,
      fireKey: fireKeyLight.current,
      bloom: bloomRef.current,
      contrast: contrastRef.current,
      splitTone: splitToneRef.current,
      vignette: vignetteRef.current,
      constants: { NIGHT, FIRELIGHT },
    }).then((fn) => {
      dispose = fn
    })
    return () => dispose?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const markShadowDirty = useCallback(() => {
    shadowDirty.current = true
  }, [])

  // Shadow maps update on demand, not per frame. The initial map and every
  // frustum/prewarm state still render immediately; moving tent casters are
  // coalesced below and capped at SHADOW_HZ.
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    return () => {
      gl.shadowMap.autoUpdate = true
    }
  }, [gl])

  useEffect(() => {
    const l = keyLight.current
    if (!l) return
    aimMoonShadow(l, renderedRoomLit ? renderedActive : null)
    gl.shadowMap.needsUpdate = true
  }, [renderedRoomLit, renderedActive, gl])

  /**
   * Tells the grass shader where the camp's flames actually are.
   *
   * One entry for the fire and one for each of the six torches, so a blade
   * works out its own warmth from its own world position. Static — the camp
   * does not move — so this runs once.
   */
  useEffect(() => {
    setWarmLights([
      {
        x: FIRE_POS[0],
        z: FIRE_POS[2],
        radius: NIGHT.grassWarm.fireRadius,
        power: NIGHT.grassWarm.firePower,
      },
      ...[0, 1, 2].flatMap((i) =>
        tentTorches(i).map((p) => ({
          ...p,
          radius: NIGHT.grassWarm.torchRadius,
          power: NIGHT.grassWarm.torchPower,
        }))
      ),
    ])
  }, [])

  const firewood = kit.parts('Firewood')
  const fireRocks = kit.parts('FireRocks')

  useEffect(() => {
    // Preserve the close reading lens only when a book was actually opened.
    // Leaving a closed journal must begin from the wide bench view instead of
    // zooming toward the cover for the first frames of the walk out.
    if (entered === null && rig.current.entered !== null) {
      rig.current.exitBookZoom = wantOpen.current || bookOpen.current > 0.03 ? 1 : 0
      const exitAt = performance.now()
      exteriorHoverResumeAt.current = exitAt + EXIT_HOVER_GUARD_MS
      if (import.meta.env.DEV) {
        const w = window as unknown as {
          __campHoverExitAt?: number
          __campHoverResumeAt?: number
        }
        w.__campHoverExitAt = exitAt
        w.__campHoverResumeAt = exteriorHoverResumeAt.current
      }
      exteriorHoverReadyRef.current = false
      setExteriorHoverReady(false)
    } else if (entered !== null) {
      rig.current.exitBookZoom = 0
      exteriorHoverResumeAt.current = Number.POSITIVE_INFINITY
      exteriorHoverReadyRef.current = false
      setExteriorHoverReady(false)
    }
    rig.current.entered = entered
    // Only adopt a new active tent on the way in; on the way out the camera has
    // to finish leaving the one it is standing in.
    if (entered !== null) {
      rig.current.active = entered
      setActive(entered)
    }
    // The pointer doesn't move when the camera does. Without this, whichever
    // tent was hovered right before the click stays "hovered" — under the
    // camera the whole time it's inside, and still on the way out, so the exit
    // replays that tent's highlight and scale-up even though the cursor never
    // touched it.
    hoverSource.current.tent = null
    hoverSource.current.label = null
    setHovered(null)
    setBookHovered(null)
    wantOpen.current = false
  }, [entered])

  const handleHover = (i: TentIndex | null, source: 'tent' | 'label') => {
    // Meshes remain under the pointer as the camera travels. Ignore their
    // synthetic over events until the same guard that controls scale/outline
    // has elapsed, or a stale hover can re-arm without any pointer movement.
    if (i !== null && (rig.current.entered !== null || !exteriorHoverReadyRef.current)) return
    hoverSource.current[source] = i
    const next = hoverSource.current.tent ?? hoverSource.current.label ?? null
    setHovered((prev) => {
      if (next !== null && next !== prev) sfxHover()
      return next
    })
  }

  const handleBookHover = useCallback((index: number, hot: boolean) => {
    if (
      hot &&
      (!bookCueReadyRef.current || rig.current.entered !== index || bookOpen.current >= 0.05)
    ) {
      return
    }
    setBookHovered((current) => {
      const next = hot ? index : current === index ? null : current
      if (hot && next !== current) sfxUiHover()
      return next
    })
  }, [])

  const clearAllHover = useCallback(() => {
    hoverSource.current.tent = null
    hoverSource.current.label = null
    setHovered(null)
    setBookHovered(null)
    document.body.classList.remove('camp-hover')
  }, [])

  // Pointer-out is not guaranteed when the tab loses focus or the cursor exits
  // the canvas during a scale animation. A single boundary reset owns both
  // interaction types, so neither a tent nor a book can stay enlarged/outlined.
  useEffect(() => {
    const canvas = gl.domElement
    const markPointerInside = () => {
      pointerInsideCanvas.current = true
    }
    const markPointerOutside = () => {
      pointerInsideCanvas.current = false
      clearAllHover()
    }
    canvas.addEventListener('pointerenter', markPointerInside)
    canvas.addEventListener('pointerleave', markPointerOutside)
    window.addEventListener('blur', clearAllHover)
    return () => {
      canvas.removeEventListener('pointerenter', markPointerInside)
      canvas.removeEventListener('pointerleave', markPointerOutside)
      window.removeEventListener('blur', clearAllHover)
    }
  }, [clearAllHover, gl])

  useEffect(() => {
    document.body.classList.toggle(
      'camp-hover',
      hovered !== null && entered === null && exteriorHoverReady
    )
    return () => document.body.classList.remove('camp-hover')
  }, [hovered, entered, exteriorHoverReady])

  useFrame((state, delta) => {
    const st = rig.current
    const goingIn = st.entered !== null

    // During the moving exit, test only the registered tent meshes. The former
    // `events.update()` raycast traversed every interactive mesh in the scene on
    // every animation frame (including all three journals) even though only a
    // tent can become interactive here. The narrow ray keeps the exact
    // stationary-pointer hover behaviour without that transition-only CPU tax.
    if (
      !goingIn &&
      exteriorHoverReadyRef.current &&
      pointerInsideCanvas.current &&
      st.travel > 0.004
    ) {
      adoptTentUnderPointer(readTentUnderPointer(state))
    }

    const hoverReady =
      exteriorHoverReadyRef.current ||
      (!goingIn && performance.now() >= exteriorHoverResumeAt.current)
    if (import.meta.env.DEV) {
      ;(window as unknown as { __campHoverReady?: boolean }).__campHoverReady = hoverReady
    }
    if (hoverReady !== exteriorHoverReadyRef.current) {
      exteriorHoverReadyRef.current = hoverReady
      setExteriorHoverReady(hoverReady)
      if (hoverReady && pointerInsideCanvas.current) {
        // No mouse move is required after an exit. Adopt the exact registered
        // tent hit directly instead of asking R3F to raycast the entire scene.
        adoptTentUnderPointer(readTentUnderPointer(state))
      }
    }

    // Arriving and opening are two moves, but exiting starts immediately. The
    // journal closes during the pull out instead of holding the camera over a
    // widening bench shot before the doorway transition can begin.
    const travelTarget = goingIn ? 1 : 0
    st.travel += (travelTarget - st.travel) * damp(TENT_TRAVEL_DAMPING, delta)
    // ?travel=0.55 pins the walk-in part-way through. The headless screenshot
    // pass runs at a few frames a second, so a damped animation cannot be
    // caught by waiting on a stopwatch.
    if (FROZEN_TRAVEL !== null) st.travel = FROZEN_TRAVEL

    // Opens on arrival *and* a click — not arrival alone. The camera used to
    // fling the cover back the moment it settled, which handed the reader an
    // already-open book instead of a closed one sitting on a bench waiting to
    // be picked up. `wantOpen` is armed by clicking the cover itself; see
    // Book's onOpenRequest.
    const openTarget =
      goingIn && st.travel > BOOK_OPEN_TRAVEL_THRESHOLD && wantOpen.current ? 1 : 0
    bookOpen.current +=
      (openTarget - bookOpen.current) * damp(openTarget ? 1.83 : 2.57, delta)
    if (FROZEN_BOOK !== null) bookOpen.current = FROZEN_BOOK

    // Interior lights follow the camera, not the click.
    const wantLit = goingIn || st.travel > 0.05
    if (wantLit !== roomLitRef.current) {
      roomLitRef.current = wantLit
      setRoomLit(wantLit)
    }
    // Hysteresis, so a camera hovering on the threshold cannot strobe the
    // clearing's whole light budget on and off.
    const wantDeep = deepRef.current ? st.travel > 0.9 : st.travel > 0.985
    if (wantDeep !== deepRef.current) {
      deepRef.current = wantDeep
      setDeep(wantDeep)
    }

    const t = state.clock.elapsedTime
    const flicker = fireFlicker(t)
    tickWind(t, flicker)
    tickAudio(t, flicker)

    // Only moving shadow casters enqueue this work. Once focus rise and hover
    // scale settle, the map stays cached instead of refreshing forever at 6 Hz.
    if (shadowDirty.current && t - lastShadow.current > 1 / SHADOW_HZ) {
      shadowDirty.current = false
      lastShadow.current = t
      gl.shadowMap.needsUpdate = true
    }

    /*
      The light-count invariant, checked once a second in dev.

      MOUNTED_POINT_LIGHTS explains why this matters; the reason it is asserted
      rather than trusted is that breaking it is completely invisible. Nothing
      renders wrong, nothing logs, no test fails — the scene simply stalls for
      a second the next time a state change adds or removes a source, and only
      a profile says why. A one-line count is a cheap tripwire for a fault that
      is otherwise found by accident.
    */
    if (import.meta.env.DEV && t - lastLightCheck.current > 1) {
      lastLightCheck.current = t
      let n = 0
      state.scene.traverse((o) => {
        if ((o as THREE.PointLight).isPointLight) n++
      })
      if (n !== MOUNTED_POINT_LIGHTS) {
        console.warn(
          `[camp] point-light count is ${n}, expected ${MOUNTED_POINT_LIGHTS}. ` +
            'Every material in the scene recompiles when this changes — see ' +
            'MOUNTED_POINT_LIGHTS in CampHero.tsx.'
        )
      }
    }
  })

  // Tent outline and scale resume from this same one-second gate. A single
  // source of truth prevents the former scale-first / outline-later response.
  const tentOutlineActiveIndex =
    FROZEN_HOT === null
      ? entered === null && exteriorHoverReady
        ? hovered
        : null
      : FROZEN_HOT
  // Each visit gets the closed-journal cue after the shared 1.3-second
  // interaction delay. Hover and scale share `bookHovered`, while the idle cue
  // continues to breathe until the journal is opened.
  const bookOutlineActiveIndex =
    prewarmIndex !== null
      ? prewarmIndex
      : FROZEN_HOT === null && entered !== null && bookCueReady && !bookCueDismissed
        ? entered
        : null
  const desiredOutline: ActiveOutline | null =
    bookOutlineActiveIndex !== null
      ? { kind: 'book', index: bookOutlineActiveIndex as TentIndex }
      : tentOutlineActiveIndex !== null
        ? { kind: 'tent', index: tentOutlineActiveIndex as TentIndex }
        : null
  const [renderedOutline, setRenderedOutline] = useState<ActiveOutline | null>(null)
  const renderedOutlineRef = useRef<ActiveOutline | null>(null)
  const wasOutlinePrewarming = useRef(false)

  useEffect(() => {
    if (prewarmIndex !== null) {
      wasOutlinePrewarming.current = true
      return
    }
    if (!wasOutlinePrewarming.current) return
    wasOutlinePrewarming.current = false
    // The exact book-outline state has now been rendered behind the curtain.
    // Clear it immediately rather than spending visible lobby frames fading a
    // hidden QA state out after the loader is gone.
    outlineStrength.current = 0
    if (outlineEffectRef.current) outlineEffectRef.current.edgeStrength = 0
    renderedOutlineRef.current = null
    setRenderedOutline(null)
  }, [prewarmIndex])

  // Latch the last target while fading out. Removing the selection immediately
  // makes the post effect disappear in one frame, so the selection is released
  // only after its strength has eased down to zero.
  useEffect(() => {
    if (!desiredOutline) return
    const current = renderedOutlineRef.current
    if (current?.kind === desiredOutline.kind && current.index === desiredOutline.index) return
    renderedOutlineRef.current = desiredOutline
    setRenderedOutline(desiredOutline)
  }, [desiredOutline?.index, desiredOutline?.kind])

  const outlineIsBook = renderedOutline?.kind === 'book'
  const outlineIndex = renderedOutline?.index ?? 1
  // A journal inherits its tent's accent so the affordance remains visually
  // consistent as the camera moves from the exterior to the interior.
  const outlineColor = Number.parseInt(TENT_GLOW[outlineIndex].slice(1), 16)
  useEffect(() => {
    const effect = outlineEffectRef.current
    if (!effect) return
    // These are uniforms. Passing a changing color prop through the wrapper
    // reconstructs the complete OutlineEffect, disposing and relinking three
    // programs during the first hover in a differently coloured tent.
    effect.visibleEdgeColor.setHex(outlineColor)
    effect.hiddenEdgeColor.setHex(outlineColor)
  }, [outlineColor])
  const visibleOutlineSelection =
    renderedOutline === null
      ? []
      : outlineIsBook
        ? bookOutlineTargets[outlineIndex]
        : tentOutlineTargets[outlineIndex]
  const outlineSelection = visibleOutlineSelection

  // Pulse timing belongs to the book cue, never to hover. Changing hover state
  // therefore neither restarts nor alters the waveform.
  useEffect(() => {
    if (outlineEffectRef.current) outlineEffectRef.current.pulseSpeed = outlineIsBook ? 0.35 : 0
  }, [outlineIsBook])

  useFrame((_, delta) => {
    const wanted = desiredOutline !== null
    const target = wanted ? 11 : 0
    const next = THREE.MathUtils.lerp(
      outlineStrength.current,
      target,
      damp(wanted ? 7 : 6, delta)
    )
    outlineStrength.current = next < 0.025 ? 0 : next
    if (outlineEffectRef.current) outlineEffectRef.current.edgeStrength = outlineStrength.current
    if (import.meta.env.DEV) {
      ;(window as unknown as {
        __campOutline?: {
          desired: ActiveOutline | null
          rendered: ActiveOutline | null
          strength: number
          pulseSpeed: number
        }
      }).__campOutline = {
        desired: desiredOutline,
        rendered: renderedOutlineRef.current,
        strength: outlineStrength.current,
        pulseSpeed: outlineEffectRef.current?.pulseSpeed ?? 0,
      }
    }

    if (!wanted && outlineStrength.current === 0 && renderedOutlineRef.current !== null) {
      renderedOutlineRef.current = null
      setRenderedOutline(null)
    }
  })

  // The post-processing selection uses layer 10. Clear it explicitly from
  // every target that is no longer selected; rapid over/out sequences used to
  // leave a previous target on that layer, producing a thicker ghost outline.
  useEffect(() => {
    const selected = new Set(outlineSelection)
    for (const target of [...flatTentOutlineTargets, ...flatBookOutlineTargets]) {
      if (!selected.has(target)) target.layers.disable(10)
    }
  }, [flatBookOutlineTargets, flatTentOutlineTargets, outlineSelection])

  return (
    <>
      {/* Height fog, not distance fog — see campsite/fog.ts, which swaps the
          fog chunks so this exp2 term is modulated by the fragment's altitude,
          broken into banks, and gated off entirely inside 26 metres. The camp
          itself is never fogged; the treeline sinks into it. */}
      <fogExp2 attach="fog" args={[NIGHT.fog.color, NIGHT.fog.density]} />
      <NightSky />
      <Stars />

      {/* Moonlight from the direction the moon is actually painted in, a cool
          rim from behind, and a small warm bounce off the fire's side of the
          clearing. Cooler and dimmer all round than it was: the camp was lit
          like an evening rather than a night, and the aurora cannot read as
          the brightest thing in frame if the ground is competing with it. */}
      <directionalLight
        name={MOON_KEY_NAME}
        ref={keyLight}
        position={[MOON_LIGHT.x * 42, MOON_LIGHT.y * 42, MOON_LIGHT.z * 42]}
        intensity={NIGHT.moon.intensity}
        color={NIGHT.moon.color}
        castShadow={PROFILE_SHADOWS}
        // Tighter frustum at a smaller resolution than it used to have: the
        // same texels per metre across the part of the scene that is ever on
        // camera, for 45% of the shadow pass. The frustum is then re-aimed at
        // whichever tent the camera walks into — see the effect below.
        //
        // The map itself is re-rendered at most a few times a second while a
        // tent's focus rise or hover scale is actually moving — see SHADOW_HZ.
        // Once those transforms settle, everything that casts a shadow is
        // static and the cached map needs no periodic refresh.
        shadow-mapSize={[1536, 1536]}
        shadow-bias={-0.0009}
        shadow-normalBias={0.022}
        shadow-radius={9}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={22}
        shadow-camera-bottom={-14}
        shadow-camera-far={80}
      />
      {/*
        Rim, from behind and above.

        This is the light that does the work in the reference frame: it never
        reaches a surface facing the camera, so it costs nothing in the middle
        of a tent wall and everything along its top edge, and it is what
        separates a tent from the tree behind it and a tree from the sky. Aimed
        from over the camp's left shoulder — the same quarter as the moon, but
        further back, so a rim and a key never light the same face.
      */}
      {/* LIGHTING-REWORK (2026-08-17): x -16 -> 10, baked from the ?debug
          panel's Rim x/y/z sliders at the user's request. */}
      <directionalLight
        ref={rimLight}
        position={[10, 20, -34]}
        intensity={NIGHT.rim.intensity}
        color={NIGHT.rim.color}
      />
      {/*
        No magenta directional and no warm directional any more.

        Both were the same mistake in opposite colours: a directional has no
        falloff, so a light added to warm the three tent fronts also warmed
        fifty trees twenty metres behind them, and a light added to catch the
        aurora on the right-hand canopies tinted the entire wood. Between them
        they are where the muddy red-violet cast over the forest came from, and
        no amount of tinting the tree instances could undo a light that was
        being added after the tint.

        Nothing replaces them. The three faces the reader is actually looking at
        are lit by the fire's pool (see FIRELIGHT.pool), which falls off with
        distance the way a fire does, and the wood behind them is lit by the sky
        and the moon and is *meant* to be a dark navy silhouette.
      */}
      <hemisphereLight
        ref={hemiLight}
        args={[NIGHT.hemisphere.sky, NIGHT.hemisphere.ground, NIGHT.hemisphere.intensity]}
      />
      <ambientLight ref={ambientLightRef} intensity={NIGHT.ambient.intensity} color={NIGHT.ambient.color} />

      <Ground />
      <Haze center={[CAMP_X, 0]} />
      <Scatter />

      <group position={FIRE_POS}>
        <group scale={1.05}>
          {fireRocks.map((p, i) => (
            <mesh key={`r${i}`} geometry={p.geometry} material={p.material} receiveShadow />
          ))}
          {firewood.map((p, i) => (
            <mesh key={`w${i}`} geometry={p.geometry} material={p.material} castShadow />
          ))}
        </group>
      </group>
      <Campfire position={FIRE_POS} lightRef={fireKeyLight} />

      {[0, 1, 2].map((i) => (
        <Tent
          key={i}
          index={i}
          focus={focusRef}
          entered={entered}
          active={renderedActive === i}
          roomLit={renderedRoomLit}
          hovered={hovered}
          bookOpen={bookOpen}
          deep={renderedDeep}
          exteriorHoverReady={exteriorHoverReady}
          rig={rig}
          onEnter={onEnter}
          onHover={handleHover}
          onNavigate={onNavigate}
          onZoom={onZoom}
          onBookOpenRequest={() => {
            // Opening eligibility, hover allowance, and the idle glow all use
            // the same readiness flag set by BOOK_INTERACTION_DELAY_MS.
            if (!bookCueReadyRef.current) return
            setBookCueDismissed(true)
            setBookHovered(null)
            wantOpen.current = true
            onBookOpenRequest?.()
          }}
          bookHovered={bookHovered === i}
          onBookHover={handleBookHover}
          registerBookOutlineTarget={registerBookOutlineTarget}
          onClose={() => {
            // Edge-page gestures put the journal down without leaving the
            // tent. Escape and the door button remain the only scene exits.
            wantOpen.current = false
            setBookHovered(null)
            setBookCueDismissed(false)
            onBookClose?.()
          }}
          registerOutlineTarget={registerOutlineTarget}
          onShadowTransformChange={markShadowDirty}
        />
      ))}

      {[0, 1, 2].map((i) => {
        const p = tentDoorSpill(i)
        return (
          <DoorwaySpill
            key={`spill${i}`}
            position={[p.x, 0.025, p.z]}
            color={TENT_INTERIOR_COLOR}
            rotation={TENTS[i].yaw}
            opacity={0.26}
          />
        )
      })}

      {[0, 1, 2].map((i) => (
        <TentSign
          key={i}
          index={i}
          hovered={hovered}
          entered={entered}
          onHover={handleHover}
          onEnter={onEnter}
        />
      ))}

      {PROFILE_FIREFLIES ? (
        <Fireflies
          center={[CAMP_X, -6]}
          count={110}
          exclusions={FIREFLY_TENT_EXCLUSIONS}
        />
      ) : null}
      {PROFILE_LEAVES ? <Leaves count={55} /> : null}

      <CameraRig state={rig} bookOpen={bookOpen} focusRef={focusRef} onFocus={onFocus} />

      {/*
        No multisampling.

        MSAA was the right call on paper — nearly all the aliasing here is on
        alpha-cutout foliage and tent silhouettes, and the driver resolves that
        more cheaply than a full-screen pass can. What it costs, though, is four
        samples of a *half-float* render target: at 1080p that is a 66MB
        allocation, and every opaque draw in the scene pays the bandwidth to
        write into it. Measured, it was 13ms of a 95ms frame — more than the
        entire forest. The scene is soft enough at these light levels that the
        edges it was cleaning up are not what the eye is on.
      */}
      {frozen('post') === 0 ? null : (
      <EffectComposer enableNormalPass={false} multisampling={frozen('msaa') ?? 0}>
        <Outline
          ref={setOutlineEffect}
          selection={outlineSelection}
          visibleEdgeColor={Number.parseInt(TENT_GLOW[1].slice(1), 16)}
          hiddenEdgeColor={Number.parseInt(TENT_GLOW[1].slice(1), 16)}
          edgeStrength={0}
          blur
          kernelSize={KernelSize.LARGE}
          resolutionScale={1}
          pulseSpeed={0}
          xRay={false}
        />
        {/*
          One bloom pass, not two.

          The tight pass picks out the genuinely hot things — flame cores,
          candle wicks, the neon rim on a hovered tent — and the wide one used
          to lift the aurora and the orbs into the air around them. Each of them
          is a full mipmap chain: eight downsamples and eight upsamples over the
          whole frame, and running two of those to separate a tight halo from a
          wide one is a lot of bandwidth for a distinction that survives being
          made once with a middling radius.
        */}
        {/* Threshold up, radius down. The only things in the frame that should
            reach this pass are the flame cores, the wicks, the moon's sunward
            rims, the brightest stars and the neon markers — a threshold low
            enough to catch a lit tent canopy is a threshold that veils the
            whole treeline, which is what was softening every silhouette. */}
        {/*
          Intensity up, threshold just under the ceiling.

          The scene buffer clamps at 1, so *nothing* in this frame is brighter
          than 1 by the time this pass sees it — the moon's disc, the flame
          cores, the wicks and the neon markers all arrive at exactly the top
          and the grass and the canopy arrive well below it. That makes 0.9 a
          clean separator, and it means the only way anything can read as
          brighter than a lit tent is the glow this pass throws off it. Which is
          how a full moon works anyway: the disc is not what makes it bright,
          the halo around it is.
        */}
        {/* LIGHTING-REWORK (2026-08-17): threshold 0.80->0.87, smoothing
            0.16->0.11. imagestats' 5th-percentile check (item b) showed the
            global black floor sitting above the new target reference; a wide
            mipmap bloom bleeds a little brightness into every dark pixel in
            the frame even at a fairly high threshold, and tightening both
            knobs cuts fewer things out (the fire core, wicks, moon are all
            still >0.9) while narrowing how far the glow reaches into the
            near-black regions. See LIGHTING_TUNING.md. */}
        <Bloom
          ref={bloomRef}
          intensity={1.12}
          luminanceThreshold={0.9}
          luminanceSmoothing={0.08}
          mipmapBlur
          radius={0.54}
          levels={BLOOM_LEVELS}
        />
        {/* The outline selects the imported tent mask, whose coverage boundary
            is the outer mesh plus its doorway opening. Surface seams are not
            mask boundaries, so they remain clean. The outside-mask correction
            keeps the luminous band off the canvas itself. */}
        {/* No chromatic aberration and no film grain any more.
            Both were doing the same damage: the dispersion softened every
            high-contrast silhouette — which in this scene is every tree
            against the sky — and the grain sat as speckle all over the dark
            half of the frame. Together they read as a low-quality render
            rather than as an effect, and they were the reason the treeline
            looked blurry and muddy however the lighting was set. */}
        {/*
          Tone mapping, and **it has to live here rather than on the renderer.**

          `state.gl.toneMapping = ACESFilmicToneMapping` in `onCreated` below
          looks like it sets this and does not: `<EffectComposer>` writes
          `gl.toneMapping = NoToneMapping` when it mounts, because the composer
          owns the render loop and a scene that is tone mapped on the way into a
          linear working buffer would be tone mapped twice. With no operator in
          the chain either, the scene had *no* tone mapping — the half-float
          buffer went straight to an sRGB encode, which clamps.

          Per channel. That is the whole story behind two of the things this
          frame was worst at. Firelit grass ran red past 1 while green and blue
          were still climbing, so the clamp threw away the difference and the
          field rendered as a flat, screaming, single-value red; and the moon,
          written a little over 1 in all three, came back a neutral grey disc
          with every crater on it clipped flat. Neither is a lighting fault and
          no amount of grading fixes either — there is a shoulder missing.

          `onCreated`'s assignment is still worth keeping: `?post=0` pulls the
          composer out to look at the raw scene, and there the renderer's own
          operator is the only one there is.
        */}
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        {/* Grade, in three moves.

            Saturation and contrast first, on the whole frame. Then the split
            tone — cold in the shadows, warm in the highlights — which is the
            one thing the stock passes cannot do, because they cannot tell the
            fire from the dark behind it (see campsite/grade.ts). Then the
            corners come down so the fire holds the eye.

            The blacks are not lifted and the contrast is up: a night scene
            needs somewhere genuinely dark for the aurora and the fire to be
            bright *against*. */}
        <HueSaturation hue={0} saturation={0.16} />
        {/* Blacks down, not up. The scene lighting does the work — see NIGHT —
            and this only finishes it: a night frame wants its shadow end sat on
            the floor so the fire and the curtains have somewhere to be bright
            against. */}
        {/* Contrast down from 0.115. This pass pivots on 0.5, and in a frame
            where nearly everything sits well below that, every extra point of
            contrast is a subtraction — at 0.115 it was driving the green
            channel of firelit grass through zero and clipping it, which is what
            turned an orange field into a flat crimson one. */}
        {/* LIGHTING-REWORK (2026-08-17): contrast 0.085 -> 0.105 alongside
            the bloom tighten above, same reasoning (item b). See
            [[portfolio-post-chain-tonemapping]] before pushing this further —
            past ~0.115 it drove firelit grass's green channel through zero. */}
        <BrightnessContrast ref={contrastRef} brightness={0.008} contrast={0.03} />
        <SplitTone effectRef={splitToneRef} />
        {/* Light. The corners of the reference are dark because its *sky* is
            dark there, not because a lens is closing them down — and at 0.32 /
            0.40 this pass was taking two thirds of the value off the moon,
            which sits four tenths of the way to a corner. The scene lighting
            owns the falloff now; this only stops the frame's edges competing
            with the fire. */}
        <Vignette ref={vignetteRef} offset={0.64} darkness={0.06} />
      </EffectComposer>
      )}
    </>
  )
}

/**
 * Reports how far through the download the kit and its textures are.
 *
 * Lives outside the Canvas on purpose: everything inside it is behind a
 * `<Suspense>` that does not resolve until the loading is *finished*, which is
 * the one moment a loading bar is no longer interesting. drei's `useProgress`
 * is a store fed by three's `DefaultLoadingManager`, so it works from anywhere
 * in the tree.
 */
function LoadTracker({ onProgress }: { onProgress?: (p: number) => void }) {
  /*
    Polled off the store rather than subscribed to it.

    The previous version called `useProgress()`, which subscribes this component
    to drei's store — and that store is written from inside three's
    `DefaultLoadingManager.onProgress`, which fires once per finished item. So a
    burst of textures finishing in one tick ran: manager fires, store writes,
    this component re-renders, the page above it sets state, the tree re-renders,
    repeat. React's update-depth guard tripped on roughly one load in three, and
    when it tripped it took the whole page down.

    Reading the same value on an animation frame instead means nothing in the
    render tree is subscribed to the loading manager at all. The bar moves at
    frame rate, which is as often as it can be seen to move anyway, and the poll
    stops itself once the load is done.
  */
  const cb = useRef(onProgress)
  cb.current = onProgress

  useEffect(() => {
    let raf = 0
    let last = -1

    const tick = () => {
      const p = useProgress.getState().progress
      if (p !== last) {
        last = p
        cb.current?.(p / 100)
      }
      // Done is done. Left running this would poll for the life of the page to
      // report a number that cannot change again.
      if (p >= 100) return
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return null
}

interface PausedClock {
  elapsedTime: number
  oldTime: number
  startTime: number
  stoppedAt: number
}

/**
 * Stops the R3F loop when the fully prepared camp cannot be seen.
 *
 * This deliberately lives inside the Canvas instead of changing its
 * `frameloop` prop with page visibility. R3F's `setFrameloop` stops/starts the
 * THREE.Clock and resets elapsedTime; without repairing that state, returning
 * to the camp restarts every clock-driven effect and can feed a large delta to
 * an in-progress camera move. The old timestamp is rebased by the exact pause
 * duration so the first resumed delta is the remainder of the previous frame,
 * not all of the time spent offscreen.
 */
function ActivityFrameloop({ active }: { active: boolean }) {
  const { clock, frameloop, invalidate, setFrameloop } = useThree()
  const pausedClock = useRef<PausedClock | null>(null)

  useLayoutEffect(() => {
    const now = performance.now()

    if (!active) {
      // `never` is also the Canvas' intentional startup mode. Do not turn that
      // fresh clock into a pause snapshot before Warmup begins rendering.
      if (frameloop === 'never' && pausedClock.current === null) return

      const snapshot =
        pausedClock.current ?? {
          elapsedTime: clock.elapsedTime,
          oldTime: clock.oldTime,
          startTime: clock.startTime,
          stoppedAt: now,
        }

      if (frameloop !== 'never') setFrameloop('never')
      // setFrameloop resets these fields. Put the last rendered instant back so
      // repeated parent renders while hidden cannot erode the saved timeline.
      clock.elapsedTime = snapshot.elapsedTime
      clock.oldTime = snapshot.oldTime
      clock.startTime = snapshot.startTime
      pausedClock.current = snapshot
      return
    }

    const snapshot = pausedClock.current
    if (frameloop !== 'always') setFrameloop('always')
    if (snapshot) {
      const pausedFor = now - snapshot.stoppedAt
      clock.elapsedTime = snapshot.elapsedTime
      clock.oldTime = snapshot.oldTime + pausedFor
      clock.startTime = snapshot.startTime + pausedFor
      pausedClock.current = null
    }
    // setFrameloop changes the mode but does not itself guarantee that the
    // shared R3F loop is scheduled after it had gone idle.
    invalidate()
  }, [active, clock, frameloop, invalidate, setFrameloop])

  return null
}

/**
 * Compiles every shader and uploads every texture before the first frame.
 *
 * **Shaders.** Three.js builds a program the first time it draws with a
 * material, and this scene has around sixty of them: the tents, four kinds of
 * foliage, the sky march, the fire, the smoke, the tent interiors, the journal,
 * the whole post chain. Left to happen lazily that is sixty driver compiles
 * landing in whichever frame first needs them — the first seconds of the camp,
 * and then again in the frame a tent is clicked. A compile is a hard stall on
 * the main thread, so they land as visible freezes. `compile` walks the scene
 * with `traverse`, not `traverseVisible`, which is what lets the interiors and
 * the journal sit hidden in the scene from the start and still be built here.
 *
 * **Textures.** Compiling is only half of it, and the half that is easy to
 * miss: a texture is uploaded to the GPU the first time something *draws* with
 * it, which for a hidden object is never. The journal alone owns seven
 * 796x1180 canvases, and handing twenty megabytes to the driver in the frame
 * where a tent opens is its own stall on top of the shader one. `initTexture`
 * forces the upload now, while there is a curtain over it.
 *
 * `compileAsync` yields between programs where the browser supports it, so the
 * loading bar keeps moving instead of freezing solid for the duration.
 */
function Warmup({
  onReady,
  onPrepared,
  onPrewarm,
}: {
  onReady?: () => void
  onPrepared: () => void
  onPrewarm: (index: TentIndex | null) => void
}) {
  const { gl, scene, camera } = useThree()
  const [tentClothTexture, tentLeatherTexture] = useTexture([
    TENT_CLOTH,
    TENT_LEATHER_GRAIN,
  ])

  useEffect(() => {
    let cancelled = false

    const nextFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const waitForSubmittedGpuWork = async () => {
      const context = gl.getContext()
      if (
        typeof WebGL2RenderingContext === 'undefined' ||
        !(context instanceof WebGL2RenderingContext)
      ) {
        return
      }

      // The final prewarm renders can still be queued in the driver after the
      // JavaScript frame has returned. Starting the loader fade at that point
      // exposes the campsite while the GPU catches up, which looks like a
      // frozen translucent "Ready" frame. A fence lets that work finish behind
      // the fully opaque, compositor-animated curtain without blocking the
      // browser thread (unlike gl.finish()).
      const fence = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0)
      if (!fence) return
      context.flush()
      const deadline = performance.now() + 2500
      try {
        while (!cancelled && performance.now() < deadline) {
          const status = context.clientWaitSync(fence, 0, 0)
          if (
            status === context.ALREADY_SIGNALED ||
            status === context.CONDITION_SATISFIED ||
            status === context.WAIT_FAILED
          ) {
            break
          }
          await nextFrame()
        }
      } finally {
        context.deleteSync(fence)
      }
    }

    const uploadTextures = async () => {
      const seen = new Set<THREE.Texture>()
      // These custom onBeforeCompile uniforms are not discoverable through a
      // material's standard map slots. Stage them explicitly so their first
      // GPU upload cannot cluster in the hidden interior-prewarm frame.
      seen.add(tentClothTexture)
      seen.add(tentLeatherTexture)
      const MAPS = [
        'map',
        'normalMap',
        'roughnessMap',
        'metalnessMap',
        'emissiveMap',
        'alphaMap',
        'aoMap',
        'bumpMap',
      ] as const
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.material) return
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const mat = m as unknown as Record<string, THREE.Texture | null | undefined>
          for (const key of MAPS) {
            const tex = mat[key]
            if (tex && tex.isTexture && !seen.has(tex)) {
              seen.add(tex)
            }
          }
        }
      })

      // A texture upload is synchronous at the WebGL boundary. Uploading the
      // entire scene in one loop froze the loader even though the surrounding
      // asset promises were asynchronous. One upload per animation frame
      // keeps the title, embers and progress rail responsive throughout.
      for (const texture of seen) {
        if (cancelled) break
        gl.initTexture(texture)
        await nextFrame()
      }
      return seen.size
    }

    const compiler = gl as unknown as {
      compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown>
    }
    const compileWithoutBlocking = async () => {
      // `compileAsync` uses KHR_parallel_shader_compile and polls readiness
      // between frames. Deliberately skip the synchronous `compile` fallback:
      // on a browser without the extension, a longer loader is preferable to
      // a loader whose animation freezes and looks crashed.
      if (typeof compiler.compileAsync === 'function') {
        const hidden: THREE.Object3D[] = []
        scene.traverse((object) => {
          if (!object.visible) {
            hidden.push(object)
            object.visible = true
          }
        })
        try {
          // R3F/three's compiler respects ancestor visibility. All three tent
          // interiors and journals normally begin hidden, which left most of
          // their programs for the first real render despite compileAsync.
          // The render loop is stopped here, so this visibility change is
          // compiler-only and can never appear on screen.
          await compiler.compileAsync(scene, camera)
        } finally {
          for (const object of hidden) object.visible = false
        }
      }
    }

    const prepareProgramInterfaces = async () => {
      const programs = [...(gl.info.programs ?? [])] as unknown as Array<{
        cacheKey?: string
        getUniforms?: () => unknown
        isReady?: () => boolean
      }>
      const timings: Array<{ index: number; ms: number; key: string }> = []
      for (let index = 0; index < programs.length; index += 1) {
        const program = programs[index]
        if (cancelled) return
        // Some programs (notably postprocessing/depth passes) are already in
        // renderer.info but aren't part of compileAsync's returned material
        // set. Poll their KHR completion flag ourselves before touching the
        // interface; querying ACTIVE_UNIFORMS early implicitly waits for link.
        while (!cancelled && program.isReady && !program.isReady()) {
          await nextFrame()
        }
        if (cancelled) return
        // Three defers ACTIVE_UNIFORMS / ACTIVE_ATTRIBUTES discovery until a
        // program's first draw. Doing all programs in that draw produced the
        // measured multi-second loader freeze even after parallel compilation.
        // Once linking reports ready, finalize one interface per loader frame.
        const started = performance.now()
        program.getUniforms?.()
        timings.push({
          index,
          ms: performance.now() - started,
          key: program.cacheKey?.slice(0, 180) ?? '',
        })
        await nextFrame()
      }
      if (PROFILE_INSPECT) {
        ;(window as unknown as { __warmInterfaceTimings?: unknown }).__warmInterfaceTimings =
          timings.sort((a, b) => b.ms - a.ms)
      }
    }

    const done = async () => {
      if (cancelled) return
      // Trigger the journal's asynchronous work explicitly and keep the opaque
      // loader up until it is finished. Previously two offscreen sweeps ran at
      // 1.5s and 5s *after* reveal; if the reader clicked during either sweep,
      // its shader-link and texture-upload work landed inside the camera move.
      const fontsReady = loadBookFonts()
      const printsReady = waitForBookImages()
      const before = gl.info.programs?.length ?? 0
      await compileWithoutBlocking()
      const textures = await uploadTextures()
      await Promise.allSettled([fontsReady, printsReady])
      if (cancelled) return
      // Book effects repaint their canvases in promise continuations. Yield,
      // upload those final canvases in the same chunked fashion, then ask the
      // parallel compiler for any program keys that changed with their maps.
      await nextFrame()
      await nextFrame()
      await uploadTextures()
      await compileWithoutBlocking()
      await prepareProgramInterfaces()
      if (cancelled) return
      // The Canvas is held at `frameloop="never"` until this point, preventing
      // R3F's first normal render from racing the parallel compiler and forcing
      // a synchronous link. While the curtain is still opaque, render each
      // tent's real interior state for a few frames. This prepares the depth
      // variants and shadow/post passes that scene traversal alone cannot
      // compile and that otherwise appear as a one-time hitch on first entry.
      onPrepared()
      for (const index of [0, 1, 2] as const) {
        onPrewarm(index)
        await nextFrame()
        await nextFrame()
        await nextFrame()
        await nextFrame()
        await nextFrame()
      }
      // Restore the exact lobby state and rebuild its shadow map before the
      // loader fades. None of the temporary interior frames can reach screen.
      onPrewarm(null)
      await nextFrame()
      await nextFrame()
      await nextFrame()
      await nextFrame()
      await nextFrame()
      await nextFrame()
      await nextFrame()
      await nextFrame()
      await waitForSubmittedGpuWork()
      if (cancelled) return
      if (import.meta.env.DEV) {
        ;(window as unknown as { __warm?: unknown }).__warm = {
          textures,
          programsBefore: before,
          programsAfter: gl.info.programs?.length ?? 0,
          calls: gl.info.render.calls,
        }
      }
      onReady?.()
    }

    void done()
    return () => {
      cancelled = true
    }
  }, [
    gl,
    scene,
    camera,
    onReady,
    onPrepared,
    onPrewarm,
    tentClothTexture,
    tentLeatherTexture,
  ])

  return null
}

export default function CampHero({
  active,
  onFocus,
  entered,
  onEnter,
  onNavigate,
  onZoom,
  onBookOpenRequest,
  onBookClose,
  onProgress,
  onReady,
}: {
  /** Whether the prepared WebGL scene is currently observable by the reader. */
  active: boolean
  onFocus?: (i: TentIndex) => void
  entered: number | null
  onEnter: (i: TentIndex) => void
  onNavigate: (to: string, from?: PageScreenRect) => void
  onZoom?: (src: string, from: PageScreenRect) => void
  /** Fired the moment the reader clicks the closed journal open. */
  onBookOpenRequest?: () => void
  /** Fired when the open journal is put down without leaving the tent. */
  onBookClose?: () => void
  /** 0-1 through the asset download. */
  onProgress?: (p: number) => void
  /** Fired once every shader is compiled and the scene is safe to reveal. */
  onReady?: () => void
}) {
  const [renderReady, setRenderReady] = useState(false)
  const [warmupReady, setWarmupReady] = useState(false)
  const [prewarmIndex, setPrewarmIndex] = useState<TentIndex | null>(null)
  const beginRendering = useCallback(() => setRenderReady(true), [])
  const setInteriorPrewarm = useCallback((index: TentIndex | null) => setPrewarmIndex(index), [])
  const finishWarmup = useCallback(() => {
    setWarmupReady(true)
    onReady?.()
  }, [onReady])
  const prevEntered = useRef(entered)

  useEffect(() => {
    if (prevEntered.current === entered) return
    if (entered !== null) sfxEnter()
    else sfxExit()
    prevEntered.current = entered
  }, [entered])

  return (
    <>
    <LoadTracker onProgress={onProgress} />
    <Canvas
      className="hero__canvas"
      frameloop={renderReady ? 'always' : 'never'}
      // PCF with a radius, not the default PCFSoft.
      //
      // PCFSoft's kernel is fixed — it ignores `shadow.radius` — so the one
      // shadow edge that matters, the shaft of moonlight coming through the
      // doorway and falling across the open journal, arrived as a hard
      // staircase however the map was sized or the frustum tightened. A
      // widened PCF kernel is both cheaper and, at this scale, far softer.
      shadows="percentage"
      dpr={GRAPHICS_DPR}
      /*
        The visible scene target is not multisampled or alpha-backed.

        Neither of these should do anything: the `EffectComposer` below owns the
        render loop, the scene lands in its own half-float target, and the only
        thing ever written to the drawing buffer is one full-screen triangle
        carrying the finished frame. Multisampling a full-screen triangle has no
        interior edges to resolve, and nothing shows through an alpha channel
        here because the sky sphere covers every pixel — so turning both off is
        a saved buffer and a saved resolve blit for no visible cost, and the
        screenshot diff agrees to the bit on every pose the site can reach.

        Development keeps canvas MSAA because `?post=0` pulls the composer out
        and draws the raw scene straight into this buffer. Production always
        uses the composer, so it can skip canvas MSAA without touching the
        scene's actual render target. The drawing buffer is opaque in both
        builds because the sky covers every pixel.

        See OPTIMIZATION.md §3 for what it costs.
      */
      gl={{ antialias: import.meta.env.DEV, alpha: false, powerPreference: 'high-performance' }}
      camera={{ position: [CAMP_X, EYE + 0.5, 14], fov: 42, near: 0.06, far: 400 }}
      onCreated={(state) => {
        state.gl.toneMapping = THREE.ACESFilmicToneMapping
        // Back to unity. ACES rolls the top off hard, so the fire and the moon
        // survive it either way — but the extra stop was being spent on
        // everything that is merely lit, which is the whole forest, and a
        // forest a stop up at midnight is the difference between a silhouette
        // and a wall. See NIGHT.
        state.gl.toneMappingExposure = NIGHT.exposure

        /*
          Don't ask the driver whether each program linked.

          Three.js calls `getProgramInfoLog` on every program it builds, and
          that call is a *synchronisation point*: shader compilation and linking
          are asynchronous on every modern driver, and asking for the log forces
          the CPU to sit and wait until the answer exists. One at a time.

          It is invisible at load — the loading screen covers it — and it was
          the single largest thing in the frame where a tent is clicked, where
          the interior's materials appear and every existing material has to be
          rebuilt for the new light count. Profiled across that click it was
          4.7 seconds of a 9.5-second stall: half the freeze, spent on error
          checking for shaders that had already been checked in development.

          Which is why the check stays on in dev. A silently failed shader is a
          grey frame with no message anywhere, and that is a genuinely horrible
          thing to debug — so the build that gets iterated on keeps the
          diagnostics, and the build that ships keeps the frame rate.
        */
        state.gl.debug.checkShaderErrors = import.meta.env.DEV

        // Dev handle for the screenshot harness: raycasting into the live scene
        // is the only way to find out what a stray blob in a render actually is.
        if (import.meta.env.DEV || PROFILE_INSPECT) {
          ;(window as unknown as { __camp?: unknown }).__camp = state
        }
      }}
    >
      {/* Activity cannot stop the loop until every hidden interior-prewarm frame
          has completed, even if this Canvas is reused without About's guard. */}
      <ActivityFrameloop active={renderReady && (!warmupReady || active)} />
      <Suspense fallback={null}>
        <Scene
          onFocus={onFocus ?? (() => {})}
          entered={entered}
          onEnter={onEnter}
          onNavigate={onNavigate}
          onZoom={onZoom}
          onBookOpenRequest={onBookOpenRequest}
          onBookClose={onBookClose}
          prewarmIndex={prewarmIndex}
        />
        {/* Inside the Suspense boundary, so it runs once the kit and the
            textures are actually here and there is something to compile. */}
        <Warmup
          onReady={finishWarmup}
          onPrepared={beginRendering}
          onPrewarm={setInteriorPrewarm}
        />
      </Suspense>
    </Canvas>
    </>
  )
}
