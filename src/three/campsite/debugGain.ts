import * as THREE from 'three'

/* -------------------------------------------------------------------------- */
/*  Debug-only gain multipliers for trees and grass, so the ?debug panel can    */
/*  brighten/darken the canopy and the field independently of the scene-wide    */
/*  hemisphere/ambient (which both currently light).                           */
/* -------------------------------------------------------------------------- */

export const TREE_GAIN = { value: 1 }
export const GRASS_GAIN = { value: 1 }

/**
 * Multiplies a material's final fragment colour by a live-mutable uniform.
 *
 * Composed onto whatever `onBeforeCompile` the material already has (same
 * pattern as `Ground()`'s `applyGroundGlow` + `applyParallax` chain in
 * CampHero.tsx) rather than assigned directly, since a bare assignment here
 * would silently discard `applyWind`'s own patch.
 */
export function attachDebugGain(material: THREE.Material, gain: { value: number }) {
  const prevCompile = material.onBeforeCompile?.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    prevCompile?.(shader, renderer)
    shader.uniforms.uDebugGain = gain
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n uniform float uDebugGain;`)
      .replace(
        '#include <dithering_fragment>',
        `gl_FragColor.rgb *= uDebugGain;\n #include <dithering_fragment>`
      )
  }
  material.needsUpdate = true
}
