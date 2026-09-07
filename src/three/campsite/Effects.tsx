import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Part } from './useKit'
import {
  fireFlicker,
  fireTemp,
  makeFlameMaterial,
  makeSmokeLineMaterial,
  makeTorchSmokeMaterial,
} from './fire'
import { AURORA_BOUNCE_HIGH, AURORA_BOUNCE_LOW, AURORA_BOUNCE_MID, applyWind } from './wind'

/* -------------------------------------------------------------------------- */
/*  Warm-light values, grouped so the whole camp can be re-balanced from one     */
/*  place. Everything cool lives in NIGHT in CampHero.tsx.                       */
/* -------------------------------------------------------------------------- */

export const FIRELIGHT = {
  /**
   * The flame itself. Short reach on purpose: at 30 units it poured through
   * every doorway and painted a flickering door-shaped patch on the inside of
   * the tents.
   */
  /**
   * One light, not two.
   *
   * There used to be a bright short-reach key and a dim far-reaching pool, so
   * that the flame's own falloff and the wash across the clearing could be
   * tuned apart. In a forward renderer that separation costs a whole extra
   * light evaluated on every fragment of every lit surface in the scene, and
   * the two curves it was buying differ by less than the flicker does. The
   * reach is the pool's and the near falloff is close enough to the key's that
   * nothing in the clearing moved by a visible amount.
   */
  // LIGHTING-REWORK (2026-08-17): intensity 26->34, distance 12->9.5.
  // imagestats radial-falloff sampling (item c) against the new target
  // reference showed the core under-bright (cur 87.7 vs ref 124.1 measured
  // luminance at r=0.03) while the mid/far field was *over*-reaching (cur
  // brighter than ref past r=0.32) — a hotter, shorter-cutoff key moves both
  // at once. See LIGHTING_TUNING.md.
  // LIGHTING-REWORK (2026-08-17, revised): distance 9.5->11. First pass at
  // 9.5 fixed the far-field overshoot (item c, r=0.32/0.45) but collapsed the
  // mid-field too (r=0.08/0.14 undershot ref by ~45-55) — the target's hot
  // zone is wider through the middle, only dropping steeply further out than
  // 9.5 units covers. Splitting the difference between the original 12 and
  // the first attempt.
  // LIGHTING-REWORK (2026-08-17): baked from ?debug at the user's request —
  // intensity 34->80, distance 11->30.
  key: { intensity: 34, distance: 14, color: '#ffc58f' },
  /** Cool and hot ends of the flame's colour swing. */
  coolEnd: /* @__PURE__ */ new THREE.Color('#ff8a3d'),
  hotEnd: /* @__PURE__ */ new THREE.Color('#ffd08a'),
  /**
   * Dynamic shadows from the fire. **Off.**
   *
   * A point light's shadow is a cube map: six depth passes every time it is
   * rendered, and — worse — a *twenty-tap* cube lookup in the fragment shader
   * of every lit material in the scene, whether or not that fragment is
   * anywhere near the fire. It bought one thing, benches casting outward onto
   * the grass, and the grass does not receive shadows anyway. The painted
   * contact patches under each bench were already doing the work.
   *
   * Left here rather than deleted: if the scene ever gets a performance budget
   * again this is the first thing worth spending it on.
   */
  shadow: { enabled: false, mapSize: 512, bias: -0.006, normalBias: 0.06 },
  /** Torch flames: smaller radius, lower intensity, same colour family. */
  torch: { intensity: 16, reach: 8.2 },
} as const

/* -------------------------------------------------------------------------- */
/*  Everything in the campsite that is code rather than geometry: the aurora     */
/*  sky, the stars, the fire, embers and smoke, the drifting leaves, the         */
/*  glowing orbs, and the billboard treeline behind the real trees.             */
/* -------------------------------------------------------------------------- */

/** Deterministic PRNG so the scatter is identical on every load. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * Soft radial sprite used for sparks and the fire's ground glow. Generated
 * rather than shipped — it is a gradient, and a gradient is code.
 */
export function makeGlowTexture(inner = 'rgba(255,236,180,1)', mid = 'rgba(255,176,60,0.55)') {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, inner)
  g.addColorStop(0.25, mid)
  g.addColorStop(0.55, 'rgba(255,150,40,0.16)')
  g.addColorStop(1, 'rgba(255,140,30,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// LIGHTING-REWORK (2026-08-17, item e): one shared texture for all 6 torch
// ground pools, built lazily on first use rather than per-instance — six
// canvases for the same gradient would be six textures doing one job.
let torchGlowTex: THREE.CanvasTexture | null = null
function getTorchGlowTex() {
  if (!torchGlowTex) torchGlowTex = makeGlowTexture('rgba(255,214,150,0.9)', 'rgba(255,140,40,0.55)')
  return torchGlowTex
}

/* ------------------------------------------------------------- instancing */


/**
 * Draws one part list many times. A glTF mesh with several primitives (trunk +
 * leaves) becomes one InstancedMesh per primitive, all sharing the same matrix
 * list, so a tree stays a single tree.
 */
/**
 * Slack added to an instanced scatter's bounding sphere before it is culled.
 *
 * The wind patch in wind.ts displaces vertices in the vertex shader, which the
 * bounding sphere three computes from the instance matrices knows nothing
 * about. Sixteen centimetres is the largest amplitude any foliage here uses;
 * half a metre is that with room to spare, and on a sphere tens of metres
 * across it costs nothing.
 */
const CULL_MARGIN = 0.5

export function InstancedParts({
  parts,
  matrices,
  colors,
  tintFrom = 0,
  castShadow = false,
  receiveShadow = false,
}: {
  parts: Part[]
  matrices: THREE.Matrix4[]
  /** Optional per-instance tint, multiplied into diffuse. */
  colors?: THREE.Color[]
  /** First primitive the tint applies to — trees keep slot 0 (bark) neutral. */
  tintFrom?: number
  castShadow?: boolean
  receiveShadow?: boolean
}) {
  const refs = useRef<(THREE.InstancedMesh | null)[]>([])

  useLayoutEffect(() => {
    refs.current.forEach((mesh, slot) => {
      if (!mesh) return
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
      mesh.instanceMatrix.needsUpdate = true
      if (colors && slot >= tintFrom) {
        colors.forEach((c, i) => mesh.setColorAt(i, c))
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      }
      mesh.computeBoundingSphere()
      if (mesh.boundingSphere) mesh.boundingSphere.radius += CULL_MARGIN
    })
  }, [matrices, parts, colors, tintFrom])

  return (
    <>
      {parts.map((p, i) => (
        <instancedMesh
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          args={[p.geometry, p.material, Math.max(1, matrices.length)]}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
          /*
            Culled, now that the sphere above is a real one.

            This was off, which from the clearing costs nothing — every scatter
            in the scene is in shot from there. It costs a great deal from
            inside a tent: the camera is forty centimetres from an open book
            with a canvas wall behind it, and the whole forest, the whole field
            and every stone in the camp were still being submitted, transformed
            and rasterised behind that wall. The reading pose is where a reader
            spends most of their time.
          */
        />
      ))}
    </>
  )
}
/**
 * Roughly where the lens sits while the reader is looking at the camp.
 *
 * Only used to order instances; it does not have to track the camera, and it
 * deliberately does not — see `buildMatrices`.
 */
const LOBBY_EYE = /* @__PURE__ */ new THREE.Vector3(0, 2.15, 13)

/**
 * Builds a matrix list from position/rotation/scale tuples, **nearest first**.
 *
 * An InstancedMesh draws its instances in buffer order, and these lists were in
 * the order the scatter happened to sow them, which for a field seeded by polar
 * coordinates is a random walk back and forth through the depth of the scene.
 * That matters because foliage here is alpha cutout: the fragment shader
 * discards, so the hardware cannot write depth early, but it *can* still reject
 * early against depth already in the buffer — and a blade drawn after the blade
 * standing in front of it is rejected before it shades, while the same pair in
 * the other order shades twice. Over five thousand clumps several layers deep
 * across the bottom of the frame, that is most of the field's overdraw.
 *
 * Sorted once, against a fixed point rather than the live camera: the ordering
 * only has to be approximately right to pay off, re-sorting per frame would cost
 * more than it saves, and the image is identical either way — alpha cutout with
 * depth writes is order-independent, so this changes only what the GPU can skip.
 *
 * @param aligned  a parallel array — per-instance tints, typically — reordered
 *                 **in place** to match. Anything indexed by instance has to go
 *                 through here or it ends up on the wrong tree.
 */
export function buildMatrices<T>(
  items: { pos: [number, number, number]; rotY?: number; scale?: number; tiltX?: number }[],
  aligned?: T[]
) {
  const dummy = new THREE.Object3D()
  const near = (it: (typeof items)[number]) => {
    const dx = it.pos[0] - LOBBY_EYE.x
    const dy = it.pos[1] - LOBBY_EYE.y
    const dz = it.pos[2] - LOBBY_EYE.z
    return dx * dx + dy * dy + dz * dz
  }
  const order = items.map((it, i) => ({ it, i, d: near(it) })).sort((a, b) => a.d - b.d)

  if (aligned) {
    const reordered = order.map(({ i }) => aligned[i])
    for (let i = 0; i < reordered.length; i++) aligned[i] = reordered[i]
  }

  return order.map(({ it }) => {
    dummy.position.set(...it.pos)
    dummy.rotation.set(it.tiltX ?? 0, it.rotY ?? 0, 0)
    dummy.scale.setScalar(it.scale ?? 1)
    dummy.updateMatrix()
    return dummy.matrix.clone()
  })
}

/* --------------------------------------------------------------------- sky */

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * Direction the moon is painted in.
 *
 * Low and to the left — about 16 degrees up, 15 degrees off the view axis —
 * which is where it has to sit to be inside a 42-degree lens at all. At the 30
 * degrees it started at, it was a beautifully rendered disc half a screen above
 * the top of the frame.
 *
 * The bearing and elevation are not eyeballed. Thresholding the reference frame
 * for its disc puts the centre at (0.337, 0.092) of the frame; the same
 * measurement on a render is what the vector is solved back from, through the
 * lens's own tangent scale (1334 px per radian at 2048x1024 and a 42-degree
 * vertical field). Sixty milliradians of bearing is 77 pixels here, which is
 * the whole difference between the moon sitting behind the tall pine and
 * sitting clear of it.
 *
 * The bearing was 46 milliradians further left until recently, which put the
 * disc at 0.311 of the width — clear of the pine, in open sky, with nothing
 * in front of it. That is what made it read as detached: a body with no
 * geometry crossing it has no depth cue and sits on the frame rather than in
 * it. It is now at 0.345, where the crown of the left-centre pine takes a
 * bite out of its lower right. Nothing masks it; the tree is simply nearer
 * and the depth test does the rest.
 */
export const MOON_DIR = /* @__PURE__ */ new THREE.Vector3(-0.2133, 0.225, -0.9361).normalize()

/**
 * Direction the key light comes *from*: the same bearing as the moon, but
 * lifted.
 *
 * These are deliberately not the same vector. A light at the moon's real
 * elevation strikes the ground at fifteen degrees, so the clearing receives a
 * quarter of it and the camp goes black; lifting the light keeps the ground lit
 * while the shadows still fall away from the moon's side of the sky, which is
 * the only part of the relationship an eye actually checks.
 *
 * The *bearing* now agrees with the painted disc, though, which it did not
 * before: the light used to come from well round to the left of where the moon
 * is drawn, so the rim on every tent roof pointed somewhere the sky said there
 * was nothing. Only the elevation is a lie now.
 */
export const MOON_LIGHT = /* @__PURE__ */ new THREE.Vector3(-0.32, 0.72, -0.62).normalize()

/** Angular radius of the painted disc, in radians. About three real moons. */
const MOON_RADIUS = 0.0258

/**
 * Night gradient, a milky-way band, the moon, and the aurora.
 *
 * **The aurora is nimitz's march** (shadertoy XtGGRt, CC BY-NC-SA 3.0). Two
 * constructions failed here before it, and both failed on the noise rather than
 * on the geometry:
 *
 * - Twenty-six horizontal planes of *smooth* five-octave fbm, composited front
 *   to back. An integral of a smooth field is smoother still, so it produced
 *   cloud every time, and every knob on it — layer count, inter-layer blend,
 *   coverage gate — existed to fight that and none of them won.
 * - Five regionally-masked groups of the same smooth noise, with no integral at
 *   all. That bought clean dark sky between the groups and cost the display its
 *   depth: it sat in one plane, and the "filaments" were bars whose width came
 *   from the noise period rather than from anything physical.
 *
 * What the reference has that neither had is the *texture*. `triNoise2d` folds
 * a triangle wave through five rotated, mutually advecting octaves, giving a
 * field of creases — large band structure with non-smooth variation along it —
 * and a crease is the one thing that survives being summed along a ray. See
 * `aurora()`, and `AURORA_RAYS` for the single place this departs from the
 * reference: the sky band this lens sees is a third of the reference's, so the
 * sample plane is stretched across the view axis to keep the rays vertical.
 *
 * It is composited **before the moon**, deliberately. See the call site.
 */
