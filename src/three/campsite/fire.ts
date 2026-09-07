import * as THREE from 'three'

/* -------------------------------------------------------------------------- */
/*  Procedural flame + smoke materials.                                         */
/*                                                                              */
/*  The pack's own fire textures are single-channel masks (black RGB, opaque    */
/*  alpha) so they cannot be used as sprites, and a hand-painted canvas sprite   */
/*  only ever animates by scaling — the silhouette stays frozen. Doing the       */
/*  flame in a fragment shader means the *shape* is what moves: turbulence       */
/*  eats the tip, the tongue leans, the core stays hot. Same approach as         */
/*  THREE.Fire, but with the noise generated in GLSL rather than sampled from a  */
/*  ramp texture, so nothing extra ships.                                       */
/* -------------------------------------------------------------------------- */

const NOISE = /* glsl */ `
  float fhash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float fnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(fhash(i), fhash(i + vec2(1.0, 0.0)), u.x),
      mix(fhash(i + vec2(0.0, 1.0)), fhash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float ffbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * fnoise(p);
      p = p * 2.02 + 3.17;
      a *= 0.5;
    }
    return v;
  }
`

const FLAME_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FLAME_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uFlicker;
  uniform float uSeed;
  uniform float uDetail;
  uniform float uOpacity;
  uniform float uRise;
  uniform float uAlphaPower;
  uniform float uBrightness;
  uniform float uHeatBias;
  uniform vec3 uCore;
  uniform vec3 uMid;
  uniform vec3 uEdge;

  ${NOISE}

  void main() {
    vec2 uv = vUv;
    float y = uv.y;

    // Two turbulence layers climbing at different rates. One layer alone reads
    // as a texture being scrolled; two beating against each other reads as gas.
    float n1 = ffbm(vec2(uv.x * 2.6 * uDetail + uSeed, y * 2.1 * uDetail - uTime * uRise));
    float n2 = ffbm(vec2(uv.x * 5.6 * uDetail - uSeed * 1.7, y * 4.3 * uDetail - uTime * uRise * 1.8));
    float turb = n1 * 0.66 + n2 * 0.34;

    // Width envelope along the wick's axis: zero at the wick, bulging out
    // through the lower third, tapering to a point at the tip. sin(pi * y)
    // is already zero at both y=0 and y=1 with a bulge at y=0.5; warping y
    // through a fractional power first drags that bulge down to about a
    // third of the way up, which is where a real flame is fattest, and
    // leaves the long tapered run above it that ends in a point rather than
    // getting sliced off flat.
    float yWarp = pow(clamp(y, 0.0, 1.0), 0.62);
    float width = pow(max(sin(3.14159265 * yWarp), 0.0), 0.85);
    float sway = (turb - 0.5) * (0.45 + y * 1.7);
    float x = (uv.x - 0.5 + sway * 0.30) / max(width * 0.52, 0.001);
    float radial = abs(x);

    // width already carries the flame to zero at both the wick and the
    // tip, so multiplying it back in here is what keeps that pinch clean
    // instead of leaving a thin sliver at the seam where radial blows up
    // against the divide-by-near-zero floor above.
    float body = (1.0 - smoothstep(0.30, 1.02, radial)) * width;
    // Torn tip: the same turbulence that bends the flame also eats its top.
    float tip = 1.0 - smoothstep(0.34 + turb * 0.62, 1.0, y);

    float shapedBody = pow(clamp(body, 0.0, 1.0), uAlphaPower);
    float a = shapedBody * tip * (0.82 + 0.32 * uFlicker) * uOpacity;
    if (a < 0.004) discard;

    // Heat runs hottest low and dead centre; that is what puts a white core in
    // the fire instead of a uniformly orange blob.
    float heat = clamp(body * 1.45 - y * 0.9 + turb * 0.22 - uHeatBias, 0.0, 1.0);
    vec3 col = mix(uEdge, uMid, smoothstep(0.04, 0.48, heat));
    col = mix(col, uCore, smoothstep(0.56, 0.99, heat));

    // The blue-white ring right at the wick, where the flame runs hottest
    // and least luminous — the thing that reads as "candle" rather than
    // "orange smear" in a reference photo. Fades out by a fifth of the way
    // up and only shows near the centreline, not out at the flanks.
    float blueZone = (1.0 - smoothstep(0.0, 0.22, y)) * (1.0 - smoothstep(0.0, 0.55, radial));
    col = mix(col, vec3(0.32, 0.52, 1.0), blueZone * 0.6);

    // Alpha-composited and tone mapped. Additive crossed planes sum to white at
    // the centre and bloom into a bulb; normal compositing preserves the hot
    // yellow/orange/red ramp and keeps the silhouette readable.
    gl_FragColor = vec4(col * (0.82 + 0.18 * uFlicker) * uBrightness, a);
  }
