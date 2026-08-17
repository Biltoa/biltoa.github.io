import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Html, PerformanceMonitor, useProgress } from '@react-three/drei'
import {
  Bloom,
  BrightnessContrast,
  EffectComposer,
  HueSaturation,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { clamp01, damp, easeInOutCubic, scrollDriver } from '../lib/scroll'
import { sfxEnter, sfxExit, sfxHover, tickAudio } from '../lib/audio'
import { tintParts, useKit, type Part } from './campsite/useKit'
import {
  applyGroundGlow,
  AURORA_BOUNCE_HIGH,
  AURORA_BOUNCE_LOW,
  AURORA_BOUNCE_MID,
  setWarmLights,
  tickWind,
} from './campsite/wind'
import { makeOutlineShell } from './campsite/outline'
import { applyParallax } from './campsite/parallax'
import { installHeightFog } from './campsite/fog'
import { fireFlicker } from './campsite/fire'
import { SplitToneEffect } from './campsite/grade'
import Book from './campsite/Book'
import {
  Campfire,
  Fireflies,
  Haze,
  Impostors,
  InstancedParts,
  Leaves,
  MOON_LIGHT,
  NightSky,
  Stars,
  TorchFlame,
  buildMatrices,
  rng,
} from './campsite/Effects'

/* -------------------------------------------------------------------------- */
/*  Night lighting, in one place.                                               */
/*                                                                              */
/*  Everything cold is here; everything warm is FIRELIGHT in Effects.tsx. The    */
/*  whole rig is built round one relationship — a cool, dim, directional moon    */
/*  against a warm, bright, local fire — and the single most common way to lose  */
/*  it is to add a little more ambient until the shadows go grey. Ambient here   */
/*  is deliberately far lower than looks right in isolation: the fire is what    */
/*  should be revealing the camp, and the sky is only what stops the parts it    */
/*  cannot reach from being black holes.                                        */
/* -------------------------------------------------------------------------- */
const NIGHT = {
  /** Key: the moon. Aligned with the disc painted in the sky shader. */
  moon: { intensity: 1.55, color: '#93b4ee' },
  /** Cool rim from behind and above, which is what separates tent from tree. */
  rim: { intensity: 0.62, color: '#5aa9ff' },
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
  hemisphere: { sky: '#2a3050', ground: '#070a14', intensity: 0.23 },
  /** The last resort against crushed black. Very small. */
  // LIGHTING-REWORK (2026-08-17): #22345e -> #1c2c5c, same intensity.
  ambient: { intensity: 0.05, color: '#1c2c5c' },
  /**
   * Depth haze. See campsite/fog.ts — this is height fog, not distance fog.
   *
   * Darker and thinner. Fog is additive over distance, so its colour is a floor
   * under everything past 26 metres — which is the entire treeline. At
   * `#132a58` that floor was brighter than the reference's *trees*.
   */
  fog: { color: '#141426', density: 0.0068 },
  /** ACES exposure. */
  exposure: 1.02,
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
  grassWarm: { fireRadius: 5.6, firePower: 1, torchRadius: 3.4, torchPower: 0.55 },
} as const

/**
 * How often the shadow map is re-rendered, in hertz.
 *
 * Not sixty. The only shadow caster in this scene that moves at all is a tent
 * bobbing a couple of centimetres as the scroll focus passes it, and a shadow
 * two frames stale at that amplitude is a shadow nobody can tell from a fresh
 * one. Everything else — benches, stones, torch stakes, the firewood — is
 * bolted to the ground.
 */
const SHADOW_HZ = 6

/**
 * **The number of point lights in this scene never changes.** Fourteen, from
 * the first frame to the last.
 *
 * One for the fire, six for the door torches, three for the tent lamps, and
 * four interior sources — two candles, a lantern and the reading light — which
 * belong to whichever tent is `active` and to no other. Exactly one tent is
 * ever active, so the four exist exactly once.
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
 * The four extra lights that now burn at zero in the lobby cost about 0.7ms a
 * frame. That is the price, and it is worth paying several times over.
 *
 * **If you add a light to this scene, mount it unconditionally.**
 */
const MOUNTED_POINT_LIGHTS = 14

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

/** Structure_Tent_01 — tall pavilion, 9.79 x 5.20 x 5.28 raw. */
const TENT = {
  node: 'Tent',
  scale: 0.62,
  /** Turns the mesh so its doorway faces the clearing. */
  flip: Math.PI,
  rawDepth: 5.28,
  rawHeight: 5.2,
  rawWidth: 9.79,
} as const

const BACK = (TENT.rawDepth * TENT.scale) / 2
const HALF_W = (TENT.rawWidth * TENT.scale) / 2
const TOP = TENT.rawHeight * TENT.scale

/**
 * The camp is centred on the fire, and the outer tents are pulled forward and
 * turned inward so the three sit on an arc rather than in a shop-window row.
 */
const CAMP_X = 0
const TENTS = [
  { x: CAMP_X - 8.2, z: -5.4, yaw: 0.46 },
  { x: CAMP_X, z: -7.8, yaw: 0 },
  { x: CAMP_X + 8.2, z: -5.4, yaw: -0.46 },
]
const TENT_TINT = ['#e8492c', '#3f6ef5', '#f5b722']
/** Saturated neon versions for the signage — a tent tint is fabric, not light. */
const TENT_NEON = ['#ff5a3c', '#5aa0ff', '#ffc94a']
const TENT_LABEL = ['About', 'Gameplay', 'Projects']

const EYE = 2.15

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
const FIRE_POS: [number, number, number] = [CAMP_X, 0, 1.2]
const FIRE_VEC = new THREE.Vector3(...FIRE_POS)

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
const BOOK_WIDTH = 0.6

/**
 * Reading pose, relative to the journal: how far back toward the door the eye
 * sits and how far above it. Roughly 57 degrees down from horizontal — steep
 * enough that both pages are square to the lens instead of raking away, which
 * is what made the far page hard to read.
 *
 * The distance is set by the page, not by the pitch: closer than about 0.8m
 * the open spread is deeper than the frame is tall and the foot of both pages
 * is cropped.
 */
const READ_BACK = 0.44
const READ_RISE = 0.67

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
  }
}

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

/** Radial alpha mask, reused for the trodden patch and the journal's shadow. */
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
 * Radius of the trodden clearing round the fire.
 *
 * Tighter than the paved circle it replaces. Bare earth reads as bare earth
 * only where there is a reason for it — inside the ring of benches, where feet
 * actually fall — and a wider patch than the firelight covers came out as a
 * flat grey pad in the middle of the frame.
 */
const WALK_R = 3.85

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