const SKY_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 top;
  uniform vec3 mid;
  uniform vec3 horizon;
  uniform float uTime;
  uniform vec3 uMoonDir;
  uniform float uMoonRadius;
  uniform float uAurora;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  /* ------------------------------------------------------------ moon surface */

  /**
   * Colour of the lunar surface at a point on the disc, mp in units where the
   * limb is at radius 1.
   */
  vec3 moonSurface(vec2 mp, float limb) {
    // Marbling, not relief. No bowls, no rims, no fixed light direction — three
    // fbm layers at spread-out scales, soft-edged the whole way, which is what
    // a body this size actually reads as from the ground: cloudy continents of
    // tone, not individually legible craters.
    //
    // Large soft continents. Low frequency, wide smoothstep so the edges
    // between a mare and the highland around it blur rather than cut.
    float seaLarge = fbm(mp * 1.3 + 4.1);
    float seaMaskLarge = smoothstep(0.30, 0.68, seaLarge);

    // Mid-scale wisps inside and across those continents — the marbled look
    // itself. Centred so it can push a region either lighter or darker.
    float seaMid = fbm(mp * 3.0 + 11.3) - 0.5;

    // Fine regolith mottle, well under the marbling scale, just enough to keep
    // the highlands from reading as flat paint.
    float dust = fbm(mp * 7.0 + 19.0) - 0.5;

    // Highlands are anorthosite: near-white, faintly cool. The seas are basalt
    // and a real stop and a half down, and *warmer* grey rather than bluer,
    // which is the actual difference between the two rocks and what stops the
    // dark half reading as a blue stain.
    vec3 col = vec3(0.95, 0.965, 1.00);
    // Lighter and cooler than they were. The maria have to stay visible as
    // darker blue-grey regions — they are the whole of the face's structure —
    // but at 0.84 of a mix toward a mid grey they took a third of the disc
    // down to half value, which on a body that is meant to be self-luminous
    // reads as shadow, and shadow on a full moon reads as a rock.
    col = mix(col, vec3(0.52, 0.60, 0.76), seaMaskLarge * 1.0);
    col *= 1.0 + seaMid * 0.5;
    col *= 1.0 + dust * 0.2;

    /*
      Limb darkening, and only a trace of it.

      At 0.52 + 0.48 * limb the disc lost half its value by the edge, which on
      a body drawn eighty pixels across is a soft ball rather than a moon — and
      it is most of why the face read as a matte sphere lit from somewhere
      rather than as a self-luminous full moon. The reference's disc is within
      a couple of percent of the same value from the centre to the limb; what
      makes its edge read is that the sky stops, not that the rock fades.
    */
    col *= 0.86 + 0.14 * limb;

    /*
      Narrow pale-cyan rim just inside the limb.

      This is the cue that separates a lit sphere from a glowing one: a body
      that is emitting has its brightest ring at the edge, where the line of
      sight grazes the most of it. Two percent of the radius wide, so it reads
      as an edge and not as a ring.
    */
    float r = sqrt(max(0.0, 1.0 - limb * limb));
    col += vec3(0.05, 0.15, 0.22) * smoothstep(0.80, 0.995, r);
    return col;
  }

  /* --------------------------------------------------- aurora curtains */

  /*
    Auroras by nimitz 2017 (@stormoid), shadertoy XtGGRt.
    Licensed CC BY-NC-SA 3.0. tri/tri2/triNoise2d and the march in aurora() are
    his; the ray anisotropy, the band envelope and the gain are this scene's.
  */

  mat2 mm2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
  mat2 m2 = mat2(0.95534, 0.29552, -0.29552, 0.95534);

  /**
   * Folded triangle wave, floored and ceilinged.
   *
   * The clamp is not decoration. tri() is the whole reason this field has
   * *trails* in it rather than blobs: |fract(x) - 0.5| has a crease at every
   * integer, and a crease survives being summed along a ray where a smooth
   * lobe does not. That is the difference between this and the five-octave
   * value-noise fbm above it, and it is why every previous attempt at this sky
   * — twenty-six planes of smooth fbm, then five masked groups of it — came
   * out as cloud. The tips are clipped at 0.01 and 0.49 so the derivative
   * stays finite at the fold and the creases cannot alias into stair-steps
   * once the octaves start rotating past each other.
   */
  float tri(float x) { return clamp(abs(fract(x) - 0.5), 0.01, 0.49); }
  vec2 tri2(vec2 p) {
    float tx = tri(p.x);
    float ty = tri(p.y);
    return vec2(tx + ty, tri(p.y + tx));
  }

  /**
   * The aurora texture: five octaves of triangle-wave turbulence, each one
   * *advecting* the next rather than merely adding to it.
   *
   * Each octave displaces the sample point by a rotating offset taken from a
   * coarser copy of the field, and that rotation is the only place time enters
   * — so the structure flows and shears along its own bands instead of
   * scrolling past the camera like a texture on a belt, which is what every
   * animated-noise aurora looks like. Feeding the accumulated value back into
   * the frequency (the 1.21 + (rz - 1) * 0.02 term) is what gives the bright
   * regions their finer grain.
   *
   * The reciprocal power at the end inverts the field: the turbulence sum is
   * near zero along the creases, so 1/rz^1.3 is *large* exactly there and
   * small everywhere else. That is the trail. The 0.55 ceiling caps how opaque
   * any one sample can be, which matters because forty are about to be summed.
   */
  float triNoise2d(vec2 p, mat2 timeRotation) {
    float z = 1.8;
    float z2 = 2.5;
    float rz = 0.0;
    p *= mm2(p.x * 0.06);
    vec2 bp = p;
    for (int i = 0; i < 5; i++) {
      vec2 dg = tri2(bp * 1.85) * 0.75;
      dg *= timeRotation;
      p -= dg / z2;

      bp *= 1.3;
      z2 *= 0.45;
      z *= 0.42;
      p *= 1.21 + (rz - 1.0) * 0.02;

      rz += tri(p.x + tri(p.y)) * z;
      p *= -m2;
    }
    return clamp(1.0 / pow(rz * 29.0, 1.3), 0.0, 0.55);
  }

  /**
   * The display: a volume integral up through the aurora band.
   *
   * The ray is world space, not screen space — the camera turns as it walks
   * into a tent and the sky must not turn with it — and the origin is world
   * zero, so the field is nailed to the world and parallaxes correctly.
   *
   * **The stride grows polynomially.** pow(i, 1.4) * 0.002 is why forty steps
   * cover the band: the trails live low, so samples are dense there and spread
   * out through the faint tops where a uniform stride would only buy banding.
   * exp2(-i * 0.065) is the matching extinction, and avgCol blends each sample
   * into a running average before it is added — a one-tap blur along the ray
   * that costs nothing and removes the banding the growing stride would leave.
   * The hashed per-pixel offset turns whatever survives into film grain, and it
   * ramps in over fifteen steps so the crisp low trails stay crisp.
   *
   * Forty steps rather than the reference's fifty: the last ten are attenuated
   * to under three percent and land above the top of this frame.
   *
   * **The sample plane is anisotropic, and that is what makes the rays.** See
   * AURORA_RAYS below — it is the one part of this that is not the reference's.
   */
  vec4 aurora(vec3 rd) {
    vec4 col = vec4(0.0);
    vec4 avgCol = vec4(0.0);
    float t = uTime;
    // These values are invariant across all forty samples. In particular,
    // evaluating mm2 here avoids forty identical pairs of sin/cos calls while
    // preserving the five-octave noise loop exactly.
    mat2 timeRotation = mm2(t * 0.22);
    float invRayDenom = 1.0 / (rd.y * 2.0 + 0.4);
    vec2 rayPlaneStep = rd.zx * vec2(1.15, 3.4);
    float auroraDrift = t * 0.035;

    /*
      AURORA_HUE: the colour ramp is advanced by bearing as well as by altitude.

      The reference's ramp is driven by i alone, which is altitude, and on its
      own framing that is enough — it looks up through the whole display, so the
      violet high end is in shot and well lit. Here the top of the ramp is both
      attenuated by the extinction and clipped by the band envelope, so a raw
      port renders green and cyan and nothing else: no violet anywhere, on a sky
      whose target frame is violet at both edges and turquoise through the
      middle.

      Advancing the phase toward the edges of the display puts that back. It is
      the one liberty taken with the reference's colour, and it is not an
      invented one — the previous version of this shader placed five hand-tuned
      curtain colours by bearing off the same target frame, from blue-violet on
      the left through turquoise at 0.62 of the width to violet-magenta at 0.80.
      This is that measurement, expressed as a phase rather than as five
      literals.
    */
    float bearing = atan(rd.z, rd.x) + 1.5707963;
    float hueBias = 1.15 * smoothstep(0.16, 0.62, abs(bearing));
    // This hash depends only on the output pixel, not on the ray-march step.
    // Compute it once instead of up to forty times per sky fragment.
    float pixelOffset = 0.006 * hash(gl_FragCoord.xy);
    for (int i = 0; i < 40; i++) {
      float fi = float(i);
      float of = pixelOffset * smoothstep(0.0, 15.0, fi);
      // Ray-plane intersection with the shell at this altitude. The 0.4 in the
      // denominator keeps it finite as rd.y goes to zero — without it a ray
      // along the horizon marches to infinity and the field degenerates into a
      // smear.
      float pt = (0.8 + pow(fi, 1.4) * 0.002) * invRayDenom;
      pt -= of;

      /*
        AURORA_RAYS: the field is sampled far finer across the view axis than
        along it, and without that this lens cannot produce rays.

        Walking i from 0 to 39 sweeps the sample point radially outward from
        the camera; scanning *up* the screen shortens pt and walks it back in.
        So screen-vertical maps to the radial axis of this plane and
        screen-horizontal maps to the tangential one. A ray on screen is a
        feature that is long radially and narrow tangentially — and triNoise2d
        is isotropic, so sampled square it gives features of equal extent in
        both, which is a blob field. That is exactly what the first attempt at
        this rendered: a soft green wash with no verticals in it anywhere.

        The camera looks down -Z, so bpos.zx is very nearly (radial, tangential)
        and the two axes can simply be scaled apart. Three-to-one is where the
        trails start reading as the target frame's rays; much past four and they
        turn into the hard vertical bars the masked-group version had.
      */
      /*
        MOTION: the reference's own spd (0.06) only turns dg's rotation inside
        triNoise2d, which reshuffles fine trail detail but barely shifts the
        macro band positions — measured mean pixel diff across 5s of wall time
        was 0.55/255 in the sky region, i.e. frozen to the eye. Real aurora
        curtains visibly *drift* sideways, not just flicker in place, so a
        straight time-based translate is added to the sample point before the
        field is evaluated, and spd is raised so the internal turbulence itself
        reads as flowing rather than static. Slow enough that it still looks
        like atmosphere, not a scrolling texture.
      */
      vec2 p = pt * rayPlaneStep;
      p.x += auroraDrift;
      float rzt = triNoise2d(p, timeRotation);

      vec4 col2 = vec4(0.0, 0.0, 0.0, rzt);
      // Hue by altitude, out of three phase-shifted sines. Green low through
      // cyan to violet high is the real emission sequence — oxygen low,
      // nitrogen high — and it falls out of this for free, because i *is*
      // altitude.
      col2.rgb = (sin(1.0 - vec3(2.15, -0.5, 1.2) + fi * 0.043 + hueBias) * 0.5 + 0.5) * rzt;
      avgCol = mix(avgCol, col2, 0.5);
      col += avgCol * exp2(-fi * 0.065 - 2.5) * smoothstep(0.0, 5.0, fi);
    }

    col *= clamp(rd.y * 15.0 + 0.4, 0.0, 1.0);
    return col * 1.8;
  }


  void main() {
    vec3 dir = normalize(vWorld);
    float h = dir.y;
    float az = atan(dir.z, dir.x);

    /*
      Three bands, and the edges are where the reference's are.

      Scanning the target frame down a column of clean sky gives roughly
      rgb(1,18,35) at the top of the frame, rgb(0,45,95) a twentieth of the way
      down and rgb(3,80,145) at an eighth — so nearly all of the gradient is
      spent between elevations of 0.34 and 0.25 in sine, which is the band the
      curtains stand in. The old edges (0.04 to 0.80, and a horizon term that
      was gone by 0.24) spread the same range over the whole dome and left the
      part the eye is actually reading almost flat.
    */
    vec3 c = mix(mid, top, smoothstep(0.26, 0.46, h));
    c = mix(horizon, c, smoothstep(0.02, 0.28, h));
    // Cold airglow lying on the treeline: a faint blue lift in the last few
    // degrees above the horizon, which is what keeps the wood reading as a
    // silhouette against something rather than as black on black.
    //
    // Almost no red in it. Every sample taken off the reference sky has a red
    // channel between 0 and 6 out of 255 — the whole of that sky is made of
    // green and blue — and a few percent of red spread over the upper half of
    // the frame is exactly what "washed out" looks like.
    c += vec3(0.008, 0.052, 0.132) * exp(-abs(h - 0.015) * 10.0);
    // And a trace of the fire in the haze directly over the camp. Small: any
    // real warmth in the sky reads as dusk, and this is meant to be midnight.
    c += vec3(0.014, 0.005, 0.002) * exp(-abs(h - 0.005) * 20.0);

    /* ---------------------------------------------------------- milky way */
    // Same gate as the moon, for the same reason: two more fbms that are
    // multiplied by zero over most of the sky.
    vec3 bandAxis = normalize(vec3(0.55, 0.62, -0.56));
    float band = 1.0 - abs(dot(dir, bandAxis));
    float bandMask = smoothstep(0.72, 1.0, band);
    if (bandMask > 0.001) {
      vec2 gal = vec2(az * 1.6, dir.y * 2.4);
      float dust = fbm(gal * 2.1);
      float lanes = fbm(gal * 4.3 + 11.0);
      float galaxy = bandMask * smoothstep(0.36, 0.86, dust) * (0.55 + 0.45 * lanes);
      // Barely there, and that is the point.
      //
      // This is the one term in the sky that is broad and structureless, which
      // makes it the one term that can only ever *lift* — and a lift across the
      // top of the frame is the difference between a night sky and a lit
      // ceiling. It is left in at a twentieth of a stop because a completely
      // even gradient behind the stars reads as a backdrop; anything the eye
      // can actually name as a band is too much.
      c += mix(vec3(0.02, 0.10, 0.30), vec3(0.08, 0.24, 0.58), lanes) * galaxy * 0.055;
    }

    /* ------------------------------------------------------------ aurora */
    /*
      Drawn before the moon, and that ordering is load-bearing.

      The disc is composited with mix(c, moonCol, disc), so with the aurora
      already in c every pixel at disc = 1 comes out as moonCol exactly,
      whatever the display is doing behind it — the face is bit-identical to a
      frame with the aurora switched off, and the halo lands on top of the
      curtains rather than under them. Composited *after* the moon instead, a
      full-sky march washes straight over the disc and turns it from ice into
      grey card. That is not a hypothetical: it is what the first version of
      this did, and it is the reason the moon changed when nothing in the moon
      code had.

      Physically the aurora is the nearer body — a hundred kilometres against
      four hundred thousand — so a display really does cross in front of the
      moon. It is not drawn that way here because the moon is the brightest
      thing in the frame and the whole sky is composed around it.
    */
    // Gated: forty evaluations of a five-octave folded field is by a wide
    // margin the most expensive thing in this shader, and below the horizon
    // there is nothing to draw. ?aurora=0 is how its share is measured.
    // Outside these exact smoothstep endpoints the envelope below is zero, so
    // skip the expensive field march without changing a single output pixel.
    if (h > 0.035 && h < 0.378 && uAurora > 0.001) {
      /*
        smoothstep, not a multiply.

        The sky writes display values — see AURORA_GAIN — so anything over 1.0
        is *clipped*, not rolled off, and a clipped aurora is a cyan-white core
        with its hue thrown away. The reference's own shoulder rolls the march
        off at 1.5, which puts the brightest trails just under the ceiling and
        leaves the faint ones on the toe where the colour still separates.
      */
      vec4 aur = smoothstep(0.0, 1.5, aurora(dir)) * uAurora;
      /*
        The same band envelope the masked-group version stood in, and it is
        kept for the same three reasons.

        On this lens the top of the frame is an elevation of 0.343 in sine and
        the treeline crest about 0.17. Holding the display off the crest keeps
        the wood reading as a silhouette against sky rather than against light;
        closing it before the top keeps the corners dark, which is where the
        stars and the milky way have to read; and together they keep the
        display clear of the moon, which sits near the top of the frame.

        A march that covers the whole dome is the reference's composition, not
        this one's.
      */
      aur *= smoothstep(0.035, 0.098, h) * (1.0 - smoothstep(0.300, 0.378, h));
      /*
        Keep-out around the moon, and it is not the same thing as the ordering
        above.

        Drawing the aurora first makes the *disc* exact — mix() at disc = 1
        returns moonCol whatever is behind it — but it does nothing for the sky
        the disc sits in, and it does nothing for the bloom pass, which samples
        a wide neighbourhood and carries any light standing next to the moon
        back onto it. Without this the surround goes from deep blue to teal and
        the moon reads as changed even though every crater on it is identical
        to the frame before.

        The target frame holds the same pocket: its display is violet and
        turquoise across the whole treeline and the moon sits in clean dark blue
        with nothing near it. Seven disc radii is that pocket, measured off it,
        and the ramp starts at three so the edge of the keep-out is never
        somewhere the eye can find.
      */
      float moonCos = dot(dir, uMoonDir);
      float moonU = sqrt(2.0 * max(1.0 - moonCos, 0.0)) / uMoonRadius;
      aur *= smoothstep(3.0, 7.0, moonU);
      // Over, not add. The display carries its own coverage in alpha; adding
      // it lifts the gradient straight through the bright trails, which is
      // what reads as a wash rather than as light.
      c = c * (1.0 - aur.a) + aur.rgb;
      // Airglow — a narrow, faint bleed under the feet of the display, tinted
      // from whatever is standing there. Without it the curtains float with
      // nothing lighting the air between them and the treeline.
      float bleed = smoothstep(0.30, 0.02, h) * aur.a * 0.030;
      c += mix(vec3(0.01, 0.14, 0.28), aur.rgb, 0.45) * bleed;
    }

    /* -------------------------------------------------------------- moon */
    // Drawn in the sky shader rather than as a billboard: at this distance a
    // quad would need its own depth handling against the star points, and the
    // disc is two smoothsteps here.
    float md = dot(dir, uMoonDir);
    float cosR = cos(uMoonRadius);
    /*
      One pixel of edge, taken from the screen-space derivative rather than
      from a constant.

      The old window was a hand-picked ±1e-4 in *cosine* space. Near the limb
      d(cos)/dθ is sin(R) ≈ 0.03, and a pixel of this lens is about 7e-4 rad, so
      that window was five pixels of ramp on a disc forty pixels across — an
      eighth of the radius spent fading out. No amount of surface detail was
      ever going to make a body with a five-pixel edge look like anything but a
      soft blob. fwidth() gives exactly one pixel at any resolution and any
      field of view; the clamp is only there so a seam in the sky sphere's
      tessellation cannot blow the edge open.
    */
    float aa = clamp(fwidth(md), 1e-6, 1e-4);
    float disc = smoothstep(cosR - aa, cosR + aa, md);
    // The surface is three passes over a 27-cell crater loop plus two fbms.
    // The disc is under a thousandth of the sky, so computing it for every sky
    // pixel — which is what a branch-free version does — is most of this
    // shader's cost spent on nothing. The branch is coherent across any warp
    // that is not straddling the limb.
    vec3 moonCol = vec3(0.0);
    if (disc > 0.0001) {
      // Screen-space basis on the moon's face, so the surface can be a 2D
      // field.
      vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 my = cross(uMoonDir, mx);
      vec2 mp = vec2(dot(dir, mx), dot(dir, my)) / sin(uMoonRadius);
      float limb = sqrt(max(0.0, 1.0 - min(dot(mp, mp), 1.0)));
      moonCol = moonSurface(mp, limb);
    }
    /*
      Halo: three stages, measured off the reference rather than guessed.

      Sampling the target frame along a line out from the limb gives the sky
      rising to rgb(5,96,169) at about 1.4 disc radii and falling to
      rgb(4,66,127) by 2.5, against a sky of rgb(0,45,88) — so the glow is
      *half again* the value of the sky it sits on two radii out, and it is
      made of green and blue with essentially no red. Fitting an exponential in
      (1 - cos theta) through those two points gives a decay of about 490, which is
      the wide stage below; the tight one fuses the limb into it so the disc
      stops reading as a sticker, and the very wide one is the humid bloom that
      gives that whole corner of the sky its blue.
    */
    float d1 = 1.0 - md;
    // Angular distance from the centre, in disc radii. Small-angle: 1 - cos t
    // is t*t/2 to well under a percent out to several radii here.
    float u = sqrt(2.0 * max(d1, 0.0)) / uMoonRadius;
    // The tight stage is small on purpose. It exists to fuse the limb into the
    // glow, and anything more than a trace of it eats the limb instead — a
    // bright ring pressed against the edge of the disc is what turned the moon
    // into a soft blob two passes ago. The reference's limb is *crisp*.
    /*
      Two stages, both written in disc radii rather than in cosine.

      Fitting the reference's own samples — rgb(17,143,215) at 1.2 radii,
      rgb(9,84,157) at 1.6 and rgb(4,62,123) at 2.5, against a sky of
      rgb(2,57,110) — gives a glow that halves about every disc radius and is
      within a few counts of the sky by 2.5. That is a decay of roughly 1.45
      per radius, which is the wide stage; the tight one is two thirds of a
      radius wide and only exists to fuse the limb into the glow so the disc
      does not read as a sticker.

      Written in cosine the same curve needed hand-picked constants in the
      thousands and had no relationship to the disc's size — changing the
      radius silently changed the halo's width in radii, which is why it had
      grown into a fog cloud two and a half diameters across.
    */
    float halo = exp(-(u - 1.0) * 1.45) * 0.50 + exp(-(u - 1.0) * 9.0) * 0.30;
    // Linear, so the sRGB hue the reference measures — roughly (8,160,255) —
    // is that triple raised to 2.2. Written straight it comes out a pale
    // sky-blue with far more green in it than the frame has.
    c += vec3(0.03, 0.42, 1.00) * halo;
    /*
      Icy, and over 1 only in the middle.

      The sky bypasses tone mapping — it is drawn in display values, not scene
      ones — so anything written above 1 here is *clipped*, not rolled off, and
      a moon clipped across its lit half is the "flat white circle" failure.
      The reference's disc averages rgb(176,234,253) over its bright half with
      a peak at 254: the blue channel is at the ceiling and the red is at two
      thirds, which is what makes it read as *ice* rather than as a grey rock.

      **The ceiling is 1.0 and it is hard.** Writing a flat vec3(1.0,0.5,0.25)
      into the disc and reading the frame back gave rgb(154,123,107); writing
      the surface times 1.5 and then times 2.6 gave rgb(156,151,159) both times,
      to the digit. So everything at or above 1 lands on the same value, and
      that value is about 155 rather than 255 — the moon is drawn under the CSS
      scrim that keeps the headline readable (the .hero--camp stage's ::after in
      global.css), which is roughly 40% opaque where the disc sits.

      Which means brightness cannot come from this multiply. Driving it up only
      flattens the face: at 1.5 every highland and every crater rim was over the
      top together and the disc rendered as one grey circle. These numbers put
      the highlands just under the ceiling and the maria at about a quarter of
      it, so the surface keeps its range — and the *glow* comes from the bloom
      pass, which is where a bright moon's brightness actually lives.

      The spread between the channels is far wider than the reference's own
      ratio for the same reason the ceiling exists: the response is compressive,
      so a written 0.84:1.04 came back as 0.92:1.00 — nearly neutral. Blue and
      green sit at the top where the bloom threshold can find them and red sits
      at half, which is what makes the disc read as ice rather than as stone.
    */
    /*
      Icy, and the ratio is what carries it — not the level.

      The level cannot carry it. Everything at or over 1.0 written here lands
      on the same displayed value, about 155, because the disc is drawn under
      the CSS scrim that keeps the headline readable (the .hero--camp stage's
      ::after in global.css, a little over half opaque where the disc sits).
      The previous multiply put all three channels at or above that ceiling, so
      the disc came back rgb(137,137,150) — three equal channels, which is grey
      by definition, and it is why a face full of crater detail rendered as a
      matte rock.

      So red is deliberately held at about a third while green sits just under
      the ceiling and blue goes over it. That is the reference's own ratio —
      its disc measures rgb(174,234,253), red at two thirds of blue — and it is
      what makes the same surface read as ice rather than as stone.
    */
    c = mix(c, moonCol * vec3(0.11, 0.96, 1.46), disc);

    gl_FragColor = vec4(c, 1.0);
  }