`

export interface FlameOptions {
  seed?: number
  /** Noise frequency. A torch is small, so its detail has to be finer. */
  detail?: number
  opacity?: number
  /** How fast the turbulence climbs. */
  rise?: number
  /** Higher values narrow translucent edges without hard clipping them. */
  alphaPower?: number
  /** Source-specific radiance control; defaults preserve torch/candle output. */
  brightness?: number
  /** Opt-in luminous blending for large fire only; torches stay alpha blended. */
  additive?: boolean
  /** Pushes pale core colour toward the lower centre of large flames. */
  heatBias?: number
  core?: string
  mid?: string
  edge?: string
}

export function makeFlameMaterial(opts: FlameOptions = {}) {
  const {
    seed = 0,
    detail = 1,
    opacity = 1,
    rise = 1.45,
    alphaPower = 1,
    brightness = 1,
    additive = false,
    heatBias = 0,
    core = '#ffeeb4',
    mid = '#ff9a1c',
    edge = '#b52605',
  } = opts

  return new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uFlicker: { value: 1 },
      uSeed: { value: seed },
      uDetail: { value: detail },
      uOpacity: { value: opacity },
      uRise: { value: rise },
      uAlphaPower: { value: alphaPower },
      uBrightness: { value: brightness },
      uHeatBias: { value: heatBias },
      uCore: { value: new THREE.Color(core) },
      uMid: { value: new THREE.Color(mid) },
      uEdge: { value: new THREE.Color(edge) },
    },
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: !additive,
    fog: false,
  })
}

/* ------------------------------------------------------------------- smoke */

const SMOKE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uLife;
  uniform float uSeed;
  uniform vec3 uColor;
  uniform float uOpacity;

  ${NOISE}

  void main() {
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;
    // Soft round puff, eaten by noise so the silhouette is ragged rather than
    // a perfect circle. Older puffs dissolve rather than just fading.
    float n = ffbm(vec2(vUv * 3.4 + uSeed) + vec2(0.0, -uTime * 0.25));
    float edge = 1.0 - smoothstep(0.25, 1.0, d + (n - 0.5) * 0.85);
    float dissolve = smoothstep(0.0, 0.55, 1.0 - uLife) * smoothstep(0.0, 0.16, uLife);
    float a = edge * dissolve * uOpacity;
    if (a < 0.004) discard;
    // Newly emitted smoke is only subtly warmed by the fire. A saturated
    // orange birth colour turns overlapping puffs into a second flame-shaped
    // column and obscures the actual tongues beneath it.
    vec3 col = mix(vec3(0.38, 0.34, 0.31), uColor, smoothstep(0.0, 0.32, uLife));
    gl_FragColor = vec4(col, a);
  }
`

/**
 * A single faint thread of smoke, for a candle rather than a bonfire.
 *
 * The campfire's smoke is round puffs because a fire that size sheds them —
 * six flames' worth of plume breaks up into billows before it has risen a
 * metre. A candle's is one continuous thread: still air, one wick, nothing to
 * break it into puffs. Drawn as a thin ribbon whose centreline wanders under
 * noise rather than as a stack of circles, because a chain of round blobs at
 * candle scale reads as beads on a string, not as a curl of smoke.
 */
