import * as THREE from 'three'

/* -------------------------------------------------------------------------- */
/*  Debug-only gain multipliers for trees and grass, so the ?debug panel can    */
/*  brighten/darken the canopy and the field independently of the scene-wide    */
/*  hemisphere/ambient (which both currently light).                           */
/* -------------------------------------------------------------------------- */

// LIGHTING-REWORK (2026-08-17): defaults baked from the ?debug panel at the
// user's request — treeGain 1->1.05, grassGain 1->0.68.
export const TREE_GAIN = { value: 1.05 }
export const GRASS_GAIN = { value: 0.68 }

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