`

/**
 * Master gain on the aurora.
 *
 * It multiplies the march *after* its smoothstep shoulder, so it scales a value
 * already rolled into 0..1 — 1.0 is the reference's own weight, and above that
 * only the bright trails move, into the clip. `?aurora=0` turns the display off
 * and takes its cost with it, which is how its share of the frame is measured.
 *
 * There is a hard ceiling and it is worth knowing why: the sky writes display
 * values, not scene ones — `toneMapped={false}`, and the composer runs
 * NoToneMapping — so everything over 1.0 is clipped rather than rolled off. An
 * early cut of this ran at 4.5 with no shoulder at all and put the middle of
 * the display over the ceiling in all three channels, which is not a bright
 * aurora but a clipped one with its hue thrown away.
 */
const AURORA_GAIN = 1.0

function auroraGain() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return AURORA_GAIN
  const v = new URLSearchParams(window.location.search).get('aurora')
  return v === null || Number.isNaN(Number(v)) ? AURORA_GAIN : Number(v)
}

export function NightSky() {
  const uniforms = useMemo(
    () => ({
      // Deep navy the whole way up, and navy rather than violet at the
      // horizon: the old ramp put a lilac wash behind the treeline that read as
      // the last of a sunset, which flattened everything standing in front of
      // it. The aurora is the only saturated thing in the upper half of the
      // frame now, which is what lets it read as light rather than as a tint.
      //
      // Red pulled out of all three. The reference sky measures a red channel
      // of 0-6 out of 255 from the corners to the horizon; a gradient carrying
      // even five percent red greys every curtain drawn on top of it.
      top: { value: new THREE.Color('#001017') },
      mid: { value: new THREE.Color('#003444') },
      // A little lighter than the wood standing in front of it, on purpose: a
      // treeline is only readable if the thing behind it is brighter than it
      // is, and this is the band the whole silhouette is drawn against.
      horizon: { value: new THREE.Color('#0c7aa6') },
      uTime: { value: 0 },
      uMoonDir: { value: MOON_DIR.clone() },
      uMoonRadius: { value: MOON_RADIUS },
      /** See AURORA_GAIN. `?aurora=0` skips the curtains entirely. */
      uAurora: { value: auroraGain() },
    }),
    []
  )

  /**
   * Through the material, not through the memo above.
   *
   * `<shaderMaterial uniforms={…}>` does not hand three the object it is given
   * — the uniforms are deep-cloned on the way in, so the material ends up with
   * its own `{ value }` slot for every entry and a write to the memoised object
   * lands nowhere. That is why the aurora sat frozen for a long time: `uTime`
   * was being advanced on an object nothing was reading.
   */
  const mat = useRef<THREE.ShaderMaterial>(null)

  /**
   * The aurora's own clock, and the reason it is not `state.clock.elapsedTime`.
   *
   * **The curtains dissolve into flat bands as the clock grows.** The drift
   * (`p.x += t * 0.035` in `aurora()`) is a straight translation of the sample
   * point, so the coordinate handed to `triNoise2d` grows without bound — and
   * that field is built out of `fract()`, whose resolution is the float's ulp
   * at whatever magnitude it is given. At t = 0 the trails are crisp; by
   * t = 3600 (drift 126) they are visibly broadened; by t = 7200 (252) the sky
   * is a wash with horizontal striping in it, and by t = 36000 there is no
   * structure left at all. Reproduced by hand with `?skyt=<seconds>`, and
   * pinned to this term specifically: wrapping the drift alone at t = 36000
   * restores the curtains exactly, while wrapping the rotation inside
   * `triNoise2d` (the other place time enters) changes nothing.
   *
   * Two things follow, and neither touches the shader or any tuned constant:
   *
   * 1. **Frame delta, not wall time.** A backgrounded tab stops rendering, but
   *    `elapsedTime` keeps counting the wall clock it spent hidden — so
   *    alt-tabbing away for half an hour and coming back handed the shader a
   *    clock 1800s further on in a single step. That is the reported repro
   *    ("switching browser, waiting a while"). Accumulating clamped deltas
   *    means only time the sky was actually *on screen* counts, and one long
   *    stall is worth one frame.
   * 2. **A wrap, as a backstop.** 1800s of continuous watching is well inside
   *    the clean range (drift 63, indistinguishable from t = 0 in a side by
   *    side), and wrapping there costs one jump in the curtain positions at
   *    the half hour instead of a sky that degrades permanently.
   */
  const AURORA_WRAP = 1800
  const skyTime = useRef(0)
  /** Dev-only: `?skyt=<seconds>` starts the sky clock late. See above. */
  const SKY_T0 = useMemo(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return 0
    const v = Number(new URLSearchParams(window.location.search).get('skyt'))
    return Number.isFinite(v) ? v : 0
  }, [])
  /** Dev-only fixed sky clock for exact before/after shader screenshots. */
  const SKY_FREEZE = useMemo(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return null
    const raw = new URLSearchParams(window.location.search).get('skyfreeze')
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }, [])

  useFrame((_state, delta) => {
    const u = mat.current?.uniforms
    if (!u) return
    if (SKY_FREEZE === null) {
      skyTime.current = (skyTime.current + Math.min(delta, 0.1)) % AURORA_WRAP
    }
    u.uTime.value = SKY_FREEZE ?? skyTime.current + SKY_T0
  })

  return (
    /*
      Drawn last of the opaques, deliberately, with depth testing left on.

      The aurora march is the most expensive fragment shader in the scene by a
      wide margin, so the one thing that must be true of this sphere is that it
      never runs on a pixel the forest is standing in front of. Leaving it to
      three's own ordering does not guarantee that: `painterSortStable` compares
      `material.id` *before* it compares depth, so where a sky lands in the
      opaque queue is decided by when its material happened to be constructed —
      which here put it ahead of the ground plane. `renderOrder` is compared
      before both, so this pins it to the back of the queue and early-Z throws
      away every sky fragment with geometry in front of it. On the lobby framing
      that is about two thirds of the march, for free.

      Note this only sorts it against the other *opaques*; the transparent queue
      is drawn after all of them regardless, which is what the haze, the flames
      and the contact patches want.
    */
    <mesh scale={[-1, 1, 1]} renderOrder={100}>
      <sphereGeometry args={[180, 40, 26]} />
      <shaderMaterial
        ref={mat}
        vertexShader={SKY_VERT}
        fragmentShader={SKY_FRAG}
        uniforms={uniforms}
        depthWrite={false}
        side={THREE.BackSide}
        toneMapped={false}
        fog={false}
      />
    </mesh>
  )
}

const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vTwinkle;
  varying vec3 vColor;
  varying float vBright;

  void main() {
    vColor = aColor;
    // Each star breathes on its own phase and rate; a shared pulse reads as
    // the whole sky flickering. Shallower than before — a star that swings to
    // half brightness reads as a bad frame, not as scintillation.
    vTwinkle = 0.72 + 0.28 * sin(uTime * (0.6 + fract(aPhase) * 2.2) + aPhase * 8.0);
    // 0 for dust, 1 for the handful of anchors. Only the anchors get spikes.
    vBright = smoothstep(2.0, 5.0, aSize);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Explicit pixel ratio: gl_PointSize is in physical pixels, so without it
    // the whole sky changes weight between a 1x and a 2x display.
    //
    // Small. At the old scale the brightest stars drew a sixteen-pixel disc,
    // which with a soft falloff is not a star — it is a bokeh blob, and the sky
    // came out looking like a lens was out of focus. A star is one to nine
    // pixels; the *brightness* is what makes it read, not the diameter.
    gl_PointSize = aSize * (0.82 + vTwinkle * 0.34) * uPixelRatio * (190.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`