function Ground() {
  const [grass, grassN, dirt, dirtN] = useLoader(THREE.TextureLoader, [
    '/textures/T_AutumnGrass_01_C.webp',
    '/textures/T_AutumnGrass_01_N.webp',
    '/textures/T_Dirt_Ground_C.webp',
    '/textures/T_Dirt_Ground_N.webp',
  ])

  const walkMask = useMemo(makeWalkwayMask, [])

  useMemo(() => {
    for (const t of [grass, grassN]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(96, 96)
      t.anisotropy = 8
    }
    grass.colorSpace = THREE.SRGBColorSpace
    dirt.colorSpace = THREE.SRGBColorSpace
    for (const t of [dirt, dirtN]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      // Four tiles across an 8.9m disc is a little over two metres of ground
      // per tile, which is close enough to the scale the pack authored it at
      // that the ruts come out life-sized rather than as gravel.
      t.repeat.set(4, 4)
      t.anisotropy = 8
    }
  }, [grass, grassN, dirt, dirtN])

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
    const m = new THREE.MeshLambertMaterial({
      map: dirt,
      normalMap: dirtN,
      // No roughness map. The pack authors this one for a daylit terrain
      // shader and its gloss reads as wet: under a point light a metre off the
      // ground the specular lobe swept the whole disc and the clearing came out
      // looking like a pond with the fire reflected in it.
      normalScale: new THREE.Vector2(0.9, 0.9),
      alphaMap: walkMask,
      transparent: true,
      // Warm, because this is the one patch of ground the fire genuinely
      // reaches — it is what the pool of light lands on — but dark enough that
      // the light is what brightens it rather than the texture.
      // A touch up from #5a3f28. Lambert has no specular term, and on this disc
      // the sheen it lost was the one thing carrying a little of the sky's
      // colour into the middle of the frame — the albedo has to make it back.
      color: '#694c30',
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
    // Shallower than the paving's: a rut in packed earth is a couple of
    // centimetres, not the step down between two setts.
    //
    // Nine steps rather than sixteen. This is a ray march with a texture fetch
    // per iteration running on the single largest unbroken surface in frame; at
    // this depth the difference between nine samples and sixteen is not visible
    // and the cost of it is.
    applyParallax(m, { depth: 0.012, steps: 9, occlusion: 0.34 })
    return m
  }, [dirt, dirtN, walkMask])

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
      map: grass,
      normalMap: grassN,
      normalScale: new THREE.Vector2(0.75, 0.75),
      // Cool, not brown — this is the soil *between* the blades, and out past
      // the fire's reach it is most of what the eye actually sees of the
      // field. The warmth now comes from applyGroundGlow's own pool instead
      // of a flat multiply, so this stays the resting colour of unlit ground.
      color: '#3a4055',
    })
    applyGroundGlow(m, {
      // Most of the way to grey, same as the blades: enough of the map's own
      // pattern survives to keep the ground from looking painted, not enough
      // for the autumn yellow to fight the tint on top of it.
      desaturateMap: 0.72,
      mapTint: new THREE.Color('#4a7a3c'),
      // Same rust-orange the blades stand in, so the pool under everyone's
      // feet reads as one fire rather than the ground and the grass disagreeing
      // on what colour it is.
      warmColor: new THREE.Color('#ff9a55'),
      warmGain: 0.16,
      // The far field's only light once it is out of the fire's reach: the
      // same teal-to-magenta ramp the canopies bounce, flat rather than
      // height-weighted because the ground has no crown to bias toward.
      aurora: { low: AURORA_BOUNCE_LOW, mid: AURORA_BOUNCE_MID, high: AURORA_BOUNCE_HIGH, gain: 0.05 },
      // A small constant lift so the plane past both of those never actually
      // hits (0,0,0) — see NIGHT.ambient for why the scene-wide version of
      // this stays just as small.
      floor: new THREE.Color('#0a1120'),
    })
    return m
  }, [grass, grassN])

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow material={grassMat}>
        <planeGeometry args={[360, 360]} />
      </mesh>

      <mesh
        rotation-x={-Math.PI / 2}
        position={[FIRE_POS[0], 0.012, FIRE_POS[2] - 0.35]}
        material={earthMat}
        receiveShadow
      >
        <circleGeometry args={[WALK_R, 72]} />
      </mesh>
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
const TREE_TINTS = ['#3d5225', '#4a5c2a', '#2f4a22', '#3a4e2a', '#55501f']

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
const TREE_AURORA_VIOLET = /* @__PURE__ */ new THREE.Color('#4a4088')

function Scatter() {
  const kit = useKit()

  const grassParts = [kit.grassParts('GrassA'), kit.grassParts('GrassB')]
  const stoneParts = kit.parts('Stone')
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

    const addTree = (x: number, z: number, scale: number) => {
      const key = species[(r() * 3) | 0]
      const group = treeGroups.get(key) ?? { items: [], colors: [] }
      group.items.push({ pos: [x, -0.2, z], rotY: r() * Math.PI * 2, scale })
      trunkShadows.push({ pos: [x, 0.02, z], tiltX: -Math.PI / 2, scale: scale * 3.1 })
      // Depth into the frame.
      const depth = clamp01((-z - 7) / 30)
      const tint = tints[(r() * tints.length) | 0].clone()
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
      tint.multiplyScalar(1.32 - depth * 0.14)
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
        // field. Only the last metre and a half in front of the lens is cleared
        // now, where a blade would be a foot tall in frame.
        if (z > 11.6) continue
        if (z > 10.3 && Math.abs(x - CAMP_X) < 1.7) continue
        const dFire = Math.hypot(x - FIRE_POS[0], z - FIRE_POS[2])
        // Overlaps the paving slightly on purpose: tufts closing over the outer
        // setts are what tie the walkway into the clearing, and matching the two
        // radii exactly left a bald ring of bare ground between them.
        if (dFire < WALK_R - 0.75) continue
        // Clear of each tent's footprint, but only just — the old 3.6 left a
        // bare apron in front of every doorway.
        if (TENTS.some((t) => Math.hypot(x - t.x, z - t.z) < 2.85)) continue
        const far = clamp01((dFire - 6) / 22)
        grassItems[i % 3 === 0 ? 1 : 0].push({
          pos: [x, 0, z],
          rotY: r() * Math.PI * 2,
          scale: scale * (0.62 + r() * 0.45 + far * 0.9),
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
}: {
  position: [number, number, number]
  size: [number, number]
  rotation?: number
  opacity?: number
}) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, rotation]} renderOrder={-2}>
      <planeGeometry args={size} />
      <meshBasicMaterial
        alphaMap={contactShadow ?? undefined}
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

/** Static prop helper — draws a part list at a transform. */
function Prop({
  parts,
  position,
  rotation = 0,
  scale = 1,
  cast = true,
}: {
  parts: Part[]
  position: [number, number, number]
  rotation?: number
  scale?: number | [number, number, number]
  cast?: boolean
}) {
  return (
    <group position={position} rotation-y={rotation} scale={scale}>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geometry} material={p.material} castShadow={cast} receiveShadow />
      ))}
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
  return (
    <group position={position}>
      {kit.parts('Torch').map((p, i) => (
        <mesh key={i} geometry={p.geometry} material={p.material} castShadow />
      ))}
      <TorchFlame position={[0, 1.66, 0]} seed={seed} lit={lit} />
    </group>
  )
}

