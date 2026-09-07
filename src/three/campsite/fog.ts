import * as THREE from 'three'

/* -------------------------------------------------------------------------- */
/*  Height fog, as a global shader-chunk override.                              */
/* -------------------------------------------------------------------------- */

/**
 * Three.js fog is distance-only: at a given range it tints a tree's canopy by
 * exactly as much as it tints its roots. Turn it up far enough to sink the far
 * treeline and it also puts a veil over the tents, the fire and the sky — which
 * is what the scene had, and why it read as hazy rather than as a cold night
 * with fog lying in it.
 *
 * The reference is fog *lying low*: thick where it pools at the foot of the
 * trees, thin at head height, absent above. That is a function of altitude as
 * well as distance, so the fog term needs the fragment's world height.
 *
 * Rather than patch every material through `onBeforeCompile`, this replaces the
 * four fog chunks once, at module load. Every material three.js compiles from
 * then on — the kit's, the ground's, the impostors' — picks the new version up,
 * and the renderer keeps feeding `fogColor` and `fogDensity` from the scene's
 * own `<fogExp2>` as usual.
 *
 * **Import this before anything creates a material.** Chunks are pasted in at
 * compile time, so a material compiled before the swap keeps the stock fog.
 */

/** Bottom and top of the user's ground-fog band, in world metres. */
const FOG_BOTTOM = -0.7
const FOG_BOTTOM_FEATHER = 0.9
const FOG_TOP = 4.8
const FOG_TOP_FEATHER = 1.35
/**
 * Nothing at all inside this range, ramping to full by FOG_FAR.
 *
 * The tents stand about twenty metres from the lobby camera, and fog on them
 * is what made the bank look like it was *cutting through* the canvas: a fog
 * that starts at the lens has to have a visible front somewhere, and wherever
 * that front crossed a tent it drew a line. Starting the whole term beyond the
 * camp means there is no front inside anything the eye is reading.
 */
// LIGHTING-REWORK (2026-08-17): FOG_NEAR 26->20, FOG_FAR 78->58. imagestats
// (item f) showed the treeline and tent-roof bands both reading noticeably
// *brighter* than the new target reference (treeline +19.9 lum, roof +13.4)
// — not receding. The lobby camera sits at world z=14 and the tents at
// z=-7.8 are ~22m away, so the old 26m gate left the whole near tree ring
// (as close as ~20m) unfogged. Pulled in just past the tents, and the far
// edge in to match — the old 78m span faded so gradually the far band never
// reached the fog colour at all. See LIGHTING_TUNING.md.
const FOG_NEAR = 20
const FOG_FAR = 58

let applied = false

export function installHeightFog() {
  if (applied) return
  applied = true

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
    #ifdef USE_FOG
      varying float vFogDepth;
      varying vec3 vFogWorld;
    #endif
  `

  // `transformed` and `instanceMatrix` are both in scope here: this chunk is
  // included after <begin_vertex> and <project_vertex> in every material the
  // scene uses. (Sprites are the one stock shader without `transformed`, and
  // there are none in this scene.)
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
    #ifdef USE_FOG
      vFogDepth = - mvPosition.z;
      #ifdef USE_INSTANCING
        vFogWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
      #else
        vFogWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
      #endif
    #endif
  `

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying float vFogDepth;
      varying vec3 vFogWorld;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif

      // Two octaves of value noise, prefixed so nothing here can collide with
      // a name another chunk or an onBeforeCompile patch has already used.
      float fogHash( vec2 p ) {
        return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
      }

      float fogNoise( vec2 p ) {
        vec2 i = floor( p );
        vec2 f = fract( p );
        vec2 u = f * f * ( 3.0 - 2.0 * f );
        return mix(
          mix( fogHash( i ), fogHash( i + vec2( 1.0, 0.0 ) ), u.x ),
          mix( fogHash( i + vec2( 0.0, 1.0 ) ), fogHash( i + vec2( 1.0, 1.0 ) ), u.x ),
          u.y
        );
      }
    #endif
  `

  /*
    The gate is evaluated *first* and everything else hangs off it.

    Two octaves of value noise is eight `sin` calls, and they were being run on
    every fragment of every fogged material in the scene — the whole field, the
    ground under it, the tents, the props — for a term that is then multiplied
    by a gate which is exactly zero inside twenty-six metres. That is most of
    the lower half of the frame paying for a number it throws away. The branch
    is on view depth, which is about as warp-coherent as a condition gets: a
    warp covers a few pixels, and a few pixels of a surface are all at nearly
    the same distance, so the two sides almost never both execute.

    The output is identical — this is the same expression with the zero case
    factored out.
  */
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
      // Nothing inside the camp. See FOG_NEAR.
      float fogGate = smoothstep( ${FOG_NEAR.toFixed(1)}, ${FOG_FAR.toFixed(1)}, vFogDepth );

      if ( fogGate > 0.0 ) {
        #ifdef FOG_EXP2
          float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
        #else
          float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
        #endif

        vec3 fogTarget = fogColor;

        // A true ground-hugging band. It reaches zero before the leaves begin,
        // with a broad feather instead of a horizontal shelf. The depth gate
        // above still keeps the whole band behind the tents.
        float fogBottom = smoothstep(
          ${FOG_BOTTOM.toFixed(3)},
          ${(FOG_BOTTOM + FOG_BOTTOM_FEATHER).toFixed(3)},
          vFogWorld.y
        );
        float fogTop = 1.0 - smoothstep(
          ${(FOG_TOP - FOG_TOP_FEATHER).toFixed(3)},
          ${FOG_TOP.toFixed(3)},
          vFogWorld.y
        );
        float fogH = fogBottom * fogTop;

        // Banks. A fog that is the same depth everywhere along the treeline reads
        // as a filter; two octaves of drift-free noise across the ground plane is
        // enough to make it lie in patches. Drift-free on purpose — fog that
        // visibly slides is more distracting than fog that simply sits.
        float fogBank =
          fogNoise( vFogWorld.xz * 0.030 ) * 0.68 +
          fogNoise( vFogWorld.xz * 0.085 ) * 0.32;
        fogH *= 0.62 + 0.72 * fogBank;

        float fogAmount = clamp( fogFactor * fogH * fogGate, 0.0, 1.0 );

        gl_FragColor.rgb = mix(
          gl_FragColor.rgb, fogTarget, fogAmount
        );
      }
    #endif
  `
}