const STAR_FRAG = /* glsl */ `
  varying float vTwinkle;
  varying vec3 vColor;
  varying float vBright;

  void main() {
    // Hard little disc with a crisp edge, and diffraction spikes only on the
    // bright anchors. The previous version carried a wide halo under every
    // star so that the bloom pass had something to catch; with bloom pulled
    // back that halo is just a smudge, and "sharp" is the whole point.
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    // A disc with a two-pixel edge, not a gaussian. The gaussian is what turned
    // every star into a smudge; this holds an actual silhouette at the sizes
    // above and antialiases cleanly at the smallest ones.
    float core = 1.0 - smoothstep(0.17, 0.42, d);
    core = pow(core, 1.5);
    // Thin cross, tight to the axis, and only on the anchors.
    float spike =
      (smoothstep(0.5, 0.0, abs(p.x) * 11.0) + smoothstep(0.5, 0.0, abs(p.y) * 11.0)) *
      smoothstep(0.5, 0.0, d) * vBright * 0.34;
    float a = min(1.0, core * 1.9 + spike);
    if (a < 0.012) discard;
    // Well over 1 in the middle. These are additive over a sky that also
    // carries an aurora, and a star that only just reaches white disappears
    // the moment a curtain passes behind it.
    vec3 col = vColor * (1.05 + core * (0.55 + vBright * 1.05));
    gl_FragColor = vec4(col, a * vTwinkle);
  }
`

/** Same axis the milky-way band in the sky shader uses. */
const BAND_AXIS = /* @__PURE__ */ new THREE.Vector3(0.55, 0.62, -0.56).normalize()