/**
 * Table candle: the same shader flame as the torches, scaled to a wick.
 *
 * Small. These stand either side of the journal at the reading pose, and at the
 * previous 0.72 they filled the outer thirds of the frame with two columns of
 * wax — the reading shot is of a book, and a candle in it should read as a
 * candle rather than as a pillar.
 */
function Candle({
  position,
  seed,
  scale = 0.34,
  lit = false,
  gain,
}: {
  position: [number, number, number]
  seed: number
  scale?: number
  lit?: boolean
  gain?: React.RefObject<number>
}) {
  const kit = useKit()
  return (
    <group position={position}>
      <group scale={scale}>
        {kit.parts('Candle2').map((p, i) => (
          <mesh key={i} geometry={p.geometry} material={p.material} castShadow />
        ))}
      </group>
      {/*
        Very low intensity, and its own reach.

        A point light falls off with the square of distance, and a wick sitting
        four centimetres from the edge of a page is *close*: at the value these
        used to carry — chosen back when they only had to light props — the page
        received an irradiance of about sixteen and came out as a sheet of white.
        Down again from 0.16, because even that put a blown highlight on the
        outer third of each page: at 7cm the falloff term alone is 1/0.005. The
        reading light over the bench does the actual work; this is the pool of
        light around the candle itself.
      */}
      {/*
        `hasLight` rather than the usual always-mounted source: two of these
        exist per tent, and only the active tent's pair should be in the
        scene's light list. Because exactly one tent is active at a time and
        React swaps them inside one commit, the total never moves. See
        MOUNTED_POINT_LIGHTS.
      */}
      <TorchFlame
        position={[0, 0.288 * scale + 0.008, 0]}
        seed={seed}
        scale={0.13}
        light={0.055}
        reach={1.1}
        strength={0.45}
        hasLight={lit}
        lit={lit}
        gain={gain}
        single
      />
    </group>
  )
}

/* ---------------------------------------------------------- tent interiors */

/**
 * What is inside a tent, in the tent's own frame: +Z is out through the
 * doorway, so a visitor looking in from the door has -X on their left.
 *
 * Laid out the way somebody would actually camp rather than symmetrically —
 * bed down one side, a bench to read at against the back wall with a candle at
 * each end, a cushion on the floor to sit on, and the clutter pushed into the
 * corners.
 *
 * **The room is much smaller than the mesh.** Structure_Tent_01's raw X extent
 * is 9.79 units, but two thirds of that is guy ropes and stakes spreading out
 * across the grass. Ray-casting the canvas from the middle of the floor puts
 * the walls at 1.70m at floor level and 1.57m at knee height, and the back wall
 * about 1.45m behind the centre. Dressing to HALF_W instead left the bedroll,
 * the shelf and the cushions sitting out on the grass either side of the tent.
 */
const ROOM_HALF_W = 1.5
const ROOM_BACK = -1.4

