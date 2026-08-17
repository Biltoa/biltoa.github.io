import * as THREE from 'three'

/**
 * Foliage shader patches, injected into whatever material the kit shipped.
 *
 * Patching the stock MeshStandardMaterial keeps the pack's textures, normal
 * maps and alpha cutout intact — writing a custom ShaderMaterial for foliage
 * would mean re-implementing all of that.
 *
 * Two effects live here:
 *   wind      phase comes from each instance's own translation, so a field of
 *             grass ripples instead of swaying in unison
 *   firelight a warm falloff around the campfire plus a root-to-tip gradient,
 *             which is what stops grass reading as flat cutouts under a
 *             single ambient tone
 */

interface FoliageShader {
  uniforms: {
    uWindTime: { value: number }
    uFireFlicker?: { value: number }
    uFirePos?: { value: THREE.Vector3 }
    uWarmCount?: { value: number }
  }
}

const patched: FoliageShader[] = []

/**
 * Tree-canopy shaders only, for the `?debug` panel's top/bottom gradient
 * controls (uTipTint/uRootTint/uFoliageSplit/uFoliageSoftness/uCoolGain) —
 * a subset of `patched`, which also holds grass blade shaders that don't
 * have these particular uniforms.
 */
export const TREE_CANOPY_SHADERS: {
  uniforms: {
    uTipTint: { value: THREE.Color }
    uRootTint: { value: THREE.Color }
    uCoolGain: { value: number }
    uFoliageSplit: { value: number }
    uFoliageSoftness: { value: number }
  }
}[] = []

/* ------------------------------------------------------------ warm lights */

/**
 * Every warm light the grass is allowed to notice: the campfire and the six
 * torches.
 *
 * One flat orange tint over the whole field is what made the clearing read as
 * an orange carpet — grass twenty metres from any flame was the same colour as
 * grass a metre from the coals. These are the *actual* sources, given to the
 * blade shader as world positions with their own radii, so a blade works out
 * for itself how much fire it can see. Everything out of reach of all of them
 * stays the navy the moon leaves it.
 *
 * Packed as vec4(x, z, radius, power). Height is ignored: a torch flame is
 * 1.7m up and the grass is on the floor, so the horizontal distance is the only
 * term that varies across the field.
 */
const MAX_WARM = 8
const WARM = /* @__PURE__ */ Array.from({ length: MAX_WARM }, () => new THREE.Vector4())
let warmCount = 0

export interface WarmLight {
  x: number
  z: number
  /** e-folding radius of the falloff, in metres. */
  radius: number
  /** Relative strength — the campfire is 1. */
  power: number
}

/** Publishes the camp's warm sources to every patched foliage shader. */
export function setWarmLights(lights: WarmLight[]) {
  warmCount = Math.min(lights.length, MAX_WARM)
  for (let i = 0; i < warmCount; i++) {
    const l = lights[i]
    WARM[i].set(l.x, l.z, Math.max(0.001, l.radius), l.power)
  }
  for (const shader of patched) {
    if (shader.uniforms.uWarmCount) shader.uniforms.uWarmCount.value = warmCount
  }
}

/* ------------------------------------------------------------ sky bounce */

/**
 * The light the aurora throws back down onto the wood.
 *
 * Every tree in this scene is lit by one navy hemisphere term and a key light
 * that cannot reach past the clearing, so fifty canopies arrive at the same hue
 * and the same value — and a treeline with no colour variation across it is a
 * cutout, whatever the silhouette is doing. But there is a saturated, moving,
 * hundred-metre-wide light source directly above that wood, and nothing in the
 * scene was letting the trees notice it.
 *
 * This is that: a crown-weighted additive term whose colour runs between the
 * two ends of the display's own ramp, teal and violet, chosen by slow bands
 * crossing the forest so neighbouring trees agree and distant ones do not. It
 * is deliberately a *bounce* and not a rim — no normals are involved, because a
 * leaf card's normal is a lie — so what it actually keys off is height, which
 * is the one thing that genuinely decides how much sky a leaf can see.
 */