export function Stars({ count = 6600 }: { count?: number }) {
  const { viewport } = useThree()
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uPixelRatio: { value: 1 } }), [])
  /** The material owns its own copy of the uniforms. See AURORA_SPIN. */
  const mat = useRef<THREE.ShaderMaterial>(null)

  useLayoutEffect(() => {
    if (mat.current) mat.current.uniforms.uPixelRatio.value = Math.min(viewport.dpr, 2)
  }, [viewport.dpr])

  const geo = useMemo(() => {
    const r = rng(7)
    const pos = new Float32Array(count * 3)
    const size = new Float32Array(count)
    const phase = new Float32Array(count)
    const color = new Float32Array(count * 3)

    // White and cyan carry the field; the warm and pink entries are one draw in
    // five between them, which is enough for the sky to have some variety
    // without any of it reading as a colour cast.
    const palette = [
      new THREE.Color('#ffffff'),
      new THREE.Color('#ffffff'),
      new THREE.Color('#eaf4ff'),
      new THREE.Color('#b9e4ff'),
      new THREE.Color('#9fd8ff'),
      new THREE.Color('#cbd8ff'),
      new THREE.Color('#ffe6f7'),
      new THREE.Color('#ffd2b0'),
    ]

    // Reused per star: the vector is normalised in place and scaled at the end.
    const dir = new THREE.Vector3()
    const perp = new THREE.Vector3()

    for (let i = 0; i < count; i++) {
      const theta = r() * Math.PI * 2
      const phi = Math.acos(0.05 + r() * 0.94)
      const rad = 150
      dir.set(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta))

      // A third of the field is pulled in toward the galactic band. An evenly
      // random sphere has no structure at all in it, and a sky with no
      // structure reads as a texture — the eye picks up the crowding along the
      // band long before it counts any individual star.
      if (r() < 0.34) {
        const along = dir.dot(BAND_AXIS)
        perp.copy(BAND_AXIS).multiplyScalar(along)
        // Pull the component *along* the axis toward zero, i.e. toward the
        // great circle perpendicular to it.
        dir.addScaledVector(perp, -(0.45 + r() * 0.45))
        dir.normalize()
        if (dir.y < 0.02) dir.y = 0.02 + r() * 0.06
        dir.normalize()
      }

      pos[i * 3] = rad * dir.x
      pos[i * 3 + 1] = rad * dir.y
      pos[i * 3 + 2] = rad * dir.z
      // Heavily skewed: a few bright anchors, mostly faint dust. The skew is
      // what lets the count go up without the sky turning into a grey wash —
      // most of the extra stars land near the bottom of this curve.
      // Sharper skew than before, and a slightly smaller ceiling: at 5200 the
      // extra stars have to land at the faint end or the sky turns milky, and
      // the anchors read better small and hot than large and soft.
      size[i] = 0.85 + Math.pow(r(), 3.1) * 3.6
      phase[i] = r() * 10
      const c = palette[(r() * palette.length) | 0]
      color[i * 3] = c.r
      color[i * 3 + 1] = c.g
      color[i * 3 + 2] = c.b
    }

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3))
    return g
  }, [count])

  useFrame((state) => {
    if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <points geometry={geo} renderOrder={-1}>
      <shaderMaterial
        ref={mat}
        vertexShader={STAR_VERT}
        fragmentShader={STAR_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        fog={false}
      />
    </points>
  )
}

/* --------------------------------------------------------------- fireflies */

function makeOrbVertexShader(exclusionCount: number) {
  const exclusionUniforms = Array.from(
    { length: exclusionCount },
    (_, i) => `
  uniform vec4 uExclusionFrame${i};
  uniform vec3 uExclusionBounds${i};`
  ).join('')

  // Keep the exclusion passes expanded and in declaration order. Apart from
  // avoiding dynamic uniform-array indexing on older WebGL 1 drivers, this is
  // the exact order of the former CPU loop: an orb pushed by one tent is fed
  // into the next tent's test rather than every test reading its original path.
  const exclusionPasses = Array.from(
    { length: exclusionCount },
    (_, i) => `
    if (orbPosition.y <= uExclusionBounds${i}.z) {
      vec2 delta${i} = orbPosition.xz - uExclusionFrame${i}.xy;
      vec2 localPosition${i} = vec2(
        uExclusionFrame${i}.z * delta${i}.x - uExclusionFrame${i}.w * delta${i}.y,
        uExclusionFrame${i}.w * delta${i}.x + uExclusionFrame${i}.z * delta${i}.y
      );
      float normalizedDistance${i} = length(localPosition${i} / uExclusionBounds${i}.xy);
      if (normalizedDistance${i} < 1.0) {
        localPosition${i} *= 1.08 / max(normalizedDistance${i}, 0.001);
        orbPosition.xz = uExclusionFrame${i}.xy + vec2(
          uExclusionFrame${i}.z * localPosition${i}.x + uExclusionFrame${i}.w * localPosition${i}.y,
          -uExclusionFrame${i}.w * localPosition${i}.x + uExclusionFrame${i}.z * localPosition${i}.y
        );
      }
    }`
  ).join('')

  return /* glsl */ `
  attribute vec3 aMotion;
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec2 uCenter;${exclusionUniforms}
  varying float vGlow;

  void main() {
    // position is immutable seed data: angle, radius and base height. Motion
    // contains speed, bob rate and trajectory phase. The equations below are
    // deliberately the former CPU equations in the same order.
    float angle = position.x + uTime * aMotion.x * 0.12;
    float wobble = sin(uTime * aMotion.x + aMotion.z);
    float radius = position.y + wobble * 0.9;
    vec3 orbPosition;
    orbPosition.x = cos(angle) * radius + uCenter.x;
    orbPosition.z = sin(angle) * radius + uCenter.y;
    orbPosition.y =
      position.z +
      sin(uTime * aMotion.y + aMotion.z) * 0.45 +
      max(0.0, orbPosition.z - uCenter.y - 8.0) * 0.4;
${exclusionPasses}

    // Each orb breathes on its own phase, and the dimmest moment never reaches
    // zero — an orb that blinks out entirely reads as a dropped frame.
    vGlow = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(uTime * (0.9 + fract(aPhase) * 1.6) + aPhase * 6.2), 1.6);
    vec4 mv = modelViewMatrix * vec4(orbPosition, 1.0);
    // Hard ceiling in CSS pixels, hence the uPixelRatio on both sides. 78 was
    // still letting an orb that drifted near the lens draw a 78px disc, which
    // bloomed into a headlight; a firefly is a point of light, so 30 is the
    // largest it should ever get regardless of how close it comes.
    gl_PointSize = min(
      aSize * (0.75 + vGlow * 0.5) * uPixelRatio * (300.0 / -mv.z),
      18.0 * uPixelRatio
    );
    gl_Position = projectionMatrix * mv;
  }
`
}

/**
 * The glowing orbs. Three stacked falloffs — a blown-out white core, a saturated
 * amber body and a wide soft halo. A single gaussian sprite is what made these
 * read as flat beads; the hard core is what feeds the bloom pass and turns them
 * into little lamps.
 */
const ORB_FRAG = /* glsl */ `
  varying float vGlow;
  uniform vec3 uCore;
  uniform vec3 uBody;
  uniform vec3 uHalo;

  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;

    float halo = pow(max(0.0, 1.0 - d), 2.2);
    float body = pow(max(0.0, 1.0 - d * 2.3), 2.0);
    float core = pow(max(0.0, 1.0 - d * 6.0), 1.4);

    vec3 col = uHalo * halo * 0.8 + uBody * body * 1.9 + uCore * core * 4.2;
    float a = clamp(halo * 0.55 + body * 1.1 + core * 1.8, 0.0, 1.0) * vGlow;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col * vGlow, a);
  }
`

export function Fireflies({
  count = 210,
  radius = 30,
  // Low. At eight metres the orbs at the back of the clearing rose above the
  // treeline and read as soft white discs in the *sky* — bokeh, next to actual
  // stars, which made both of them look like a lens artefact.
  height = 4.2,
  center = [0, 0] as [number, number],
  exclusions = [],
}: {
  count?: number
  radius?: number
  height?: number
  center?: [number, number]
  exclusions?: ReadonlyArray<{
    x: number
    z: number
    yaw: number
    halfWidth: number
    halfDepth: number
    maxY: number
  }>
}) {
  const { viewport } = useThree()

  const exclusionFrames = useMemo(
    () =>
      exclusions.map((exclusion) => ({
        ...exclusion,
        cos: Math.cos(exclusion.yaw),
        sin: Math.sin(exclusion.yaw),
      })),
    [exclusions]
  )

  const vertexShader = useMemo(
    () => makeOrbVertexShader(exclusionFrames.length),
    [exclusionFrames.length]
  )

  const uniforms = useMemo(
    () => {
      const values: Record<
        string,
        { value: number | THREE.Color | THREE.Vector2 | THREE.Vector3 | THREE.Vector4 }
      > = {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uCenter: { value: new THREE.Vector2(center[0], center[1]) },
        /*
          VISUAL-13.3 (2026-08-30): '#fffdf2' / '#ffc04a' / '#ff8a1e' ->
          '#eafff4' / '#8ff0b4' / '#2fbf8a'.

          These are the specks drifting across the whole frame, and painted in
          fire colours they read as embers — embers thirty metres from the fire,
          at uniform density, up over the tents and into the sky, where they
          clashed with the blue tent. Embers belong to the flame and are handled
          there. What this system is actually for is ambient movement, so it is
          now what it looks like: cool green fireflies, which sit against the
          aurora rather than competing with the fire.
        */
        uCore: { value: new THREE.Color('#eafff4') },
        uBody: { value: new THREE.Color('#8ff0b4') },
        uHalo: { value: new THREE.Color('#2fbf8a') },
      }

      for (let i = 0; i < exclusionFrames.length; i++) {
        const exclusion = exclusionFrames[i]
        values[`uExclusionFrame${i}`] = {
          value: new THREE.Vector4(exclusion.x, exclusion.z, exclusion.cos, exclusion.sin),
        }
        values[`uExclusionBounds${i}`] = {
          value: new THREE.Vector3(exclusion.halfWidth, exclusion.halfDepth, exclusion.maxY),
        }
      }
      return values
    },
    [center[0], center[1], exclusionFrames]
  )

  /** The material owns its own copy of the uniforms. See AURORA_SPIN. */
  const mat = useRef<THREE.ShaderMaterial>(null)

  useLayoutEffect(() => {
    if (mat.current) mat.current.uniforms.uPixelRatio.value = Math.min(viewport.dpr, 2)
  }, [viewport.dpr, exclusionFrames.length])

  const geo = useMemo(() => {
    const pathRng = rng(21)
    const visualRng = rng(88)
    const g = new THREE.BufferGeometry()
    const seedPosition = new Float32Array(count * 3)
    const motion = new Float32Array(count * 3)
    const size = new Float32Array(count)
    const phase = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const offset = i * 3
      // Static trajectory seeds. `position` doubles as the draw-count source
      // Three expects every non-indexed geometry to have, while the shader
      // interprets it as angle/radius/base-height instead of an animated point.
      seedPosition[offset] = pathRng() * Math.PI * 2
      seedPosition[offset + 1] = 9 + pathRng() * radius
      seedPosition[offset + 2] = 0.4 + pathRng() * height
      motion[offset] = 0.12 + pathRng() * 0.35
      motion[offset + 1] = 0.3 + pathRng() * 0.9
      motion[offset + 2] = pathRng() * Math.PI * 2

      // Skewed so most orbs are small and a handful are proper lanterns. The
      // spread is deliberately narrow: with a wide one the big orbs sat at the
      // point-size cap all the way across the clearing, so they stopped
      // shrinking with distance and read as a foreground layer.
      size[i] = 0.7 + Math.pow(visualRng(), 2.6) * 1.7
      phase[i] = visualRng() * 10
    }
    g.setAttribute('position', new THREE.BufferAttribute(seedPosition, 3))
    g.setAttribute('aMotion', new THREE.BufferAttribute(motion, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    return g
  }, [count, radius, height])

  useLayoutEffect(() => () => geo.dispose(), [geo])

  useFrame((state) => {
    if (mat.current) mat.current.uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <points geometry={geo} frustumCulled={false} renderOrder={3}>
      <shaderMaterial
        key={`orb-${exclusionFrames.length}`}
        ref={mat}
        vertexShader={vertexShader}
        fragmentShader={ORB_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        fog={false}
      />
    </points>
  )
}

/* -------------------------------------------------------------- leaf drift */

export function Leaves({ count = 110 }: { count?: number }) {
  const [texA, texB] = useLoader(THREE.TextureLoader, [
    '/textures/T_Leaf_Update_01.webp',
    '/textures/T_Leaf_Update_02.webp',
  ])
  const refA = useRef<THREE.InstancedMesh>(null)
  const refB = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useLayoutEffect(() => {
    for (const t of [texA, texB]) t.colorSpace = THREE.SRGBColorSpace
  }, [texA, texB])

  const seeds = useMemo(() => {
    const r = rng(99)
    return Array.from({ length: count }, () => ({
      x: (r() - 0.5) * 58,
      z: (r() - 0.5) * 46 - 6,
      y0: r() * 16,
      fall: 0.3 + r() * 0.7,
      sway: 0.6 + r() * 1.6,
      phase: r() * Math.PI * 2,
      spin: (r() - 0.5) * 1.8,
      size: 0.18 + r() * 0.2,
      tint: r(),
    }))
  }, [count])

  const half = Math.ceil(count / 2)

  // Autumn spread rather than one orange: the pack's trees are a mix, and a
  // single leaf colour reads as a texture repeat.
  useLayoutEffect(() => {
    const palette = [new THREE.Color('#ff8b3d'), new THREE.Color('#e2452c'), new THREE.Color('#f5b942')]
    for (const [mesh, offset] of [
      [refA.current, 0],
      [refB.current, half],
    ] as const) {
      if (!mesh) continue
      for (let i = 0; i < mesh.count; i++) {
        const s = seeds[offset + i]
        mesh.setColorAt(i, palette[Math.floor((s?.tint ?? 0) * palette.length) % palette.length])
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [seeds, half])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    for (let bank = 0; bank < 2; bank++) {
      const mesh = bank === 0 ? refA.current : refB.current
      const offset = bank === 0 ? 0 : half
      if (!mesh) continue
      for (let i = 0; i < mesh.count; i++) {
        const s = seeds[offset + i]
        if (!s) continue
        // Wrap through a 16-unit column so leaves fall forever without respawn
        // bookkeeping.
        const y = 16 - ((s.y0 + t * s.fall) % 16)
        dummy.position.set(
          s.x + Math.sin(t * s.sway * 0.5 + s.phase) * 1.7,
          y,
          s.z + Math.cos(t * s.sway * 0.35 + s.phase) * 1.3
        )
        dummy.rotation.set(
          t * s.spin,
          t * s.spin * 0.7 + s.phase,
          Math.sin(t * s.sway + s.phase) * 0.9
        )
        dummy.scale.setScalar(s.size)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <>
      <instancedMesh ref={refA} args={[undefined, undefined, half]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={texA} transparent alphaTest={0.35} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={refB} args={[undefined, undefined, count - half]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={texB} transparent alphaTest={0.35} side={THREE.DoubleSide} />
      </instancedMesh>
    </>
  )
}

/* --------------------------------------------------------------- impostors */

/**
 * Far treeline from the pack's own billboard bakes, plus a solid dark ridge
 * under them.
 *
 * Without the ridge the bakes read as floating canopies: their trunks are thin
 * and dark, the fog eats them well before the leaves, and the ground at that
 * distance has already faded to the same value as the sky. The ridge gives the
 * trees something to stand on.
 */
const RIDGE_VERT = /* glsl */ `
  varying float vY;
  void main() {
    vY = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const RIDGE_FRAG = /* glsl */ `
  varying float vY;
  uniform vec3 uColor;
  void main() {
    // Solid at the foot, gone by the top: the band has to end without drawing
    // a line the eye can follow.
    float a = 1.0 - smoothstep(0.08, 0.62, vY);
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

/**
 * The two ends the far treeline's per-instance colours run between.
 *
 * These are a *multiply* on the material, so they cannot be as saturated as the
 * additive bounce without turning into a filter over the bake. They can be a
 * good deal more saturated than they were, though: at the first values the two
 * ends were four percent apart in hue, which across a band ninety metres out
 * and under fog is no variation at all.
 */
const IMPOSTOR_TEAL = /* @__PURE__ */ new THREE.Color('#7fbfb8')
const IMPOSTOR_VIOLET = /* @__PURE__ */ new THREE.Color('#9a91cf')

export function Impostors({ center = [0, 0] as [number, number] }) {
  const textures = useLoader(THREE.TextureLoader, [
    '/textures/T_Tree_Campsite_01_Billboard.webp',
    '/textures/T_Tree_Campsite_02_Billboard.webp',
    '/textures/T_Tree_Campsite_03_Billboard.webp',
    '/textures/T_Tree_Campsite_04_Billboard.webp',
  ])

  useLayoutEffect(() => {
    for (const t of textures) t.colorSpace = THREE.SRGBColorSpace
  }, [textures])

  const groups = useMemo(() => {
    const r = rng(555)
    const out: { pos: [number, number, number]; scale: number }[][] = [[], [], [], []]
    for (let i = 0; i < 76; i++) {
      const a = Math.PI + r() * Math.PI // behind the camp only
      const rad = 46 + r() * 46
      const x = Math.cos(a) * rad + center[0]
      const z = Math.sin(a) * rad + center[1] - 8
      // Behind the real trees, or the flat bakes give themselves away.
      if (z > -38) continue
      // No yaw jitter: these are flat bakes, and any rotation off the camera
      // axis makes them read as cardboard turned sideways.
      //
      // Fewer and bigger than before. These are large alpha-cutout quads
      // stacked several deep across the whole treeline, which is the most
      // expensive overdraw in the frame; trading a third of the count for 15%
      // more size holds the silhouette at a fraction of the fill.
      out[i % 4].push({ pos: [x, 0, z], scale: 9.5 + r() * 11 })
    }
    return out
  }, [center])

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const refs = useRef<(THREE.InstancedMesh | null)[]>([])

  /**
   * One material per bake, patched with the same aurora bounce the near wood
   * gets.
   *
   * Built here rather than as JSX because `applyWind` needs the material object
   * to hang an `onBeforeCompile` on, and a `<meshLambertMaterial>` element hands
   * out no such handle. The wind amplitude is zero on purpose — these are flat
   * bakes and any sway on them reads as cardboard flexing — so all the patch is
   * being used for is the sky term.
   */
  const materials = useMemo(
    () =>
      textures.map((tex) => {
        const m = new THREE.MeshLambertMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.4,
          side: THREE.DoubleSide,
          // Brighter than it was, because the per-instance colours below are a
          // multiply and every one of them is under 1. The product lands about
          // where the flat `#26456a` did; the difference is that it lands there
          // by a different route for each tree.
          color: new THREE.Color('#39435c'),
          // The sky lighting the canopy tops, which no light in the scene can
          // reach out that far to do.
          emissive: new THREE.Color('#050d1c'),
        })
        // Instanced transparent cards sort as one object, so the translucent
        // haze sheets cannot reliably sit in front of every individual tree.
        // Tag them for a stronger pass through the scene's existing height fog
        // instead; this preserves their soft edges and adds only two multiplies
        // to a shader they already run.
        m.defines = { ...m.defines, CAMPSITE_IMPOSTOR_FOG: '' }
        applyWind(m, {
          amplitude: 0,
          height: 1,
          aurora: {
            low: AURORA_BOUNCE_LOW,
            mid: AURORA_BOUNCE_MID,
            high: AURORA_BOUNCE_HIGH,
            // Harder than the near wood. This band is nothing *but* canopy —
            // there are no trunks and no ground in it — and it is the part of
            // the frame sitting directly under the brightest of the display.
            // It is also the band with the least of its own light: nothing in
            // the scene reaches ninety metres, so without this it is whatever
            // the hemisphere gives it, which is one navy.
            gain: 0.07,
            base: 2,
            span: 11,
          },
        })
        return m
      }),
    [textures]
  )

  useLayoutEffect(() => () => materials.forEach((m) => m.dispose()), [materials])

  useLayoutEffect(() => {
    refs.current.forEach((mesh, gi) => {
      if (!mesh) return
      const tint = new THREE.Color()
      groups[gi].forEach((item, i) => {
        // Buried by 9% of their height. The bakes carry empty space under the
        // roots, and a quad that only just touches y = 0 hovers as soon as the
        // ground behind it fogs out.
        dummy.position.set(item.pos[0], item.scale * 0.41, item.pos[2])
        dummy.scale.setScalar(item.scale)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)

        /*
          Colour bands crossing the far wood.

          The whole treeline was one flat blue, which at ninety metres and
          under fog is indistinguishable from a painted backdrop — and it was
          the single largest area of the frame with no variation anywhere in
          it. Two sines of world position at different bearings walk the tint
          between the cold teal and the cold violet the curtain above is made
          of, slowly enough that adjacent trees agree and a stand two hundred
          metres away does not. Static, unlike the shader term: this is the
          colour of the *stand*, not of the light on it.
        */
        const band = 0.5 + 0.5 * Math.sin(item.pos[0] * 0.052 - item.pos[2] * 0.031)
        const depth = 0.5 + 0.5 * Math.sin(item.pos[0] * 0.019 + item.pos[2] * 0.024 + 1.7)
        tint.copy(IMPOSTOR_TEAL).lerp(IMPOSTOR_VIOLET, band)
        // And a value spread on top of the hue spread, so the band reads as
        // trees at different distances rather than as a gradient.
        tint.multiplyScalar(0.66 + 0.34 * depth)
        mesh.setColorAt(i, tint)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    })
  }, [groups, dummy])

  return (
    <>
      {/* Ridge: a dark band of ground behind the treeline, faded out along its
          top edge. A flat-topped band drew a hard horizon line straight across
          the frame, which was worse than the floating trees it was fixing. */}
      <mesh position={[center[0], 0, center[1] - 70]} renderOrder={-1}>
        <cylinderGeometry args={[100, 100, 7, 56, 1, true, Math.PI * 0.06, Math.PI * 1.88]} />
        <shaderMaterial
          vertexShader={RIDGE_VERT}
          fragmentShader={RIDGE_FRAG}
          uniforms={{ uColor: { value: new THREE.Color('#040c22') } }}
          transparent
          depthWrite={false}
          side={THREE.BackSide}
          toneMapped={false}
          fog={false}
        />
      </mesh>

      {materials.map((mat, gi) => (
        <instancedMesh
          key={gi}
          ref={(el) => {
            refs.current[gi] = el
          }}
          args={[undefined, mat, Math.max(1, groups[gi].length)]}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1]} />
        </instancedMesh>
      ))}
    </>
  )
}

/**
 * Test-only replacement for the old treeline.
 *
 * The source "billboard" textures are actually atlases containing eight
 * separately packed camera angles. Mapping a whole atlas to one plane drew all
 * eight trees at once, including oblique views whose trunks lie sideways.
 * These cards use two extracted, connected silhouettes with vertical trunks.
 * They also yaw around world Y to face the camera, but can never pitch or roll.
 * Keep this component in the isolated `?impostors=1` scene until the study is
 * approved; the normal campsite intentionally continues to use `Impostors`.
 */
export function ImpostorStudy({ center = [0, 0] as [number, number] }) {
  const textures = useLoader(THREE.TextureLoader, [
    '/textures/impostors-preview/tree-upright-a.webp',
    '/textures/impostors-preview/tree-upright-b.webp',
  ])
  const { camera, gl } = useThree()
  const refs = useRef<(THREE.InstancedMesh | null)[]>([])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const lastCamera = useRef(new THREE.Vector2(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY))

  useLayoutEffect(() => {
    const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    for (const texture of textures) {
      texture.colorSpace = THREE.SRGBColorSpace
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      texture.anisotropy = anisotropy
      texture.generateMipmaps = true
      texture.needsUpdate = true
    }
  }, [gl, textures])

  const placements = useMemo(() => {
    const random = rng(90421)
    const byTexture: {
      pos: [number, number, number]
      height: number
      width: number
      mirror: boolean
      shade: number
    }[][] = [[], []]

    // Irregular depth bands give the treeline a forest volume without putting
    // every root and crown on the same ruler-straight screen-space row.
    const bands = [
      { count: 22, z: -43, spread: 56, minHeight: 10.5, maxHeight: 14.5 },
      { count: 27, z: -61, spread: 75, minHeight: 12.5, maxHeight: 17 },
      { count: 31, z: -83, spread: 98, minHeight: 14.5, maxHeight: 20 },
    ]

    bands.forEach((band, bandIndex) => {
      for (let i = 0; i < band.count; i++) {
        const lane = band.count === 1 ? 0.5 : i / (band.count - 1)
        const x = center[0] + THREE.MathUtils.lerp(-band.spread, band.spread, lane) + (random() - 0.5) * 5.5
        const z = center[1] + band.z + (random() - 0.5) * (10 + bandIndex * 4)
        const rawHeight = THREE.MathUtils.lerp(band.minHeight, band.maxHeight, random())
        const groundY = -0.34 + random() * 0.22
        // The annotated skyline is a hard world-space ceiling. Because the
        // cards are rooted on the same terrain plane, this also holds from the
        // pointer-driven left and right camera positions.
        const skylineCap = 9.3
        const height = Math.min(rawHeight, (skylineCap - groundY) / 0.83)
        // The second silhouette has the same dense crown as the real tree
        // batches. Keep the open, branching variant as occasional breakup,
        // not half of the distant forest where its sky gaps read as cyan.
        const type = random() < 0.82 ? 1 : 0
        byTexture[type].push({
          // Bury the bottom 22% of every card, proportional to its scale. Both
          // approved source silhouettes keep their complete root flare inside
          // that region, leaving only the straight trunk above terrain. The
          // root flare is below y=0 and depth-occluded by the terrain instead
          // of hanging in front of it.
          pos: [x, groundY - height * 0.22, z],
          height,
          width: height * (type === 0 ? 0.532 : 0.536) * (0.9 + random() * 0.18),
          mirror: random() > 0.5,
          shade: 0.76 + random() * 0.22,
        })
      }
    })

    return byTexture
  }, [center])

  const geometry = useMemo(() => {
    const result = new THREE.PlaneGeometry(1, 1)
    // Put the local origin at the roots instead of the middle of the texture.
    result.translate(0, 0.5, 0)
    return result
  }, [])

  useLayoutEffect(() => () => geometry.dispose(), [geometry])

  const materials = useMemo(
    () =>
      textures.map(
        (texture) =>
          new THREE.MeshLambertMaterial({
            map: texture,
            // Match the real tree cards' diffuse-only night response. Their
            // material deliberately has no Standard/PBR specular sheen, and a
            // low texture-shaped emissive floor stops back-lit leaves turning
            // into black cut-outs against the aurora.
            color: new THREE.Color('#456252'),
            emissive: new THREE.Color('#2c4639'),
            emissiveIntensity: 0.66,
            emissiveMap: texture,
            alphaTest: 0.5,
            transparent: false,
            depthTest: true,
            depthWrite: true,
            // Mirrored instances reverse their triangle winding. Rendering
            // both sides keeps that cheap per-instance variation in the same
            // two draw calls; the cards always face the camera either way.
            side: THREE.DoubleSide,
            toneMapped: true,
            alphaToCoverage: true,
          })
      ),
    [textures]
  )

  useLayoutEffect(() => () => materials.forEach((material) => material.dispose()), [materials])

  const studyColors = useMemo(
    () => [new THREE.Color('#8d9b87'), new THREE.Color('#788586')],
    []
  )

  const writeMatrices = (cameraX: number, cameraZ: number) => {
    for (let groupIndex = 0; groupIndex < placements.length; groupIndex++) {
      const mesh = refs.current[groupIndex]
      if (!mesh) continue
      const tint = new THREE.Color()

      placements[groupIndex].forEach((tree, index) => {
        const dx = cameraX - tree.pos[0]
        const dz = cameraZ - tree.pos[2]
        dummy.position.set(...tree.pos)
        // Yaw only. This is the invariant that prevents a trunk from ever
        // becoming diagonal even while the pointer-driven camera moves.
        dummy.rotation.set(0, Math.atan2(dx, dz), 0)
        dummy.scale.set(tree.mirror ? -tree.width : tree.width, tree.height, 1)
        dummy.updateMatrix()
        mesh.setMatrixAt(index, dummy.matrix)

        const coolBand = 0.5 + 0.5 * Math.sin(tree.pos[0] * 0.047 - tree.pos[2] * 0.021)
        tint.copy(studyColors[0]).lerp(studyColors[1], coolBand)
        tint.multiplyScalar(tree.shade)
        mesh.setColorAt(index, tint)
      })

      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }

  useLayoutEffect(() => {
    writeMatrices(camera.position.x, camera.position.z)
  })

  useFrame(() => {
    const previous = lastCamera.current
    if (Math.abs(previous.x - camera.position.x) < 0.002 && Math.abs(previous.y - camera.position.z) < 0.002) return
    previous.set(camera.position.x, camera.position.z)
    writeMatrices(camera.position.x, camera.position.z)
  })

  return (
    <>
      {materials.map((material, groupIndex) => (
        <instancedMesh
          key={groupIndex}
          ref={(mesh) => {
            refs.current[groupIndex] = mesh
          }}
          args={[geometry, material, placements[groupIndex].length]}
          frustumCulled={false}
        />
      ))}
    </>
  )
}

/* ------------------------------------------------------------------- haze */

/**
 * Soft banks of lit air standing between the camp and the treeline.
 *
 * The height fog in fog.ts tints geometry by distance; it cannot put anything
 * *between* two objects, so the near wood and the far wood still met at a hard
 * edge with nothing in the air to separate them. These are a handful of very
 * faint alpha-composited sheets — the moonlit haze the trees are standing in —
 * which gives the middle distance depth without touching anything in front.
 *
 * Every bank begins behind the tents. Small overlapping volumes are scattered
 * laterally and in depth rather than stretched across the whole view, so their
 * fully feathered silhouettes accumulate like pockets of fog instead of
 * exposing the edge of a translucent wall.
 */
function makeHazeTexture() {
  const w = 256
  const h = 128
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  // An elliptical density lobe that reaches zero at every edge. The previous
  // linear gradient was still opaque at the bottom, revealing the plane as a
  // hard horizontal boundary wherever it crossed the clearing.
  ctx.save()
  ctx.translate(w * 0.5, h * 0.58)
  ctx.scale(1, 0.52)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.49)
  g.addColorStop(0, 'rgba(255,255,255,0.92)')
  g.addColorStop(0.34, 'rgba(255,255,255,0.72)')
  g.addColorStop(0.68, 'rgba(255,255,255,0.24)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(-w * 0.5, -h, w, h * 2)
  ctx.restore()

  // Break the smooth card into pockets. These deterministic soft cut-outs are
  // cheaper than sampling noise in every translucent fragment and, across the
  // depth stack below, read as a volume rather than a single gradient plane.
  const r = rng(8821)
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 22; i++) {
    const x = w * (0.08 + r() * 0.84)
    const y = h * (0.16 + r() * 0.7)
    const radius = 7 + r() * 22
    const hole = ctx.createRadialGradient(x, y, 0, x, y, radius)
    hole.addColorStop(0, `rgba(0,0,0,${0.08 + r() * 0.22})`)
    hole.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = hole
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const HAZE_VERTEX = /* glsl */ `
  attribute float instanceOpacity;
  attribute vec3 instanceTint;
  varying vec2 vHazeUv;
  varying float vHazeOpacity;
  varying vec3 vHazeTint;

  void main() {
    vHazeUv = uv;
    vHazeOpacity = instanceOpacity;
    vHazeTint = instanceTint;
    vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
  }
`

const HAZE_FRAGMENT = /* glsl */ `
  uniform sampler2D uHazeMap;
  varying vec2 vHazeUv;
  varying float vHazeOpacity;
  varying vec3 vHazeTint;

  void main() {
    float density = texture2D(uHazeMap, vHazeUv).a * vHazeOpacity;
    if (density < 0.002) discard;
    gl_FragColor = vec4(vHazeTint, density);
  }
`

export function Haze({ center = [0, 0] as [number, number] }) {
  const tex = useMemo(makeHazeTexture, [])
  useLayoutEffect(() => () => tex.dispose(), [tex])
  const mesh = useRef<THREE.InstancedMesh>(null)

  const haze = useMemo(() => {
    const r = rng(6161)
    // Ordered far-to-near so normal alpha blending integrates the volume in
    // the same direction as a ray through the scene. The nearest pocket is at
    // z=-12.4; the deepest tent ends near z=-9.6.
    const layers = [
      { z: -58, count: 4, span: 94, w: 34, h: 5.0, o: 0.105, c: '#496f7a' },
      { z: -43, count: 4, span: 78, w: 28, h: 4.8, o: 0.115, c: '#527c86' },
      { z: -32, count: 4, span: 65, w: 23, h: 4.5, o: 0.130, c: '#5b8991' },
      { z: -23, count: 4, span: 55, w: 19, h: 4.2, o: 0.145, c: '#64969c' },
      { z: -17.2, count: 4, span: 47, w: 16, h: 3.8, o: 0.160, c: '#6da0a5' },
      { z: -13.5, count: 3, span: 39, w: 14, h: 3.4, o: 0.175, c: '#76aaad' },
    ]
    const banks: Array<{ x: number; y: number; z: number; w: number; h: number; yaw: number }> = []
    const opacities: number[] = []
    const tints: number[] = []

    for (const layer of layers) {
      for (let i = 0; i < layer.count; i++) {
        const width = layer.w * (0.78 + r() * 0.44)
        // No random bank is allowed to grow through the user's upper fog
        // guide. The plane is centred just under half-height, so this caps its
        // feather below y=4.5 even at the largest random scale.
        const height = Math.min(4.55, layer.h * (0.78 + r() * 0.42))
        const x = center[0] + ((i + 0.5) / layer.count - 0.5) * layer.span + (r() - 0.5) * width * 0.44
        const color = new THREE.Color(layer.c).multiplyScalar(0.88 + r() * 0.2)
        banks.push({
          x,
          y: height * (0.47 + r() * 0.04),
          z: layer.z + (r() - 0.5) * Math.min(4.5, Math.abs(layer.z) * 0.09),
          w: width,
          h: height,
          yaw: (r() - 0.5) * 0.18,
        })
        opacities.push(layer.o * (0.72 + r() * 0.56))
        tints.push(color.r, color.g, color.b)
      }
    }

    return {
      banks,
      opacities: new Float32Array(opacities),
      tints: new Float32Array(tints),
    }
  }, [center])

  useLayoutEffect(() => {
    if (!mesh.current) return
    const object = new THREE.Object3D()
    haze.banks.forEach((bank, i) => {
      object.position.set(bank.x, bank.y, bank.z)
      object.rotation.set(0, bank.yaw, 0)
      object.scale.set(bank.w, bank.h, 1)
      object.updateMatrix()
      mesh.current!.setMatrixAt(i, object.matrix)
    })
    mesh.current.instanceMatrix.needsUpdate = true
    mesh.current.computeBoundingSphere()
  }, [haze])

  const uniforms = useMemo(() => ({ uHazeMap: { value: tex } }), [tex])

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, haze.banks.length]} renderOrder={-1} frustumCulled={false}>
      <planeGeometry>
        <instancedBufferAttribute attach="attributes-instanceOpacity" args={[haze.opacities, 1]} />
        <instancedBufferAttribute attach="attributes-instanceTint" args={[haze.tints, 3]} />
      </planeGeometry>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={HAZE_VERTEX}
        fragmentShader={HAZE_FRAGMENT}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </instancedMesh>
  )
}

/* ------------------------------------------------------------------- fire */

const CAMPFIRE_LAYERS = [
  // Nested from the solid yellow core out to the faint dark-red envelope.
  // Identical base pivots keep every layer seated between the logs.
  { h: 1.3, w: 0.42, order: 4 },
  { h: 1.64, w: 0.74, order: 3 },
  { h: 1.92, w: 1.1, order: 2 },
  { h: 2.1, w: 1.42, order: 1 },
] as const

/**
 * Campfire: crossed procedural flame quads, a flickering light, rising sparks,
 * a smoke column and a glow pooled on the ground.
 */
export function Campfire({
  position = [0, 0, 0] as [number, number, number],
  scale = 1,
  // LIGHTING-REWORK (2026-08-17): optional external ref, so the debug panel
  // (?debug) can bind live intensity/distance controls to the actual light
  // instance rather than to the NIGHT/FIRELIGHT constants that built it.
  lightRef,
}: {
  position?: [number, number, number]
  scale?: number
  lightRef?: React.RefObject<THREE.PointLight | null>
}) {
  const glowTex = useMemo(() => makeGlowTexture('rgba(255,226,160,1)', 'rgba(255,150,40,0.7)'), [])

  const { camera } = useThree()
  const light = useRef<THREE.PointLight>(null)
  const flames = useRef<THREE.Group>(null)
  const sparks = useRef<THREE.Points>(null)
  const smokeGroup = useRef<THREE.Group>(null)
  const groundGlow = useRef<THREE.Mesh>(null)

  // The same visual construction as a torch: an opaque warm-yellow centre,
  // then successively wider and more transparent orange/red silhouettes.
  const flameMats = useMemo(
    () => [
      makeFlameMaterial({ seed: 0.0, detail: 2.2, rise: 2.25, opacity: 1, alphaPower: 1.1, brightness: 0.82, heatBias: 0.04, core: '#ffe2a0', mid: '#f6ae38', edge: '#df6214' }),
      makeFlameMaterial({ seed: 4.1, detail: 1.9, rise: 1.9, opacity: 0.44, alphaPower: 1.05, brightness: 0.9, heatBias: 0.14, core: '#ffd078', mid: '#ef821b', edge: '#a72a08' }),
      makeFlameMaterial({ seed: 8.6, detail: 1.55, rise: 1.55, opacity: 0.24, alphaPower: 1.0, brightness: 0.94, heatBias: 0.24, core: '#ffad54', mid: '#d95a0d', edge: '#761606' }),
      makeFlameMaterial({ seed: 12.8, detail: 1.3, rise: 1.35, opacity: 0.11, alphaPower: 0.95, brightness: 0.88, heatBias: 0.34, core: '#e87829', mid: '#ae3607', edge: '#4e0e04' }),
    ],
    []
  )

  // A single broad version of the torch plume. Its shader already contains
  // eight staggered buoyant injections, so one mesh yields connected curls
  // without parallel columns or a stack of obvious smoke cards.
  const smokeMat = useMemo(() => makeTorchSmokeMaterial(21.7, '#78818b', 0.14), [])

  useLayoutEffect(
    () => () => {
      glowTex.dispose()
      for (const m of flameMats) m.dispose()
      smokeMat.dispose()
    },
    [glowTex, flameMats, smokeMat]
  )

  const SPARKS = 42
  const sparkSeeds = useMemo(() => {
    const r = rng(303)
    return Array.from({ length: SPARKS }, () => ({
      a: r() * Math.PI * 2,
      rad: r() * 0.34,
      speed: 0.45 + r() * 1.5,
      offset: r(),
      drift: (r() - 0.5) * 0.9,
    }))
  }, [])

  const sparkGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3))
    return g
  }, [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const flicker = fireFlicker(t)

    for (const m of flameMats) {
      m.uniforms.uTime.value = t
      m.uniforms.uFlicker.value = flicker
    }

    if (light.current) {
      light.current.intensity = FIRELIGHT.key.intensity * (0.65 + flicker * 0.44)
      light.current.position.x = Math.sin(t * 6.1) * 0.07
      light.current.position.z = Math.cos(t * 5.3) * 0.07
      // Colour temperature moves with the flare, not just brightness — see
      // fireTemp. The swing is a few hundred kelvin's worth, which is enough
      // for the clearing to feel alive and small enough never to read as a
      // colour cycle.
      light.current.color
        .copy(FIRELIGHT.coolEnd)
        .lerp(FIRELIGHT.hotEnd, THREE.MathUtils.clamp(fireTemp(t), 0, 1))
    }

    if (flames.current) {
      const children = flames.current.children
      for (let i = 0; i < children.length; i++) {
        const tongue = children[i] as THREE.Group
        // Scale and lean around the base pivot, so the contact point stays
        // planted between the logs. The shader supplies the faster internal
        // distortion; this transform only gives the silhouette a slow breath.
        const gust = Math.sin(t * 0.37 + i * 0.4) * 0.5 + Math.sin(t * 0.13) * 0.35
        const sy = 0.98 + Math.sin(t * (4.5 + i * 0.9) + i * 2.3) * 0.035 + (flicker - 0.8) * 0.035
        tongue.scale.set(1, sy, 1)
        tongue.rotation.z = gust * (i >= 2 ? 0.018 : 0.03)
      }
    }

    const sp = sparks.current
    if (sp) {
      const pos = sparkGeo.getAttribute('position') as THREE.BufferAttribute
      const positions = pos.array as Float32Array
      for (let i = 0; i < sparkSeeds.length; i++) {
        const s = sparkSeeds[i]
        const life = (t * s.speed * 0.26 + s.offset) % 1
        /*
          VISUAL-13.3 (2026-08-30): rise 0.25 + life * 5.2 -> 0.25 + rise * 2.4,
          spread rad + life * 1.3 -> rad + rise * 0.62.

          An ember leaves the flame fast, loses to drag, and goes out. The old
          curve was linear in life and ran to five and a half units, which put
          embers level with the tent peaks at the same density they had at the
          coals — that is the uniform scatter over the whole frame. `rise` is
          life to the 0.62, so most of the travel happens in the first third and
          the last two thirds are the ember decelerating; the whole column now
          dies inside two and a half units of the fire.
        */
        const rise = Math.pow(life, 0.62)
        const y = 0.25 + rise * 1.9
        const spread = s.rad + rise * 0.48
        const offset = i * 3
        positions[offset] =
          Math.cos(s.a + life * 2.4) * spread + s.drift * rise * 0.5
        positions[offset + 1] = y
        positions[offset + 2] = Math.sin(s.a + life * 2.4) * spread
      }
      pos.needsUpdate = true
      // Fades out as the column tops out rather than being cut off at full
      // brightness — a hard-edged loop is what makes a spark system read as a
      // texture rather than as fire.
      ;(sp.material as THREE.PointsMaterial).opacity = 0.62 + Math.sin(t * 8) * 0.1
    }

    if (smokeGroup.current) {
      const mesh = smokeGroup.current.children[0] as THREE.Mesh | undefined
      if (mesh) {
        mesh.quaternion.copy(camera.quaternion)
        smokeMat.uniforms.uTime.value = t
        smokeMat.uniforms.uOpacity.value = 0.14
      }
    }

    if (groundGlow.current) {
      const m = groundGlow.current.material as THREE.MeshBasicMaterial
      m.opacity = 0.1 * flicker
      groundGlow.current.scale.setScalar(1 + Math.sin(t * 3.7) * 0.03)
    }
  })

  return (
    <group position={position} scale={scale}>
      {/* The fire's light. See FIRELIGHT.key. */}
      <pointLight
        ref={(l) => {
          light.current = l
          if (lightRef) lightRef.current = l
        }}
        position={[0, 1.12, 0]}
        color={FIRELIGHT.key.color}
        intensity={FIRELIGHT.key.intensity}
        distance={FIRELIGHT.key.distance}
        decay={2}
        castShadow={FIRELIGHT.shadow.enabled}
        shadow-mapSize={[FIRELIGHT.shadow.mapSize, FIRELIGHT.shadow.mapSize]}
        shadow-bias={FIRELIGHT.shadow.bias}
        shadow-normalBias={FIRELIGHT.shadow.normalBias}
        shadow-camera-near={0.35}
        shadow-camera-far={FIRELIGHT.key.distance}
      />

      {/* Pool of light on the ground under the fire. Wider than the lit disc
          of bare earth, so the glow runs out into the grass instead of stopping
          exactly where the ground texture changes.
          LIGHTING-REWORK (2026-08-17): opacity 0.22->0.30, same reasoning as
          the core quad above. */}
      <mesh ref={groundGlow} rotation-x={-Math.PI / 2} position={[0, 0.04, 0]}>
        <planeGeometry args={[12.5, 12.5]} />
        <meshBasicMaterial
          map={glowTex}
          transparent
          opacity={0.055}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          fog={false}
        />
      </mesh>

      {/*
        VISUAL-13.4 (2026-08-30): the flame group is scaled 1.24 across and 1.34
        up, rather than the pit being shrunk.

        The dirt circle is a nine-metre pool and a fire that only filled its
        middle made the pit read as a flat decal painted on the grass. Widening
        the base and — more importantly — making the flame taller is what fills
        it: the reference frame's fire has a silhouette that reaches the height
        of the benches behind it and throws a warm pool that goes all the way to
        the edge of the burn.
      */}
      <group ref={flames} scale={[1.18, 1.3, 1.18]} position={[0, 0.14, 0]}>
        {flameMats.map((mat, i) => {
          const layer = CAMPFIRE_LAYERS[i]
          return (
            <group key={i}>
              <mesh material={mat} position-y={layer.h / 2} renderOrder={layer.order}>
                <planeGeometry args={[layer.w, layer.h]} />
              </mesh>
            </group>
          )
        })}
      </group>

      <points ref={sparks} geometry={sparkGeo} frustumCulled={false}>
        <pointsMaterial
          map={glowTex}
          size={0.11}
          sizeAttenuation
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          fog={false}
          color="#ffb347"
        />
      </points>

      <group ref={smokeGroup}>
        <mesh material={smokeMat} position={[0, 3.0, -0.05]} renderOrder={0}>
          <planeGeometry args={[2.5, 3.0]} />
        </mesh>
      </group>
    </group>
  )
}

/* ----------------------------------------------------------------- torches */

/** Small flame for the tent torches: same shader, finer noise, its own light. */
const _flameUp = /* @__PURE__ */ new THREE.Vector3(0, 1, 0)
const _flameWorldPos = /* @__PURE__ */ new THREE.Vector3()
const _flameTarget = /* @__PURE__ */ new THREE.Vector3()
const _flameLookMat = /* @__PURE__ */ new THREE.Matrix4()
const _flameWorldQuat = /* @__PURE__ */ new THREE.Quaternion()
const _flameParentQuat = /* @__PURE__ */ new THREE.Quaternion()
const TORCH_SPARKS = 12

export function TorchFlame({
  position,
  seed = 0,
  scale = 1,
  heightScale = 1,
  light = FIRELIGHT.torch.intensity,
  reach = FIRELIGHT.torch.reach,
  strength = 1,
  brightness = 1,
  depthTest = true,
  lit = true,
  hasLight = true,
  gain,
  smoke = false,
  single = false,
  extras = true,
}: {
  position: [number, number, number]
  seed?: number
  /** Shrinks the whole flame. A candle is the same fire, a quarter the size. */
  scale?: number
  /** Vertical-only trim for flames enclosed by short lantern glass. */
  heightScale?: number
  light?: number
  reach?: number
  /**
   * Outdoor torches use one continuous, softly distorted smoke plume.
   * `single` flames retain the thin thread intended for a candle wick.
   */
  smoke?: boolean
  /**
   * One camera-facing plane instead of two crossed static ones.
   *
   * The crossed pair is right for the campfire and the torches: seen from any
   * angle around the camp, two quads at ninety degrees keep the flame looking
   * like it has volume. A candle is small, close, and read from very nearly
   * head-on — at that range the same cross reads as exactly what it is, two
   * flat flames overlapping in an X. One plane, turned to face the lens every
   * frame, is what a flame this size actually looks like.
   */
  single?: boolean
  /** Sparks and the painted ground pool around an outdoor torch. */
  extras?: boolean
  /**
   * Per-frame multiplier on the light only, read from a ref.
   *
   * Mounting and unmounting a light is a step change, and a step change in the
   * middle of a camera move is the thing that reads as a glitch. A ref lets the
   * owner fade the source in over the walk-in without re-rendering anything.
   */
  gain?: React.RefObject<number>
  /**
   * Scales the additive layers. A torch flame's opacity is chosen against the
   * night sky behind it; the same value on a wick a hand's width from the lens
   * saturates, and the bloom pass turns the result into a headlamp.
   */
  strength?: number
  /** Flame shader radiance; opacity remains controlled separately by strength. */
  brightness?: number
  /** Disable only for a flame enclosed by opaque decorative geometry. */
  depthTest?: boolean
  /**
   * Whether this flame owns a point light **at all**.
   *
   * Almost everything here should leave this alone: a flame that might ever be
   * lit keeps its source mounted and dark, for the reason in `lit` below. The
   * exception is a source that belongs to *whichever* tent is currently active
   * — the candles either side of a journal. There are three tents and only ever
   * one active one, so mounting those two lights on the active tent and nowhere
   * else keeps the scene's total constant while React moves them from one tent
   * to another inside a single commit.
   */
  hasLight?: boolean
  /**
   * Whether this flame's light is *on*. It is always mounted.
   *
   * This used to mount and unmount the light, which is the obvious way to stop
   * paying for a source nobody can see — three.js is a forward renderer, and
   * every point light in the scene is evaluated for every fragment of every lit
   * material whether or not it reaches. It is also the expensive way: the
   * number of lights in the scene is baked into every shader as a compile-time
   * constant, so changing it invalidates the program of *every material in the
   * scene at once*. See MOUNTED_POINT_LIGHTS in CampHero.
   *
   * A light held at zero intensity contributes exactly nothing to the image and
   * never changes the count. Same picture, no recompile.
   */
  lit?: boolean
}) {
  const { camera } = useThree()
  const lamp = useRef<THREE.PointLight>(null)
  const group = useRef<THREE.Group>(null)
  const flameMeshes = useRef<THREE.Group>(null)
  const sparks = useRef<THREE.Points>(null)
  const smokeMesh = useRef<THREE.Mesh>(null)

  // A shared time base scaled by a fixed 1.35 and offset by seed alone just
  // phase-shifts the exact same waveform — two flames whose seeds happen to
  // land a whole slow-term period apart (see fireFlicker) drift back into
  // lockstep, which is what read as fake, synced breathing. Jittering the
  // rate itself per instance means no two flames ever share a period, so
  // they can't re-align no matter how long the scene runs.
  const flickRate = useMemo(() => 1.35 + (rng(Math.floor(seed * 97) + 1)() - 0.5) * 0.16, [seed])

  // The campfire's exact spark seed fields, with only its emission radius
  // reduced to fit a torch basket. A seed unique to each torch prevents the
  // small ember bursts from lining up across the campsite.
  const sparkSeeds = useMemo(() => {
    const r = rng(303 + Math.floor(seed * 997))
    return Array.from({ length: TORCH_SPARKS }, () => ({
      a: r() * Math.PI * 2,
      rad: r() * 0.055,
      speed: 0.45 + r() * 1.5,
      offset: r(),
      drift: (r() - 0.5) * 0.22,
    }))
  }, [seed])

  const sparkGeo = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TORCH_SPARKS * 3), 3))
    return geometry
  }, [])
  useLayoutEffect(() => () => sparkGeo.dispose(), [sparkGeo])

  const smokeMat = useMemo(
    () => (smoke && single ? makeSmokeLineMaterial(seed, '#778086', 0.16) : null),
    [smoke, seed, single]
  )
  const torchSmokeMat = useMemo(
    () => (smoke && !single ? makeTorchSmokeMaterial(seed, '#78818b', 0.145) : null),
    [smoke, seed, single]
  )
  useLayoutEffect(
    () => () => {
      smokeMat?.dispose()
      torchSmokeMat?.dispose()
    },
    [smokeMat, torchSmokeMat]
  )

  // LIGHTING-REWORK (2026-08-17, item e): torches had a point light but no
  // ground pool of their own — the campfire's groundGlow quad has no
  // equivalent here. imagestats showed the ground under 4 of 6 torches
  // reading indistinguishable from the surrounding grass where the target
  // reference has a distinct warm patch. Same technique as the campfire:
  // one shared additive texture (torchGlowTex, below), not a new light.
  const groundGlow = useRef<THREE.Mesh>(null)

  const mats = useMemo(
    () =>
      single
        ? [
            makeFlameMaterial({
              seed,
              detail: 2.6,
              rise: 2.6,
              opacity: 0.72 * strength,
              brightness,
              core: '#ffdf9a',
              mid: '#ff8c14',
            }),
          ]
        : [
            makeFlameMaterial({
              seed,
              detail: 2.2,
              rise: 2.4,
              opacity: 0.74 * strength,
              brightness,
              core: '#ffd18f',
              mid: '#ef821b',
            }),
            makeFlameMaterial({
              seed: seed + 4.1,
              detail: 2.9,
              rise: 3.1,
              opacity: 0.46 * strength,
              brightness,
              core: '#ffc875',
              mid: '#e96f10',
            }),
            // A broader, faint outer silhouette behind the two existing
            // tongues. It carries the darker orange edge of the fire without
            // adding another bright core or turning into a glow ball.
            makeFlameMaterial({
              seed: seed + 8.6,
              detail: 1.8,
              rise: 1.9,
              opacity: 0.18 * strength,
              brightness,
              core: '#ffad54',
              mid: '#d95a0d',
              edge: '#761606',
            }),
            // Outermost envelope: wider than the first faint shell and less
            // opaque, so it reads as low-density flame rather than a halo.
            makeFlameMaterial({
              seed: seed + 12.8,
              detail: 1.45,
              rise: 1.6,
              opacity: 0.085 * strength,
              brightness,
              core: '#f48a31',
              mid: '#b83b08',
              edge: '#581005',
            }),
          ],
    [seed, strength, brightness, single]
  )
  for (const material of mats) material.depthTest = depthTest
  useLayoutEffect(() => () => mats.forEach((m) => m.dispose()), [mats])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    // Offset per torch so the camp does not pulse in lockstep.
    const flick = fireFlicker(t * flickRate + seed)
    for (const m of mats) {
      m.uniforms.uTime.value = t
      m.uniforms.uFlicker.value = flick
    }
    if (lamp.current) {
      lamp.current.intensity = lit ? light * flick * (gain ? gain.current : 1) : 0
    }
    if (group.current) {
      if (single) {
        group.current.scale.set(scale, scale * heightScale * (0.92 + flick * 0.16), scale)
        // Turned to the lens rather than swayed in place — see `single`. No
        // rotateZ sway here: a rigid rock reads as a pendulum, not a flame,
        // at candle scale where the whole plane is a few pixels wide. What
        // motion there is comes from the shader's own turbulence and the
        // height flicker on group.scale above, both of which stay vertical.
        //
        // Yawed to the lens, not tilted to it. Copying the camera's full
        // quaternion carries its pitch onto the flame too — fine levelled off,
        // but the reading pose looks steeply down at the journal, and a wick
        // that inherits that pitch leans its flame forward over the page
        // instead of standing up off it. This keeps the plane's own up axis
        // pinned to world up and only turns it around that axis to face the
        // camera, in the flame's parent space so a rotated tent still gets a
        // vertical candle.
        group.current.getWorldPosition(_flameWorldPos)
        _flameTarget.set(camera.position.x, _flameWorldPos.y, camera.position.z)
        _flameLookMat.lookAt(_flameWorldPos, _flameTarget, _flameUp)
        _flameWorldQuat.setFromRotationMatrix(_flameLookMat)
        if (group.current.parent) {
          group.current.parent.getWorldQuaternion(_flameParentQuat)
          group.current.quaternion.copy(_flameParentQuat.invert().multiply(_flameWorldQuat))
        } else {
          group.current.quaternion.copy(_flameWorldQuat)
        }
      } else {
        group.current.scale.set(scale, scale * heightScale, scale)
        group.current.rotation.set(0, 0, 0)

        // Keep the campfire's independent height variation, while leaving the
        // physical quads upright. Rotating a crossed flame card exposes its
        // edge and makes the fire appear to turn away from the viewer; the
        // flame shader already bends only the upper silhouette internally.
        const children = flameMeshes.current?.children
        if (children) for (let i = 0; i < children.length; i++) {
          // Each child is a pivot located at the wick, so height changes leave
          // the bottom centred in the basket.
          const tongue = children[i] as THREE.Group
          const sy =
            0.98 +
            Math.sin(t * (5.1 + i * 1.6) + seed + i * 2.3) * 0.012 +
            flick * 0.02
          tongue.scale.set(1, sy, 1)
          tongue.rotation.z = 0
        }
      }
    }

    // Campfire spark motion copied directly and scaled to the torch: the same
    // eased rise, spiral, drift, looping lifetime, and breathing opacity.
    const sparkPoints = sparks.current
    if (sparkPoints && !single && extras) {
      const pos = sparkGeo.getAttribute('position') as THREE.BufferAttribute
      const positions = pos.array as Float32Array
      for (let i = 0; i < sparkSeeds.length; i++) {
        const spark = sparkSeeds[i]
        const life = (t * spark.speed * 0.26 + spark.offset) % 1
        const rise = Math.pow(life, 0.62)
        const y = 0.08 + rise * 0.72
        const spread = spark.rad + rise * 0.11
        const offset = i * 3
        positions[offset] =
          Math.cos(spark.a + life * 2.4) * spread + spark.drift * rise * 0.5
        positions[offset + 1] = y
        positions[offset + 2] = Math.sin(spark.a + life * 2.4) * spread
      }
      pos.needsUpdate = true
      ;(sparkPoints.material as THREE.PointsMaterial).opacity = lit ? 0.68 + Math.sin(t * 8 + seed) * 0.12 : 0
    }
    if (smokeMat) {
      // Loops on its own slow clock rather than drifting anywhere — a single
      // thread breathing in and reforming, not a puff travelling upward.
      const life = (t * 0.15 + seed * 0.31) % 1
      smokeMat.uniforms.uTime.value = t
      smokeMat.uniforms.uLife.value = life
    }
    if (torchSmokeMat && smokeMesh.current && !single) {
      torchSmokeMat.uniforms.uTime.value = t
      torchSmokeMat.uniforms.uOpacity.value = lit ? 0.145 : 0
      smokeMesh.current.visible = lit
      smokeMesh.current.quaternion.copy(camera.quaternion)
    }
    if (groundGlow.current) {
      const m = groundGlow.current.material as THREE.MeshBasicMaterial
      m.opacity = 0.07 * flick * (lit ? (gain ? gain.current : 1) : 0)
    }
  })

  return (
    <group position={position}>
      <group ref={group}>
        <group ref={flameMeshes}>
          {mats.map((mat, i) => {
            const h = single ? 0.66 : [0.66, 0.55, 0.74, 0.82][i]
            const width = single ? 0.22 : [0.22, 0.17, 0.3, 0.42][i]
            const rotationY = single ? 0 : [0, Math.PI / 2, Math.PI / 4, 0][i]
            const renderOrder = single ? 0 : [2, 3, 1, 0][i]
            return (
              <group key={i} rotation-y={rotationY}>
                <mesh material={mat} position={[0, h / 2, 0]} renderOrder={renderOrder}>
                  <planeGeometry args={[width, h]} />
                </mesh>
              </group>
            )
          })}
        </group>
        {/* Nested in the same billboarded, scaled group as the flame planes —
            not a sibling with its own transform — so it tracks the candle's
            own angle instead of drifting off in the parent's unbillboarded
            rotation frame. Based at 0.66, the tallest flame plane's own tip
            (see `h` above), not the wick — smoke leaves where the fire ends. */}
        {smoke && smokeMat && (
          <mesh ref={smokeMesh} material={smokeMat} position={[0, 0.66 + 0.75, 0]}>
            <planeGeometry args={[0.5, 1.5]} />
          </mesh>
        )}
      </group>
      {!single && extras && (
        <points ref={sparks} geometry={sparkGeo} frustumCulled={false}>
          <pointsMaterial
            map={getTorchGlowTex()}
            size={0.045}
            sizeAttenuation
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
            fog={false}
            color="#ffb347"
          />
        </points>
      )}
      {smoke && !single && torchSmokeMat && (
        <mesh ref={smokeMesh} material={torchSmokeMat} position={[0, 1.52, 0]}>
          <planeGeometry args={[1.4, 1.92]} />
        </mesh>
      )}
      {hasLight && (
        <pointLight
          ref={lamp}
          position={[0, 0.16 * scale, 0]}
          color="#ffc084"
          intensity={lit ? light : 0}
          distance={reach}
          decay={2}
        />
      )}
      {/* LIGHTING-REWORK (2026-08-17, item e): ground pool, torches only
          (`!single` — candles are indoor/on a bench, no ground plane makes
          sense under one). Painted, not lit: same trick as the campfire's
          own groundGlow, at a fraction of the size and reusing one shared
          texture across all 6 torches. */}
      {/* This group is offset to the flame's own height (`position` prop —
          1.66 for a torch), so the pool's local y has to cancel that back
          out to land on the ground rather than float at flame height. */}
      {!single && extras && (
        <mesh ref={groundGlow} rotation-x={-Math.PI / 2} position={[0, 0.03 - position[1], 0]}>
          <planeGeometry args={[3.3, 3.3]} />
          <meshBasicMaterial
            map={getTorchGlowTex()}
            transparent
            opacity={0.07}
            depthWrite={false}
            blending={THREE.NormalBlending}
            toneMapped
            fog={false}
          />
        </mesh>
      )}
    </group>
  )
}