const SMOKE_LINE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uLife;
  uniform float uSeed;
  uniform vec3 uColor;
  uniform float uOpacity;

  ${NOISE}

  void main() {
    vec2 uv = vUv;
    float y = uv.y;

    // The thread drifts sideways as it climbs, and curls back on itself under
    // a slower second layer — a plain sideways lean reads as a flag in the
    // wind, not as smoke finding its own way up.
    float drift = (ffbm(vec2(uSeed, y * 2.2 - uTime * 0.5)) - 0.5) * 0.9 * smoothstep(0.0, 0.25, y);
    float curl = sin(y * 6.0 + uSeed * 3.1 - uTime * 0.9) * 0.12 * y;
    float cx = 0.5 + drift + curl;
    float dx = uv.x - cx;

    // Thin at the wick, slowly diffusing as it rises — and eaten by its own
    // noise along the way, so the ribbon frays instead of staying a clean
    // stroke top to bottom.
    float edgeNoise = ffbm(vec2(uv.x * 5.0 + uSeed * 2.0, y * 4.5 - uTime * 0.7));
    float width = mix(0.035, 0.16, y) + (edgeNoise - 0.5) * 0.05;
    float body = 1.0 - smoothstep(width * 0.35, width, abs(dx));

    // Fades in just above the tip and dissolves well before the top of the
    // quad, so there is no hard edge to the plume — and the whole thing comes
    // and goes with uLife the way the campfire's puffs do, so it is never
    // the same thread twice.
    float fadeBottom = smoothstep(0.0, 0.1, y);
    float fadeTop = 1.0 - smoothstep(0.45, 0.95, y);
    float dissolve = smoothstep(0.0, 0.5, 1.0 - uLife) * smoothstep(0.0, 0.12, uLife);
    float a = body * fadeBottom * fadeTop * dissolve * uOpacity;
    if (a < 0.003) discard;

    gl_FragColor = vec4(uColor, a);
  }
`

export function makeSmokeLineMaterial(seed = 0, color = '#cfc7d6', opacity = 0.3) {
  return new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: SMOKE_LINE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uLife: { value: 0 },
      uSeed: { value: seed },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  })
}

export function makeSmokeMaterial(seed = 0, color = '#c9b6cf', opacity = 0.38) {
  return new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: SMOKE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uLife: { value: 0 },
      uSeed: { value: seed },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  })
}

/* ---------------------------------------------------------- torch smoke */

/**
 * Smoother than the campfire puff: torch smoke is seen as a narrow continuous
 * plume, so high-frequency edge breakup reads as torn polygons at this scale.
 * A low-frequency warp keeps the contour alive while the broad feathered edge
 * lets neighbouring particles blend into one soft wisp.
 */
const TORCH_SMOKE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uLife;
  uniform float uSeed;
  uniform vec3 uColor;
  uniform float uOpacity;

  ${NOISE}

  // Curl of a scalar noise potential: the perpendicular gradient produces a
  // divergence-free 2D velocity field, which gives smoke rolling motion
  // without repeatedly swelling and shrinking like an ordinary noise warp.
  vec2 curlField(vec2 p) {
    float e = 0.075;
    float dNoiseDx = fnoise(p + vec2(e, 0.0)) - fnoise(p - vec2(e, 0.0));
    float dNoiseDy = fnoise(p + vec2(0.0, e)) - fnoise(p - vec2(0.0, e));
    return vec2(dNoiseDy, -dNoiseDx) / (2.0 * e);
  }

  void main() {
    float density = 0.0;
    float warmDensity = 0.0;

    // Repeated density injection at the flame. Each lobe rises under buoyancy,
    // expands as it cools, follows the same slow wind, and receives a curl-noise
    // displacement. Their soft union creates folds and billows while remaining
    // a coherent plume instead of a line or a stack of sprites.
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float age = fract(uTime * 0.082 + fi / 8.0 + fract(uSeed * 0.137));
      float buoyantRise = pow(age, 0.72);
      float inject = smoothstep(0.0, 0.09, age);
      float dissipate = 1.0 - smoothstep(0.68, 1.0, age);

      vec2 curl = curlField(vec2(buoyantRise * 1.7 - uTime * 0.035, uSeed * 0.19));
      curl = clamp(curl * 0.16, vec2(-1.0), vec2(1.0));
      float windDirection = sin(uTime * 0.085) * 0.09 + sin(uTime * 0.031 + 1.7) * 0.04;
      float wind = buoyantRise * buoyantRise * windDirection;
      float roll = sin(buoyantRise * 8.5 + uTime * 0.28 + uSeed) * 0.21 * buoyantRise;
      float localEddy =
        sin(fi * 2.4 + uSeed * 1.3 + uTime * 0.12) *
        smoothstep(0.38, 1.0, buoyantRise) *
        0.042;

      vec2 centre = vec2(
        0.5 + wind + curl.x * 0.16 * buoyantRise + roll + localEddy,
        0.025 + buoyantRise * 0.91 + curl.y * 0.035 * buoyantRise
      );
      float radiusX = mix(0.045, 0.17, buoyantRise) * (0.92 + 0.08 * sin(fi * 2.4 + uSeed));
      float radiusY = radiusX * mix(1.45, 1.0, buoyantRise);
      vec2 local = (vUv - centre) / vec2(radiusX, radiusY);
      local += curl * 0.075 * buoyantRise;

      float lobe = exp(-dot(local, local) * 1.7) * inject * dissipate;
      density += lobe;
      warmDensity += lobe * (1.0 - age);
    }

    // Optical-density union: overlapping injections merge smoothly without
    // clipping brighter where they intersect. Very low-frequency modulation
    // adds internal folds but never cuts holes through the silhouette.
    density = 1.0 - exp(-density * 0.92);
    float fold = 0.82 + ffbm(vec2(vUv * vec2(1.25, 2.1) + vec2(uSeed, -uTime * 0.07))) * 0.18;
    float edgeFade = smoothstep(0.0, 0.025, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
    // Retain definition close to the flame, then shed density quickly. By the
    // upper half only ten percent remains, preventing a dark cloud from hanging
    // visibly above each torch against the night canopy.
    float heightFade = mix(1.0, 0.1, smoothstep(0.34, 0.58, vUv.y));
    float alpha = density * fold * edgeFade * heightFade * uOpacity;
    if (alpha < 0.002) discard;

    vec3 warmGrey = vec3(0.33, 0.31, 0.29);
    float warmth = clamp(warmDensity / max(density, 0.001), 0.0, 1.0);
    vec3 colour = mix(uColor, warmGrey, warmth * 0.45);
    gl_FragColor = vec4(colour, alpha);
  }
`