/**
 * The three stops of the ramp, shared by everything that stands under the sky.
 *
 * Taken from the display's own colours rather than invented: the sky shader
 * ramps green-through-cyan at the bottom of the curtain to magenta at the top,
 * then multiplies the whole thing by (0.66, 0.90, 1.32). Light bouncing off the
 * wood has to be the colour of the thing emitting it or the trick reads as a
 * filter over the forest.
 *
 * **Three stops, not two.** A straight mix between a teal and a violet runs
 * through desaturated blue at the halfway point, and the halfway point is where
 * most of a smoothly-banded forest sits — so a two-stop ramp spends most of its
 * output on the one colour the wood already had too much of. Going through a
 * saturated cobalt keeps every point on the run a colour rather than a greying
 * of two colours.
 */
export const AURORA_BOUNCE_LOW = /* @__PURE__ */ new THREE.Color('#17796e')
export const AURORA_BOUNCE_MID = /* @__PURE__ */ new THREE.Color('#2a5c9e')
export const AURORA_BOUNCE_HIGH = /* @__PURE__ */ new THREE.Color('#5f4a94')

export interface AuroraBounce {
  /** Colour of the low end of the ramp — the teal the curtain sits on. */
  low: THREE.Color
  /** The middle of the run. See AURORA_BOUNCE_MID for why it exists. */
  mid: THREE.Color
  /** Colour of the high end — the magenta it runs to at altitude. */
  high: THREE.Color
  /** Overall gain, in linear scene units. */
  gain: number
  /** World height at which the term starts. Below this a trunk gets nothing. */
  base: number
  /** Metres over which it climbs to full. */
  span: number
}

export interface WindOptions {
  /** Metres of horizontal displacement at the top of the mesh. */
  amplitude?: number
  speed?: number
  /** Mesh height in metres; sway falls off toward the base. */
  height?: number
  /** Adds the warm-light falloff and the root-to-tip gradient. */
  firelight?: boolean
  /** Colour multiplied into the tips where no flame reaches. */
  tipTint?: THREE.Color
  /** Colour multiplied into the roots where no flame reaches. */
  rootTint?: THREE.Color
  /** Overall gain on that cool tint. */
  coolGain?: number
  /** Strength of the additive warm term inside a flame's radius. */
  warmGain?: number
  /** Colour of the additive warm term. */
  warmColor?: THREE.Color
  /**
   * What the cool tint releases *to* as a blade comes into flame range.
   *
   * White here means the transition zone has no colour of its own: a blade
   * halfway to the fire is simply less blue than one further out, and the only
   * warmth in the field is the additive term, which only really bites in the
   * last couple of metres. A warm off-white instead makes the whole falloff
   * carry hue, so the fire and each torch sit in a pool that changes colour
   * with distance rather than switching on at the edge of one.
   */
  warmTint?: THREE.Color
  /**
   * Pulls the sampled albedo toward its own luminance, then re-tints it with
   * `mapTint`. 0 keeps the map as authored, 1 makes the hue entirely the tint's.
   *
   * The kit's blades are a straw texture baked for an autumn daylight field. A
   * material colour multiplies that yellow rather than replacing it, so no
   * green tint could ever win against it — the field came out olive at best and
   * straw at worst. Taking the saturation out first leaves the tint deciding
   * the hue and the map deciding only the detail, which is what it is actually
   * good for.
   *
   * **The material's own `color` must be white when this is used.** The
   * desaturation has to happen after `<map_fragment>`, which is the only place
   * the texel exists — and by then `diffuseColor` is already `color * texel`,
   * so a tint left on the material would be greyed along with the map. That is
   * what `mapTint` is for: it goes on afterwards, where nothing can wash it
   * out.
   */
  desaturateMap?: number
  /** Hue applied after `desaturateMap`. Ignored without it. */
  mapTint?: THREE.Color
  /**
   * Takes the additive warm term from `firelight` without its cool root-to-tip
   * multiply.
   *
   * The blade shader's cool tint is a *replacement* palette for a surface lit
   * only by the moon, which is right for grass and wrong for anything that has
   * its own albedo worth keeping — a tree canopy tinted root-to-tip navy loses
   * the autumn it was given. This keeps the falloff and drops the tint, so the
   * near wood picks up the fire the same way the field does.
   */
  warmOnly?: boolean
  /**
   * Multiplier on every warm light's radius, for this material only.
   *
   * The radii in `setWarmLights` are tuned for blades of grass on the floor. A
   * canopy is ten metres up and twenty metres out, so it sees a much broader,
   * much weaker version of the same falloff — one number rather than a second
   * set of lights.
   */
  warmReach?: number
  /** Cold sky bounce on the canopy. See AuroraBounce. */
  aurora?: AuroraBounce
}

