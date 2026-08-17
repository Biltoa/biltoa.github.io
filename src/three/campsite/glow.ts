import * as THREE from 'three'

/**
 * Fresnel rim glow, patched into the tent's standard material.
 *
 * Emissive alone floods the whole canvas and flattens the texture. A rim term
 * lights the silhouette and the guy ropes — the geometry facing away from the
 * camera — which is what reads as "this one is selected" without washing the
 * fabric out.
 */

export interface GlowHandle {
  set(strength: number, color?: THREE.Color): void
  /** Last strength written, so callers can damp toward a target. */
  readonly value: number
}

export function applyRimGlow(material: THREE.Material, color: THREE.Color): GlowHandle {
  const mat = material as THREE.MeshStandardMaterial
  const uniforms = {
    uGlowStrength: { value: 0 },
    uGlowColor: { value: color.clone() },
  }

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlowStrength = uniforms.uGlowStrength
    shader.uniforms.uGlowColor = uniforms.uGlowColor

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vGlowNormal;
         varying vec3 vGlowView;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vGlowNormal = normalize(normalMatrix * normal);
         vGlowView = normalize(-(modelViewMatrix * vec4(transformed, 1.0)).xyz);`
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uGlowStrength;
         uniform vec3 uGlowColor;
         varying vec3 vGlowNormal;
         varying vec3 vGlowView;`
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         // Rim: bright where the surface turns away from the eye. Squared so
         // the falloff hugs the silhouette instead of tinting the whole face.
         float rim = 1.0 - clamp(dot(normalize(vGlowNormal), normalize(vGlowView)), 0.0, 1.0);
         // Tight. A tent is flat panels facing the camera, so anything gentler
         // than this spreads the term across the whole face and the tent reads
         // as a lit slab rather than as an outlined one. The exponent is what
         // keeps the highlight on the silhouette, the poles and the ropes.
         rim = pow(rim, 2.2);
         // Edges, not fabric.
         //
         // The rim is driven far over 1 on purpose: the highlight people
         // actually see is the halo the bloom pass throws off the edge, and a
         // value under the pass's threshold cannot produce one. So the *rim*
         // is hot and the flat pedestal is nearly nothing — just enough to find
         // the guy ropes, which are thin enough that they read as line
         // regardless.
         //
         // What used to be here added pow(rim, 0.62) * 6.0 and a flat 0.7
         // on top. Both are wide terms: a 0.62 exponent barely falls off at
         // all, and a constant does not fall off by definition. Together they
         // pushed the whole canvas past the bloom threshold, which is why a
         // hovered tent came out as a solid glowing block with the fabric,
         // the trim and the doorway all gone.
         gl_FragColor.rgb += uGlowColor * uGlowStrength * rim * 11.0;`
      )
  }

  mat.needsUpdate = true

  return {
    set(strength: number, next?: THREE.Color) {
      uniforms.uGlowStrength.value = strength
      if (next) uniforms.uGlowColor.value.copy(next)
    },
    get value() {
      return uniforms.uGlowStrength.value
    },
  }
}