export function makeTorchSmokeMaterial(seed = 0, color = '#414a54', opacity = 0.05) {
  return new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: TORCH_SMOKE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uLife: { value: 0 },
      uSeed: { value: seed },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
    fog: false,
  })
}

/* ------------------------------------------------------------------ flicker */

/**
 * One flicker value for the whole camp, so the point lights, the flame shaders
 * and the grass firelight term all agree. Layered sines rather than random():
 * random strobes at 60fps, a real fire breathes.
 */
export function fireFlicker(t: number) {
  return (
    0.8 +
    Math.sin(t * 11.3) * 0.085 +
    Math.sin(t * 4.7 + 1.3) * 0.075 +
    Math.sin(t * 23.1) * 0.035 +
    // Two slow, mutually irrational terms. Without them the sum above repeats
    // on a period short enough to hear as a pulse: three sines whose rates are
    // near-multiples of each other beat back into phase every few seconds, and
    // once the eye has found that beat the fire stops reading as a fire. These
    // two never come back round, and they are slow enough to read as the log
    // catching rather than as noise.
    Math.sin(t * 0.6180339 + 2.1) * 0.055 +
    Math.sin(t * 1.7320508 + 0.7) * 0.04
  )
}

/**
 * Colour temperature of the flame, 0 cool-orange to 1 hot-yellow.
 *
 * A real fire does not only get brighter and dimmer: the flare that lifts the
 * intensity also shifts the light up the blackbody curve, and the two moving
 * together is most of what separates firelight from a lamp on a dimmer. Kept on
 * its own rates so it leads and lags the intensity rather than tracking it.
 */
export function fireTemp(t: number) {
  return (
    0.5 +
    Math.sin(t * 3.1 + 0.4) * 0.22 +
    Math.sin(t * 0.9137 + 1.9) * 0.18 +
    Math.sin(t * 7.7) * 0.1
  )
}