export function applyWind(material: THREE.Material, opts: WindOptions = {}) {
  const {
    amplitude = 0.09,
    speed = 1.4,
    height = 1,
    firelight = false,
    tipTint = new THREE.Color('#7d9cd6'),
    rootTint = new THREE.Color('#24304a'),
    coolGain = 1.2,
    warmGain = 0.55,
    warmColor = new THREE.Color('#ff9a4a'),
    warmTint = new THREE.Color('#ffffff'),
    desaturateMap = 0,
    mapTint = new THREE.Color('#ffffff'),
    warmOnly = false,
    warmReach = 1,
    aurora,
  } = opts
  const mat = material as THREE.MeshStandardMaterial

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = { value: 0 }
    shader.uniforms.uWindAmp = { value: amplitude }
    shader.uniforms.uWindSpeed = { value: speed }
    shader.uniforms.uWindHeight = { value: height }
    shader.uniforms.uFireFlicker = { value: 1 }
    shader.uniforms.uFirePos = { value: new THREE.Vector3() }
    shader.uniforms.uFireColor = { value: warmColor }
    shader.uniforms.uTipTint = { value: tipTint }
    shader.uniforms.uRootTint = { value: rootTint }
    shader.uniforms.uCoolGain = { value: coolGain }
    shader.uniforms.uWarmGain = { value: warmGain }
    shader.uniforms.uWarmTint = { value: warmTint }
    shader.uniforms.uWarmReach = { value: warmReach }
    // Shared array, so `setWarmLights` writes once and every patched shader
    // sees it.
    shader.uniforms.uWarm = { value: WARM }
    shader.uniforms.uWarmCount = { value: warmCount }
    if (aurora) {
      shader.uniforms.uAurLow = { value: aurora.low }
      shader.uniforms.uAurMid = { value: aurora.mid }
      shader.uniforms.uAurHigh = { value: aurora.high }
      shader.uniforms.uAurGain = { value: aurora.gain }
      shader.uniforms.uAurBase = { value: aurora.base }
      shader.uniforms.uAurSpan = { value: aurora.span }
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uWindTime;
         uniform float uWindAmp;
         uniform float uWindSpeed;
         uniform float uWindHeight;
         ${
           firelight
             ? `uniform vec4 uWarm[${MAX_WARM}];
                uniform int uWarmCount;
                uniform float uWarmReach;
                varying float vFoliageWarm;`
             : ''
         }
         ${aurora ? 'varying vec3 vFoliageWorld;' : ''}
         varying float vFoliageH;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vec3 windOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
         #else
           vec3 windOrigin = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
         #endif
         float windPhase = uWindTime * uWindSpeed + windOrigin.x * 0.45 + windOrigin.z * 0.31;
         // Quadratic falloff: the base stays planted, the tip travels.
         float windMask = clamp(position.y / uWindHeight, 0.0, 1.0);
         vFoliageH = windMask;
         windMask *= windMask;
         // Two frequencies so gusts read as gusts rather than a metronome.
         float gust = 0.75 + 0.25 * sin(uWindTime * 0.31 + windOrigin.x * 0.08);
         transformed.x += sin(windPhase) * uWindAmp * windMask * gust;
         transformed.z += cos(windPhase * 0.83) * uWindAmp * 0.62 * windMask * gust;
         ${
           firelight || aurora
             ? `#ifdef USE_INSTANCING
                  vec3 foliageWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
                #else
                  vec3 foliageWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
                #endif`
             : ''
         }
         ${aurora ? 'vFoliageWorld = foliageWorld;' : ''}
         ${
           firelight
             ? `
         /*
           How much flame this blade can see, worked out per *vertex*.

           This loop used to run in the fragment shader: eight distances and
           eight exponentials for every pixel of a field with several layers of
           alpha-cutout overdraw over most of the lower frame. A blade of grass
           is a handful of vertices and a few hundred pixels, and the term it is
           computing is a smooth function of ground position — there is nothing
           in it that varies across a blade that interpolation cannot carry.
         */
         float warmSum = 0.0;
         for (int i = 0; i < ${MAX_WARM}; i++) {
           if (i >= uWarmCount) break;
           vec4 L = uWarm[i];
           float d = distance(foliageWorld.xz, L.xy);
           float rad = L.z * uWarmReach;
           warmSum += L.w * exp(-(d * d) / (rad * rad));
         }
         vFoliageWarm = clamp(warmSum, 0.0, 1.35);`
             : ''
         }`
      )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying float vFoliageH;
       ${
         firelight
           ? `uniform float uFireFlicker;
              uniform vec3 uFireColor;
              uniform vec3 uTipTint;
              uniform vec3 uRootTint;
              uniform vec3 uWarmTint;
              uniform float uCoolGain;
              uniform float uWarmGain;
              varying float vFoliageWarm;`
           : ''
       }
       ${
         aurora
           ? `uniform float uWindTime;
              uniform vec3 uAurLow;
              uniform vec3 uAurMid;
              uniform vec3 uAurHigh;
              uniform float uAurGain;
              uniform float uAurBase;
              uniform float uAurSpan;
              varying vec3 vFoliageWorld;

              // Teal to cobalt to magenta. See AURORA_BOUNCE_MID.
              vec3 auroraRamp(float t) {
                return t < 0.5
                  ? mix(uAurLow, uAurMid, t * 2.0)
                  : mix(uAurMid, uAurHigh, t * 2.0 - 1.0);
              }`
           : ''
       }`
    )

    if (desaturateMap > 0) {
      shader.uniforms.uMapTint = { value: mapTint }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n       uniform vec3 uMapTint;`)
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
         // See WindOptions.desaturateMap. Luminance-preserving, so the blade's
         // own light and shade survive the flattening; only the hue is handed
         // over to the tint on the next line.
         diffuseColor.rgb = mix(
           vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))),
           diffuseColor.rgb,
           ${(1 - desaturateMap).toFixed(4)}
         );
         diffuseColor.rgb *= uMapTint;`
        )
    }

    if (aurora) {
      /*
        Added before the fog chunk, not after the dither.

        Fog is what makes the far wood recede, and a term pasted in after it is
        a term the distance cannot touch — the trees ninety metres out would
        take the same lift as the ones behind the tents and the whole treeline
        would flatten back into the wall this exists to break up. Going in
        ahead of the fog means the bounce sinks with everything else.
      */
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        `{
           // Crowns take it, trunks do not: height is the only honest measure
           // of how much sky a leaf card can see.
           //
           // The weighting used to be a straight square, which put nearly all
           // of the term in the top of each canopy and left the other two
           // thirds of the wood on the flat navy this exists to replace. The
           // curve below still favours the crowns and still reaches the middle.
           float aurUp = clamp((vFoliageWorld.y - uAurBase) / uAurSpan, 0.0, 1.0);
           if (aurUp > 0.0) {
             float aurFall = aurUp * (0.35 + 0.65 * aurUp);
             // Two slow bands at different rates and different bearings: one
             // picks the hue, the other breathes the strength. Neither is fast
             // enough to read as motion — the wood is meant to look like it is
             // standing under a light that changes, not to shimmer.
             float aurHue = 0.5 + 0.5 * sin(
               vFoliageWorld.x * 0.075 - vFoliageWorld.z * 0.042 + uWindTime * 0.09);
             float aurPulse = 0.62 + 0.38 * sin(
               vFoliageWorld.x * 0.028 + vFoliageWorld.z * 0.035 - uWindTime * 0.06 + 2.1);
             // Height biases the hue as well as the strength: the top of a
             // canopy is under the magenta end of the curtain and the bottom is
             // under its feet, which is where the teal is.
             vec3 aurCol = auroraRamp(clamp(aurHue * 0.72 + aurUp * 0.38, 0.0, 1.0));
             gl_FragColor.rgb += aurCol * (uAurGain * aurFall * aurPulse);
           }
         }
         #include <fog_fragment>`
      )
    }

    if (firelight && warmOnly) {
      /*
        The additive half only. See WindOptions.warmOnly.

        Height runs the other way here than it does on a blade of grass. A
        torch flame is above the grass and below the canopy, so what is closest
        to the fire on a tree is its lower foliage — weighting the crowns, which
        is what the blade version does, would put the firelight on precisely the
        part of the wood the fire cannot see.
      */
      // LIGHTING-REWORK (2026-08-17): this branch used to skip the
      // root/tip gradient entirely — `uRootTint`/`uTipTint` were declared
      // (see the `firelight` uniform block above, not gated on `warmOnly`)
      // but never multiplied in, so a tree's canopy had no top/bottom
      // separation at all, only the additive campfire term below. Added at
      // the user's request: top-lit-by-moon, darker at the bottom, on its
      // own tunable split point rather than the raw 0-1 model height, since
      // a canopy's foliage is not evenly distributed across that range.
      shader.uniforms.uFoliageSplit = { value: 0.42 }
      shader.uniforms.uFoliageSoftness = { value: 0.35 }
      TREE_CANOPY_SHADERS.push(shader as unknown as (typeof TREE_CANOPY_SHADERS)[number])
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uFoliageSplit;
           uniform float uFoliageSoftness;`
        )
        .replace(
          '#include <fog_fragment>',
          `{
             float grad = smoothstep(
               uFoliageSplit - uFoliageSoftness, uFoliageSplit + uFoliageSoftness, vFoliageH
             );
             vec3 canopyTint = mix(uRootTint * uCoolGain, uTipTint * uCoolGain, grad);
             gl_FragColor.rgb *= canopyTint;
           }
           gl_FragColor.rgb +=
             uFireColor * vFoliageWarm * (0.62 + 0.38 * uFireFlicker) *
             (0.95 - 0.62 * vFoliageH) * uWarmGain;
           #include <fog_fragment>`
        )
    } else if (firelight) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         float warm = vFoliageWarm;

         // Out of every flame's reach the blade is lit by the moon and the
         // sky and nothing else: dark at the soil, a cool highlight on the
         // tip. Inside a flame's reach the tint releases toward uWarmTint so
         // the point lights' own warm falloff survives instead of being
         // filtered out by a cold multiply — and, because that target carries
         // hue rather than being flat white, the release itself is a colour
         // change and not just a loss of blue.
         //
         // The bend on the mix decides how far each pool spreads, and it is a
         // sharp lever: the falloff feeding it is a gaussian, so a square root
         // lifts the whole long tail and every blade in the clearing ends up
         // most of the way to the warm end. That is the orange-carpet failure,
         // and it is worth naming because the fix for "the fire does not reach
         // the grass" keeps looking like this line.
         //
         // A mild bend keeps a readable pool round each flame while leaving the
         // field between them the colour it is lit by, which is the sky.
         float warmMix = pow(clamp(warm, 0.0, 1.0), 0.8);
         vec3 cool = mix(uRootTint, uTipTint, smoothstep(0.0, 1.0, vFoliageH));
         // Never all the way to the warm end. At 1.0 the blades directly around
         // the coals lose their own colour entirely and the camp sits in a ring
         // of dead straw; holding a quarter of the cool tint back means even the
         // hottest grass in frame is still grass.
         vec3 tint = mix(cool * uCoolGain, uWarmTint, warmMix * 0.58);
         gl_FragColor.rgb *= tint;

         // Then the flames themselves, tied to the same flicker value the
         // point lights use so blade colour and lighting agree. Tips take
         // more than roots — the light is above them.
         gl_FragColor.rgb +=
           uFireColor * warm * (0.62 + 0.38 * uFireFlicker) *
           (0.26 + 0.74 * vFoliageH) * uWarmGain;`
      )
    }

    patched.push(shader as unknown as FoliageShader)
  }

  // Force a recompile if the material was already used.
  mat.needsUpdate = true
  return mat
}

/** Called once per frame from the scene. */
export function tickWind(elapsed: number, fireFlicker = 1, firePos?: THREE.Vector3) {
  for (const shader of patched) {
    shader.uniforms.uWindTime.value = elapsed
    if (shader.uniforms.uFireFlicker) shader.uniforms.uFireFlicker.value = fireFlicker
    if (shader.uniforms.uFirePos && firePos) shader.uniforms.uFirePos.value.copy(firePos)
  }
}

/* ------------------------------------------------------------- ground glow */

export interface GroundGlowOptions {
  /** 0 keeps the map as authored, 1 flattens it entirely to mapTint's hue. */
  desaturateMap?: number
  /** Hue the desaturated map is tinted toward. */
  mapTint?: THREE.Color
  /** Colour of the warm pool around the fire and torches. */
  warmColor?: THREE.Color
  /** Gain on that pool. */
  warmGain?: number
  /** Cold sky/aurora lift, same ramp the trees use. Optional. */
  aurora?: { low: THREE.Color; mid: THREE.Color; high: THREE.Color; gain: number }
  /** Flat additive floor, in linear scene units, so distance never hits (0,0,0). */
  floor?: THREE.Color
}

/**
 * Patches the ground plane the same way `applyWind` patches foliage, but
 * fragment-side rather than vertex-side.
 *
 * The blade shader moved its warm-pool sum into the vertex stage because a
 * field is several thousand overlapping alpha-cutout triangles and the sum
 * would otherwise run once per overdrawn pixel. The ground is the opposite
 * shape: one mesh, one layer, no overdraw — but only two triangles, so a
 * vertex-side sum would sample the gaussian pool at its four corners and
 * miss it entirely. Fragment-side costs one evaluation per ground pixel,
 * which is what the blade version was trying to avoid and is exactly what
 * this mesh does not have.
 */
export function applyGroundGlow(material: THREE.Material, opts: GroundGlowOptions = {}) {
  const {
    desaturateMap = 0,
    mapTint = new THREE.Color('#ffffff'),
    warmColor = new THREE.Color('#ff9a55'),
    warmGain = 0.4,
    aurora,
    floor = new THREE.Color('#000000'),
  } = opts

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMapTint = { value: mapTint }
    shader.uniforms.uWarmColor = { value: warmColor }
    shader.uniforms.uWarmGain = { value: warmGain }
    shader.uniforms.uWarm = { value: WARM }
    shader.uniforms.uWarmCount = { value: warmCount }
    shader.uniforms.uFloor = { value: floor }
    if (aurora) {
      shader.uniforms.uWindTime = { value: 0 }
      shader.uniforms.uAurLow = { value: aurora.low }
      shader.uniforms.uAurMid = { value: aurora.mid }
      shader.uniforms.uAurHigh = { value: aurora.high }
      shader.uniforms.uAurGain = { value: aurora.gain }
    }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n varying vec3 vGroundWorld;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vGroundWorld;
       uniform vec3 uMapTint;
       uniform vec3 uWarmColor;
       uniform float uWarmGain;
       uniform vec4 uWarm[${MAX_WARM}];
       uniform int uWarmCount;
       uniform vec3 uFloor;
       ${
         aurora
           ? `uniform float uWindTime;
              uniform vec3 uAurLow;
              uniform vec3 uAurMid;
              uniform vec3 uAurHigh;
              uniform float uAurGain;
              vec3 groundAuroraRamp(float t) {
                return t < 0.5 ? mix(uAurLow, uAurMid, t * 2.0) : mix(uAurMid, uAurHigh, t * 2.0 - 1.0);
              }`
           : ''
       }`
    )

    if (desaturateMap > 0) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         // See GroundGlowOptions.desaturateMap — same trick as the blades: the
         // autumn map is baked warm/yellow for a daylit field, and a material
         // colour only multiplies that hue rather than replacing it.
         diffuseColor.rgb = mix(
           vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))),
           diffuseColor.rgb,
           ${(1 - desaturateMap).toFixed(4)}
         );
         diffuseColor.rgb *= uMapTint;`
      )
    }

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `{
         // Same gaussian pool the grass blades stand in, evaluated directly at
         // this fragment's ground position rather than interpolated from four
         // corners — see the function doc for why that matters here.
         float warmSum = 0.0;
         for (int i = 0; i < ${MAX_WARM}; i++) {
           if (i >= uWarmCount) break;
           vec4 L = uWarm[i];
           float d = distance(vGroundWorld.xz, L.xy);
           warmSum += L.w * exp(-(d * d) / (L.z * L.z));
         }
         gl_FragColor.rgb += uWarmColor * clamp(warmSum, 0.0, 1.3) * uWarmGain;
         ${
           aurora
             ? `// Flat weight — the ground has no crown to bias toward, unlike the
                // trees' height-weighted version. Slow bands by world position so
                // the colour drifts rather than reading as a static wash.
                float aurHue = 0.5 + 0.5 * sin(
                  vGroundWorld.x * 0.05 - vGroundWorld.z * 0.03 + uWindTime * 0.07);
                gl_FragColor.rgb += groundAuroraRamp(aurHue) * uAurGain;`
             : ''
         }
         // The floor: without it the plane past the fire and torches' reach is
         // lit by nothing at all and clips to pure black. See NIGHT.ambient for
         // why the scene-wide version of this stays this small.
         gl_FragColor.rgb += uFloor;
       }
       #include <fog_fragment>`
    )

    if (aurora) patched.push(shader as unknown as FoliageShader)
  }

  material.needsUpdate = true
  return material
}

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  // Handy check that the injection actually compiled: an empty list means the
  // material was replaced or the patch silently failed.
  ;(window as unknown as { __windShaders?: FoliageShader[] }).__windShaders = patched
}