function TentInterior({
  index,
  lit,
  dressed,
  gain,
  readLight,
}: {
  index: number
  /** Whether the interior sources are mounted at all. */
  lit: boolean
  /**
   * Whether the clutter that is only ever seen from *inside* is built.
   *
   * The shelf, its glassware, the pack and the heaped cushions all sit against
   * the side and back walls, where the doorway does not show them: from the
   * clearing a tent is a lit slot with a bed and a bench in it. Three tents'
   * worth of that is thirty draw calls of props nobody can see, carried for the
   * whole time the reader is looking at the camp.
   */
  dressed: boolean
  /** 0 outside, 1 once the camera has arrived — see `Tent`. */
  gain: React.RefObject<number>
  readLight: React.RefObject<THREE.PointLight | null>
}) {
  const kit = useKit()

  // One seeded pass, like every other scatter here, so the clutter is in the
  // same place on every load but different in each of the three tents.
  const corner = useMemo(() => {
    const r = rng(4100 + index * 17)
    return (['Pillow6', 'Pillow5', 'Pillow7'] as const).map((part, i) => ({
      part,
      pos: [0.78 + r() * 0.26, 0.02 + i * 0.1, 0.45 + r() * 0.45] as [number, number, number],
      rotation: r() * Math.PI * 2,
      scale: 0.4 + r() * 0.14,
    }))
  }, [index])

  return (
    <group>
      {/* Bed down the left-hand wall, running front to back. */}
      <Prop
        parts={kit.parts('SleepingBag1')}
        position={[-1.12, 0.02, -0.2]}
        rotation={Math.PI / 2}
        scale={1.05}
        cast={false}
      />
      <Prop
        parts={kit.parts('Pillow5')}
        position={[-1.12, 0.05, -0.98]}
        rotation={Math.PI / 2}
        scale={0.5}
        cast={false}
      />

      {/* The bench, against the back wall, with the journal between two
          candles. Turned a quarter so its long axis runs across the tent. */}
      <Prop
        parts={kit.parts('BenchIndoor')}
        position={[0, 0, BENCH.z]}
        rotation={Math.PI / 2}
        scale={BENCH.scale}
        cast={false}
      />
      <Candle position={[-0.37, BENCH.top, BENCH.z]} seed={index * 3.1} lit={lit} gain={gain} />
      <Candle position={[0.37, BENCH.top, BENCH.z]} seed={index * 3.1 + 5.4} lit={lit} gain={gain} />
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

      {/* Cushion on the floor in front of the bench — the seat. */}
      <Prop
        parts={kit.parts('Pillow7')}
        position={[0, 0.02, BENCH.z + 0.88]}
        rotation={0.24}
        scale={0.78}
        cast={false}
      />

      {/* Shelf against the right-hand wall, turned so its open face looks back
          at the doorway, with the pack's glassware on the tiers. Plus the pack
          in the back corner and the cushions heaped in the front one. None of
          it is on screen until the camera is inside — see `dressed`.

          Hidden rather than unmounted. Every one of these carries a material
          the scene uses nowhere else, and a material that first appears in the
          frame where a tent is clicked is a shader the driver has to compile in
          that frame — which is a stall, right where the walk-in should be
          smooth. Mounted from the start they are compiled during the loading
          screen instead (three's `compile` walks the whole scene, visible or
          not), and an invisible object is skipped whole at render time, so it
          costs nothing per frame until it is shown. */}
      <group visible={dressed}>
          <Prop
            parts={kit.parts('Shelf')}
            position={[ROOM_HALF_W - 0.45, 0, -0.16]}
            rotation={Math.PI / 2}
            scale={0.42}
            cast={false}
          />
          <Prop parts={kit.parts('Jar')} position={[1.02, 0.31, -0.36]} rotation={0.6} scale={0.7} cast={false} />
          <Prop parts={kit.parts('Potion')} position={[1.02, 0.32, -0.1]} rotation={0.2} scale={0.95} cast={false} />
          <Prop parts={kit.parts('Jar')} position={[1.06, 0.31, 0.12]} rotation={-1.1} scale={0.6} cast={false} />
          <Prop parts={kit.parts('Potion')} position={[1.04, 0.63, -0.3]} rotation={-0.5} scale={0.85} cast={false} />
          <Prop parts={kit.parts('Jar')} position={[1.04, 0.62, 0.02]} rotation={1.4} scale={0.55} cast={false} />
          <Prop
            parts={kit.parts('Backpack')}
            position={[-1.22, 0, ROOM_BACK + 0.25]}
            rotation={-0.8}
            scale={0.85}
            cast={false}
          />
          {corner.map((c, i) => (
            <Prop
              key={i}
              parts={kit.parts(c.part)}
              position={c.pos}
              rotation={c.rotation}
              scale={c.scale}
              cast={false}
            />
          ))}
      </group>
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
  rig,
  onEnter,
  onHover,
  onNavigate,
  onBookOpenRequest,
  onClose,
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
  /** The camera rig's own state, read per frame to drive the interior fade. */
  rig: React.RefObject<RigState>
  hovered: number | null
  bookOpen: React.RefObject<number>
  onEnter: (i: TentIndex) => void
  onHover: (i: TentIndex | null, source: 'tent' | 'label') => void
  onNavigate: (to: string) => void
  /** Fired when the reader clicks this tent's closed journal. */
  onBookOpenRequest: () => void
  /** Fired when the journal is closed from its own edge page. */
  onClose: () => void
}) {
  const kit = useKit()
  const group = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  /** Hover highlight, 0-1, damped per frame. */
  const glow = useRef(0)
  const lantern = useRef<THREE.PointLight>(null)
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

  const neon = useMemo(() => new THREE.Color(TENT_NEON[index]), [index])
  /** Lamp colour for this tent — see the light itself. */
  const lampColor = useMemo(
    () => new THREE.Color('#ffab5e').lerp(new THREE.Color(TENT_NEON[index]), 0.32),
    [index]
  )

  const parts = useMemo(() => {
    // Rougher than cloth would be, but not matte. At 0.92 the canvas took no
    // specular at all, so the rim light passed straight over the folds and
    // every wall came out as one flat panel of colour; a little sheen is what
    // makes the seams and the sag read.
    const list = tintParts(kit.parts(TENT.node), TENT_TINT[index], {
      roughness: 0.74,
      side: THREE.DoubleSide,
      emissive: new THREE.Color('#000000'),
    })
    return list
  }, [kit, index])

  /**
   * `parts` minus the window sash — see tools/export-campsite.py's
   * `mark_faces_by_bbox`, which split the sash onto its own material slot
   * (named `Tent_1`) for exactly this reason. The sash is real geometry with
   * its own silhouette, so the hover hull (below) outlined it exactly as
   * brightly as the roofline it exists to draw attention to instead. It
   * still renders normally in `parts` above — only the extra hover wash and
   * hull outline skip it.
   */
  const glowParts = useMemo(() => parts.filter((p) => p.material.name !== 'Tent_1'), [parts])

  /** The neon edge, drawn as a swollen back-faced copy. See campsite/outline. */
  const shell = useMemo(() => makeOutlineShell(neon), [neon])
  const shellGroup = useRef<THREE.Group>(null)

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
    const near = clamp01(1 - Math.abs(focus.current - index))
    g.position.y += (near * 0.05 - g.position.y) * damp(5, delta)

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

    // Gates the hover highlight/scale back on once the camera is back outside
    // the tent, not the instant `entered` goes null. `entered` flips at the
    // ESC key, but the camera is still backing out and the book is still (or
    // has just finished) closing — `entered === null` alone let the tent puff
    // up and glow while that was still playing.
    //
    // 0.47 is the doorway threshold `CameraRig` itself uses for "back outside,
    // still walking away" (the raw travel at which its eased split crosses
    // 0.42 — see the duck-through leg there): past that point the lens has
    // cleared the flap, so the highlight can come back while the camera is
    // still finishing its walk to the resting pose instead of waiting for it
    // to actually arrive. Only the tent just exited has a travel to wait out;
    // the other two were never toured, so they're not held back.
    const settled = !active || rig.current.travel < 0.47
    const b = body.current
    if (b) {
      const target = isHovered && entered === null && settled ? 1.03 : 1
      const s = THREE.MathUtils.lerp(b.scale.x / TENT.scale, target, damp(7.7, delta)) * TENT.scale
      b.scale.setScalar(s)
    }

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
      exactly there. The outline that is wanted is the hull in `campsite/
      outline.ts`; a rim cannot draw one on flat panels and only ever muddied
      the fabric underneath it.

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
    const hot =
      FROZEN_HOT !== null ? FROZEN_HOT === index : isHovered && entered === null && settled
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
    for (const p of glowParts) {
      ;(p.material as THREE.MeshStandardMaterial).emissive
        .copy(neon)
        .multiplyScalar(glowNow * 0.018)
    }
    shell.set(glowNow)
    // Hidden outright below the threshold rather than drawn at zero: this is
    // the one extra draw call in the hover, and there is no reason to pay it
    // for the 99% of the scene's life when nothing is hovered. A hidden object
    // still gets its program built by `Warmup`, which walks with `traverse`.
    if (shellGroup.current) shellGroup.current.visible = glowNow > 0.004

    const flick = fireFlicker(state.clock.elapsedTime * 0.8 + index)
    if (lantern.current) lantern.current.intensity = 2.2 * flick * k
    if (readLight.current) readLight.current.intensity = 0.6 * k
    if (glowLight.current) {
      // The lamp burning inside the tent. Outside it is bright and sits low and
      // back, so the whole canvas glows from within; from the reading pose it
      // slides forward toward the doorway, well behind the lens, and drops to a
      // level that keeps the dressing off black without adding to the page.
      // Ahead of the ramp, deliberately. The mid-point of a linear crossfade
      // between these two settings is brighter *and* closer to the bench than
      // either end, so the one frame the camera spends coming down over the
      // journal was the frame the bench was most blown out in.
      const g = Math.pow(k, 0.55)
      const l = glowLight.current
      l.position.set(0, THREE.MathUtils.lerp(1.15, 1.5, g), THREE.MathUtils.lerp(-0.3, 0.95, g))
      // `here` scales rather than unmounts — see MOUNTED_POINT_LIGHTS. A light
      // at zero intensity contributes exactly nothing, which is the same
      // picture the old `{here && …}` produced, at none of the cost.
      l.intensity = here ? THREE.MathUtils.lerp(7.5, 0.9, g) : 0
      l.distance = THREE.MathUtils.lerp(6.4, 5.2, g)
    }
  })

  return (
    <group ref={group} position={[t.x, 0, t.z]} rotation-y={t.yaw}>
      <group
        ref={body}
        scale={TENT.scale}
        rotation-y={TENT.flip}
        onClick={(e) => {
          e.stopPropagation()
          if (entered === null) onEnter(index as TentIndex)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          onHover(index as TentIndex, 'tent')
        }}
        onPointerOut={() => onHover(null, 'tent')}
      >
        {parts.map((p, i) => (
          <mesh key={i} geometry={p.geometry} material={p.material} castShadow receiveShadow />
        ))}
        {/* The hover outline. Same geometry, drawn once more — see
            campsite/outline.ts for why it is a hull and not a rim or a pass. */}
        <group ref={shellGroup} visible={false}>
          {glowParts.map((p, i) => (
            <mesh key={`o${i}`} geometry={p.geometry} material={shell.material} renderOrder={2} />
          ))}
        </group>
      </group>

      {/*
        A light burning inside the tent.

        The canvas is double-sided, so a source in the middle of the room lights
        the *inside* of the walls and the fabric glows — which is what a lit tent
        looks like from outside at night, and what the whole camp was missing:
        three unlit shells standing in a dark clearing read as scenery, three
        lit ones read as somewhere people are. Short reach, so it stays in its
        own tent and never spills onto the grass.

        It moves once the camera is inside. Left where it is, it sits a metre
        above the journal and floods the open spread — the room has its own
        reading light over the bench, sized for paper at arm's length, and the
        two together blow the page to white. From the reading pose it hangs back
        by the doorway instead, well behind the lens, where its job is to keep
        the canvas and the dressing off black rather than to light the page.

        Both moves are driven per frame off `inside`, not switched on a prop —
        see the ref's own note.
      */}
      {/* Always mounted; `here` scales its intensity instead. See
          MOUNTED_POINT_LIGHTS. */}
      <pointLight
          ref={glowLight}
          position={[0, 1.15, -0.3]}
          /*
            Warm, but carrying some of the tent's own colour.

            The canvas is a single double-sided surface, so nothing in the
            renderer models light passing *through* dyed cloth — and that is
            most of what a lit tent looks like from outside. Without it the
            blue tent was the one casualty of taking the warm directional out:
            blue pigment under an orange lamp absorbs nearly all of it, and the
            middle of the camp came out a flat grey while the red and yellow
            tents kept their hue. Blending the lamp toward the tent's own colour
            is the cheap stand-in for transmission, and it costs nothing.
          */
          color={lampColor}
          intensity={7.5}
          distance={6.4}
          decay={2}
        />

      <TentInterior
        index={index}
        lit={active}
        dressed={roomLit}
        gain={inside}
        readLight={readLight}
      />

      {/* Lantern on the floor beside the bench. The candles carry the reading
          light now, so this is fill rather than the key.

          Mounted for whichever tent is `active` — exactly one, always — rather
          than only once a tent has been entered, so the scene's light count
          never moves. Its intensity is driven from `inside`, which is zero
          until the camera is actually in the room. */}
      <Prop parts={kit.parts('Lamp')} position={[-1.15, 0, 0.78]} scale={0.85} cast={false} />
      {active && (
        <pointLight
          ref={lantern}
          position={[-1.15, 0.36, 0.78]}
          color="#ffc178"
          intensity={0}
          distance={3.6}
          decay={2}
        />
      )}

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
        <mesh
          position={[BOOK_LOCAL.x, BENCH.top + 0.004, BOOK_LOCAL.z]}
          rotation-x={-Math.PI / 2}
          renderOrder={1}
        >
          <planeGeometry args={[0.84, 0.64]} />
          <meshBasicMaterial
            alphaMap={contactShadow ?? undefined}
            color="#140b06"
            transparent
            opacity={0.34}
            depthWrite={false}
          />
        </mesh>
        <Book
          index={index}
          width={BOOK_WIDTH}
          position={[BOOK_LOCAL.x, BOOK_LOCAL.y, BOOK_LOCAL.z]}
          openRef={bookOpen}
          // `roomActive`, not `active`: the journal must stay shut and
          // unrevealed for as long as it is only in the scene to have its
          // shaders built and textures decoded.
          enabled={roomActive}
          accent={TENT_NEON[index]}
          live={entering}
          onNavigate={onNavigate}
          onOpenRequest={onBookOpenRequest}
          onClose={onClose}
        />
      </group>

      {/* Torches flanking the entrance. */}
      <Torch position={[-HALF_W * 0.72, 0, BACK + 0.35]} seed={index * 2.3} lit={here} />
      <Torch position={[HALF_W * 0.72, 0, BACK + 0.35]} seed={index * 2.3 + 1.7} lit={here} />

      {/* What plants the tent on the grass. The moon's shadow map covers the
          whole camp at three centimetres a texel, which at the foot of a wall
          is not enough to draw the dark line where canvas meets ground. */}
      <ContactShadow position={[0, 0.02, 0]} size={[3.7, 3.4]} opacity={0.26} />
      <ContactShadow
        position={[-HALF_W * 0.72, 0.02, BACK + 0.35]}
        size={[1.1, 1.1]}
        opacity={0.3}
      />
      <ContactShadow
        position={[HALF_W * 0.72, 0.02, BACK + 0.35]}
        size={[1.1, 1.1]}
        opacity={0.3}
      />
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
  if (entered !== null) return null
  const sign = tentFrame(index).sign

  return (
    <Html
      center
      distanceFactor={13}
      position={[sign.x, TOP + 1.15, sign.z]}
      style={{ pointerEvents: 'auto', userSelect: 'none' }}
      zIndexRange={[8, 0]}
    >
      <div
        className={`tentsign${hovered === index ? ' is-hot' : ''}`}
        style={{ ['--tent-color' as string]: TENT_NEON[index] }}
        onPointerEnter={() => onHover(index as TentIndex, 'label')}
        onPointerLeave={() => onHover(null, 'label')}
        onClick={() => onEnter(index as TentIndex)}
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
        <span className="tentsign__trail" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
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
  focusRef,
  onFocus,
}: {
  state: React.RefObject<RigState>
  focusRef: React.RefObject<number>
  onFocus: (i: TentIndex) => void
}) {
  const { camera, pointer, size } = useThree()
  const pos = useMemo(() => new THREE.Vector3(), [])
  const look = useMemo(() => new THREE.Vector3(), [])
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
        THREE.MathUtils.lerp(CAMP_X + lobbyX + smoothPointer.x * 0.8, frame.approach.x, k),
        // Ends the approach well below the lintel. Arriving at the doorway at
        // eye height and *then* crouching meant the descent had to happen
        // inside the last metre, which the damped follow could not keep up
        // with — see the duck below.
        THREE.MathUtils.lerp(EYE + 0.45 - smoothPointer.y * 0.35, 0.9, k),
        THREE.MathUtils.lerp(lobbyZ, frame.approach.z, k)
      )
      look.set(
        THREE.MathUtils.lerp(CAMP_X + lobbyX * 0.55, frame.origin.x, k),
        // And already aimed low. Looking at the middle of the tent puts the
        // canvas above the door across the top of the frame for the whole
        // approach, which is the first half of "it hits the door frame".
        THREE.MathUtils.lerp(EYE - 0.35, 0.62, k),
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
      const here = frame.approach.clone().lerp(frame.inside, k)
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
      look.set(
        frame.book.x,
        THREE.MathUtils.lerp(BOOK_LOCAL.y + 0.02, BOOK_LOCAL.y + 0.01, e),
        THREE.MathUtils.lerp(frame.book.z + 0.06, frame.book.z - 0.02, e)
      )
      fov = THREE.MathUtils.lerp(39, 42, e)
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
function SplitTone() {
  const effect = useMemo(() => new SplitToneEffect(), [])
  useEffect(() => () => effect.dispose(), [effect])
  return <primitive object={effect} dispose={null} />
}

/* ------------------------------------------------------------------- scene */

function Scene({
  onFocus,
  entered,
  onEnter,
  onNavigate,
  onBookOpenRequest,
  onExit,
}: {
  onFocus: (i: TentIndex) => void
  entered: number | null
  onEnter: (i: TentIndex) => void
  onNavigate: (to: string) => void
  onBookOpenRequest?: () => void
  onExit?: () => void
}) {
  const kit = useKit()
  const focusRef = useRef(1)
  const bookOpen = useRef(0)
  // Armed by clicking the closed journal — see the `openTarget` guard below.
  // Reset alongside `hovered` whenever `entered` changes, so walking into the
  // next tent asks to be opened again instead of inheriting the last click.
  const wantOpen = useRef(false)
  const rig = useRef<RigState>({ entered, active: entered ?? 1, travel: entered === null ? 0 : 1 })
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
  const [hovered, setHovered] = useState<number | null>(null)
  const hoverSource = useRef<{ tent: number | null; label: number | null }>({ tent: null, label: null })

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
  const lastShadow = useRef(-1)
  const lastLightCheck = useRef(-1)
  const { gl } = useThree()

  // Shadow maps are re-rendered on a timer, not per frame — see SHADOW_HZ.
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
    const cam = l.shadow.camera
    if (roomLit) {
      const t = TENTS[active]
      const S = 3.4
      cam.left = -S
      cam.right = S
      cam.top = S
      cam.bottom = -S
      l.position.set(
        t.x + MOON_LIGHT.x * 26,
        MOON_LIGHT.y * 26,
        t.z + MOON_LIGHT.z * 26
      )
      l.target.position.set(t.x, 0.7, t.z)
    } else {
      cam.left = -24
      cam.right = 24
      cam.top = 22
      cam.bottom = -14
      l.position.set(MOON_LIGHT.x * 42, MOON_LIGHT.y * 42, MOON_LIGHT.z * 42)
      l.target.position.set(CAMP_X, 0, -3)
    }
    // The target is not in the scene graph, so its world matrix has to be
    // brought up to date by hand before the shadow camera reads it.
    l.target.updateMatrixWorld()
    cam.updateProjectionMatrix()
    gl.shadowMap.needsUpdate = true
  }, [roomLit, active, gl])

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
    wantOpen.current = false
  }, [entered])

  const handleHover = (i: TentIndex | null, source: 'tent' | 'label') => {
    hoverSource.current[source] = i
    const next = hoverSource.current.tent ?? hoverSource.current.label ?? null
    setHovered((prev) => {
      if (next !== null && next !== prev) sfxHover()
      return next
    })
  }

  useEffect(() => {
    document.body.classList.toggle('camp-hover', hovered !== null && entered === null)
    return () => document.body.classList.remove('camp-hover')
  }, [hovered, entered])

  useFrame((state, delta) => {
    const st = rig.current
    const goingIn = st.entered !== null

    // Arriving and reading are two moves, not one.
    //
    // On the way in the cover only starts lifting once the camera has actually
    // stopped, so the opening is something you watch rather than something
    // that has already happened by the time you get there. On the way out the
    // travel value is pinned until the journal has shut, so the closing plays
    // in front of the lens instead of behind a camera already backing away.
    // 0.03, not 0.015: the book reads as shut well before the damped close
    // actually crosses either threshold, so the gap between them is pure
    // stare-at-a-closed-book time. Doubling it here roughly halves that wait
    // without the release firing while the cover is visibly still falling.
    const holdForBook = !goingIn && bookOpen.current > 0.03
    const travelTarget = goingIn ? 1 : holdForBook ? st.travel : 0
    st.travel += (travelTarget - st.travel) * damp(1.33, delta)
    // ?travel=0.55 pins the walk-in part-way through. The headless screenshot
    // pass runs at a few frames a second, so a damped animation cannot be
    // caught by waiting on a stopwatch.
    if (FROZEN_TRAVEL !== null) st.travel = FROZEN_TRAVEL

    // Opens on arrival *and* a click — not arrival alone. The camera used to
    // fling the cover back the moment it settled, which handed the reader an
    // already-open book instead of a closed one sitting on a bench waiting to
    // be picked up. `wantOpen` is armed by clicking the cover itself; see
    // Book's onOpenRequest.
    const openTarget = goingIn && st.travel > 0.965 && wantOpen.current ? 1 : 0
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
    tickWind(t, flicker, FIRE_VEC)
    tickAudio(t, flicker)

    // Re-render the shadow map a few times a second instead of every frame.
    // See SHADOW_HZ and the note on the key light.
    if (t - lastShadow.current > 1 / SHADOW_HZ) {
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
        ref={keyLight}
        position={[MOON_LIGHT.x * 42, MOON_LIGHT.y * 42, MOON_LIGHT.z * 42]}
        intensity={NIGHT.moon.intensity}
        color={NIGHT.moon.color}
        castShadow
        // Tighter frustum at a smaller resolution than it used to have: the
        // same texels per metre across the part of the scene that is ever on
        // camera, for 45% of the shadow pass. The frustum is then re-aimed at
        // whichever tent the camera walks into — see the effect below.
        //
        // The map itself is re-rendered a few times a second rather than every
        // frame — see SHADOW_HZ. Nothing in this scene that casts a shadow
        // moves: the tents bob a couple of centimetres, everything else is
        // bolted down. Paying a full 1536² depth pass sixty times a second to
        // track that is the definition of a fixed cost with nothing to show
        // for it.
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
      <directionalLight
        position={[-16, 20, -34]}
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
        args={[NIGHT.hemisphere.sky, NIGHT.hemisphere.ground, NIGHT.hemisphere.intensity]}
      />
      <ambientLight intensity={NIGHT.ambient.intensity} color={NIGHT.ambient.color} />

      <Ground />
      <Impostors center={[CAMP_X, 0]} />
      <Haze center={[CAMP_X, 0]} />
      <Scatter />

      <group position={FIRE_POS}>
        <group scale={0.85}>
          {fireRocks.map((p, i) => (
            <mesh key={`r${i}`} geometry={p.geometry} material={p.material} receiveShadow />
          ))}
          {firewood.map((p, i) => (
            <mesh key={`w${i}`} geometry={p.geometry} material={p.material} castShadow />
          ))}
        </group>
      </group>
      <Campfire position={FIRE_POS} />

      {[0, 1, 2].map((i) => (
        <Tent
          key={i}
          index={i}
          focus={focusRef}
          entered={entered}
          active={active === i}
          roomLit={roomLit}
          hovered={hovered}
          bookOpen={bookOpen}
          deep={deep}
          rig={rig}
          onEnter={onEnter}
          onHover={handleHover}
          onNavigate={onNavigate}
          onBookOpenRequest={() => {
            wantOpen.current = true
            onBookOpenRequest?.()
          }}
          onClose={() => onExit?.()}
        />
      ))}

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

      <Fireflies center={[CAMP_X, -6]} count={110} />
      <Leaves count={55} />

      <CameraRig state={rig} focusRef={focusRef} onFocus={onFocus} />

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
          intensity={1.45}
          luminanceThreshold={0.87}
          luminanceSmoothing={0.11}
          mipmapBlur
          radius={0.62}
          levels={BLOOM_LEVELS}
        />
        {/*
          No Outline pass.

          It traced the hovered tent's screen-space edge and blurred it into a
          halo, which is the best-looking version of "this one is selected" — and
          it cost a depth pre-pass, a mask render and a two-stage blur *every
          frame*, whether or not anything was hovered. That is a permanent price
          for an effect that is on screen for a second at a time.

          The Fresnel rim in glow.ts does the job instead. It could not carry it
          alone before, because a tent is flat panels squarely facing the camera
          and the only fragments with any rim to speak of are a few pixels of
          silhouette — so the rim now drives well past the bloom threshold and
          the bloom pass above throws the halo off it. Same tube of light, no
          extra passes.
        */}
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
        <HueSaturation hue={0} saturation={0.30} />
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
        <BrightnessContrast brightness={-0.02} contrast={0.105} />
        <SplitTone />
        {/* Light. The corners of the reference are dark because its *sky* is
            dark there, not because a lens is closing them down — and at 0.32 /
            0.40 this pass was taking two thirds of the value off the moon,
            which sits four tenths of the way to a corner. The scene lighting
            owns the falloff now; this only stops the frame's edges competing
            with the fire. */}
        <Vignette offset={0.50} darkness={0.26} />
      </EffectComposer>
      )}
    </>
  )
}

/**
 * Pixels the renderer is allowed to draw, before the performance monitor gets
 * a say. Roughly a 1080p frame.
 */
const PIXEL_BUDGET = 2_100_000
/**
 * **Never below one CSS pixel per rendered pixel.**
 *
 * This used to be 0.62, and the floor is the whole story: `dpr={[1, dprCap]}`
 * reads as a range but R3F resolves it as
 * `min(max(dpr[0], devicePixelRatio), dpr[1])` — the *cap* is the last word, so
 * a `dprCap` under 1 renders under native however high the first element is.
 * On any window past about 2.1 megapixels `pixelBudgetDpr` returned exactly
 * that, and the scene opened upscaled from a smaller buffer: soft treeline,
 * mushy grass, unreadable journal type. The `PerformanceMonitor` below then
 * walked it back up in 0.15 steps, so it sharpened several seconds in — or
 * never, once `flipflops` pinned it.
 *
 * Below-native is not a lever this scene is allowed to pull. The monitor still
 * has room to move between 1 and `DPR_MAX` on a high-density display, which is
 * where the pixels that actually cost something are.
 */
const DPR_MIN = 1
const DPR_MAX = 1.6

function pixelBudgetDpr() {
  if (typeof window === 'undefined') return 1
  const area = Math.max(1, window.innerWidth * window.innerHeight)
  const device = window.devicePixelRatio || 1
  // Never *above* the display's own ratio — supersampling nobody asked for —
  // and never above the budget. The budget can pull a 2x display down to 1.2;
  // it can no longer pull anything below native.
  return THREE.MathUtils.clamp(Math.min(device, Math.sqrt(PIXEL_BUDGET / area)), DPR_MIN, DPR_MAX)
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
  const { progress } = useProgress()
  /*
    Through a ref, and the dependency list is `[progress]` alone.

    With `onProgress` in the list this was an infinite update loop, and a real
    one — React was throwing "Maximum update depth exceeded" during load,
    intermittently, on maybe one run in three. The cycle: drei's `useProgress`
    store ticks, the effect fires, the callback sets state on the page above,
    that render hands down a *new* `onProgress` closure, the changed dependency
    fires the effect again, which sets state again. Nothing in it is throttled
    except React's own counter.

    It only started showing up once the aurora rewrite took the frame from 8ms
    to 6ms and the load got quicker — which is the usual way a latent
    render-loop surfaces, and the reason it is fixed here rather than in
    whichever caller happens to memoise its callback today.
  */
  const cb = useRef(onProgress)
  cb.current = onProgress
  useEffect(() => {
    cb.current?.(progress / 100)
  }, [progress])
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
function Warmup({ onReady }: { onReady?: () => void }) {
  const { gl, scene, camera } = useThree()

  useEffect(() => {
    let cancelled = false
    const timers: number[] = []

    const uploadTextures = () => {
      const seen = new Set<THREE.Texture>()
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
              gl.initTexture(tex)
            }
          }
        }
      })
      return seen.size
    }

    /*
      Then draw the whole thing once, with everything shown.

      `compile` is not enough on its own, and the gap is a specific one: it
      prepares the *material* programs it finds by walking the scene, and it
      knows nothing about the shadow map. A caster's depth program is a separate
      shader, built by the shadow pass the first time that object is actually
      rendered into the map — so an object sitting hidden in the scene has had
      its lit shader compiled and its depth shader not. Measured on the tent
      click, that was the whole of the remaining stall.

      Two real frames with every hidden object temporarily shown, and a forced
      shadow update, covers everything `compile` misses: depth programs, the
      post chain's own passes, and any texture that only a draw call touches.
      Two rather than one because the first pass is what populates the shadow
      map that the second one reads.

      It is drawn to the canvas under a loading screen that is still opaque, so
      there is nothing to see.
    */
    const drawEverythingOnce = () => {
      const hidden: THREE.Object3D[] = []
      scene.traverse((o) => {
        if (!o.visible) {
          hidden.push(o)
          o.visible = true
        }
      })
      try {
        gl.shadowMap.needsUpdate = true
        gl.render(scene, camera)
        gl.shadowMap.needsUpdate = true
        gl.render(scene, camera)
      } finally {
        for (const o of hidden) o.visible = false
        gl.shadowMap.needsUpdate = true
      }
    }

    /*
      The same sweep again, later, into a scratch buffer nobody sees.

      One pass at load is not enough, and the reason is timing rather than
      coverage: a material's program is keyed on the *set of maps it has*, and
      several of this scene's materials do not have their full set yet when the
      pass above runs. The journal's canvases are painted in a layout effect,
      the bench's contact shadow is a texture that arrives on its own promise,
      and a map assigned to a material that has already been compiled without
      one invalidates its program. Measured on the click, seven programs were
      still being linked in that frame — five standard, one basic, one depth —
      and three.js checks `LINK_STATUS` before it can draw with any of them,
      which is a hard wait on the driver. That was 1.88 seconds of an 8-second
      profile, and all of it landed on the walk-in.

      Rendering into a 4x4 target rather than the canvas is what makes this
      safe to do late: every object is temporarily shown, so the interiors, the
      journal and the shelf all get their lit *and* their depth programs built,
      but the result goes to a buffer four pixels across that is thrown away.
      Nothing reaches the screen, and the frame it costs is one frame of vertex
      and draw-call work with essentially no fill.

      Twice, spread out, because "later" is not one moment: 1.5s catches the
      fonts and the layout effects, 5s catches anything on a slow connection.
    */
    const warmOffscreen = () => {
      if (cancelled) return
      const target = new THREE.WebGLRenderTarget(4, 4)
      const previous = gl.getRenderTarget()
      try {
        gl.setRenderTarget(target)
        uploadTextures()
        drawEverythingOnce()
      } finally {
        gl.setRenderTarget(previous)
        target.dispose()
        gl.shadowMap.needsUpdate = true
      }
    }

    const done = () => {
      if (cancelled) return
      const textures = uploadTextures()
      const before = gl.info.programs?.length ?? 0
      const shown = drawEverythingOnce()
      timers.push(window.setTimeout(warmOffscreen, 1500), window.setTimeout(warmOffscreen, 5000))
      if (import.meta.env.DEV) {
        ;(window as unknown as { __warm?: unknown }).__warm = {
          textures,
          shown,
          programsBefore: before,
          programsAfter: gl.info.programs?.length ?? 0,
          calls: gl.info.render.calls,
        }
      }
      onReady?.()
    }

    const compiler = gl as unknown as {
      compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<unknown>
    }
    if (typeof compiler.compileAsync === 'function') {
      compiler.compileAsync(scene, camera).then(done, done)
    } else {
      gl.compile(scene, camera)
      done()
    }
    return () => {
      cancelled = true
      for (const id of timers) window.clearTimeout(id)
    }
  }, [gl, scene, camera, onReady])

  return null
}

export default function CampHero({
  onFocus,
  entered,
  onEnter,
  onNavigate,
  onBookOpenRequest,
  onExit,
  onProgress,
  onReady,
}: {
  onFocus?: (i: TentIndex) => void
  entered: number | null
  onEnter: (i: TentIndex) => void
  onNavigate: (to: string) => void
  /** Fired the moment the reader clicks the closed journal open. */
  onBookOpenRequest?: () => void
  /** Fired when a journal is closed from its own last/first page rather than
      by Escape or the door button — see Book's boundary `go`. */
  onExit?: () => void
  /** 0-1 through the asset download. */
  onProgress?: (p: number) => void
  /** Fired once every shader is compiled and the scene is safe to reveal. */
  onReady?: () => void
}) {
  const prevEntered = useRef(entered)
  useEffect(() => {
    if (prevEntered.current === entered) return
    if (entered !== null) sfxEnter()
    else sfxExit()
    prevEntered.current = entered
  }, [entered])

  /**
   * Render scale, chosen from a pixel budget rather than from a device ratio.
   *
   * This scene is fill-bound: nearly every fragment on screen runs a full PBR
   * shader with a dozen lights, an alpha-cutout foliage pass on top of it, and
   * then a post chain over the whole frame. What that costs is a function of
   * *how many pixels there are*, and a device pixel ratio says nothing about
   * that — 1.75 on a 1280x720 laptop panel is 2.8 megapixels, and the same
   * 1.75 on a 4K desktop is 25. The old cap was the second case, which is how
   * a scene that measures fine on a small window ends up at single-figure
   * frame rates on a large one.
   *
   * So: pick the ratio that lands on a pixel count instead. The monitor below
   * still adjusts from there, so a fast machine climbs and a slow one drops,
   * but it starts from somewhere sane on every display size rather than from
   * the top on all of them.
   */
  const [dprCap, setDprCap] = useState(pixelBudgetDpr)

  return (
    <>
    <LoadTracker onProgress={onProgress} />
    <Canvas
      className="hero__canvas"
      // PCF with a radius, not the default PCFSoft.
      //
      // PCFSoft's kernel is fixed — it ignores `shadow.radius` — so the one
      // shadow edge that matters, the shaft of moonlight coming through the
      // doorway and falling across the open journal, arrived as a hard
      // staircase however the map was sized or the frustum tightened. A
      // widened PCF kernel is both cheaper and, at this scale, far softer.
      shadows="percentage"
      dpr={[1, dprCap]}
      /*
        Multisampled and alpha-backed, deliberately kept that way.

        Neither of these should do anything: the `EffectComposer` below owns the
        render loop, the scene lands in its own half-float target, and the only
        thing ever written to the drawing buffer is one full-screen triangle
        carrying the finished frame. Multisampling a full-screen triangle has no
        interior edges to resolve, and nothing shows through an alpha channel
        here because the sky sphere covers every pixel — so turning both off is
        a saved buffer and a saved resolve blit for no visible cost, and the
        screenshot diff agrees to the bit on every pose the site can reach.

        They stay on all the same. `?post=0` — the dev freeze that pulls the
        composer out to look at the raw scene — *does* draw straight into this
        buffer, and there the multisampling is the only antialiasing in the
        pipeline. This is a scene whose whole subject is silhouettes: alpha-cut
        foliage against a night sky. Holding the safety margin on the two flags
        that decide how those edges resolve is worth more than the buffer.

        See OPTIMIZATION.md §3 for what it costs.
      */
      gl={{ antialias: true, powerPreference: 'high-performance' }}
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
        if (import.meta.env.DEV) {
          ;(window as unknown as { __camp?: unknown }).__camp = state
        }
      }}
    >
      {/* `flipflops` stops the monitor oscillating: after three reversals it
          settles on whatever it last had rather than hunting for ever, which
          on a borderline machine is worse than either resolution.

          It is mounted only where it can do something. R3F resolves
          `dpr={[1, cap]}` as `min(max(1, devicePixelRatio), cap)`, so on an
          ordinary 1x display the cap is inert — every incline is a React state
          write, a re-render of the whole canvas tree and no change to a single
          pixel. That churn is not free and it is not harmless: with the aurora
          march gone the scene runs at 150fps, the monitor inclines on nearly
          every sample, and the resulting update storm was tripping React's
          "Maximum update depth exceeded" during load. */}
      {typeof window !== 'undefined' && window.devicePixelRatio > DPR_MIN ? (
      <PerformanceMonitor
        /* Lower bar than 50-60. Holding out for 60 on a scene like this means a
           machine that can comfortably do 45 keeps being told it is failing,
           and the monitor walks the resolution down past the point where the
           frame rate was ever the problem. */
        bounds={() => [38, 55]}
        flipflops={3}
        onIncline={() => setDprCap((d) => Math.min(DPR_MAX, d + 0.15))}
        onDecline={() => setDprCap((d) => Math.max(DPR_MIN, d - 0.15))}
        onFallback={() => setDprCap(DPR_MIN)}
      />
      ) : null}
      <Suspense fallback={null}>
        <Scene
          onFocus={onFocus ?? (() => {})}
          entered={entered}
          onEnter={onEnter}
          onNavigate={onNavigate}
          onBookOpenRequest={onBookOpenRequest}
          onExit={onExit}
        />
        {/* Inside the Suspense boundary, so it runs once the kit and the
            textures are actually here and there is something to compile. */}
        <Warmup onReady={onReady} />
      </Suspense>
    </Canvas>
    </>
  )
}
