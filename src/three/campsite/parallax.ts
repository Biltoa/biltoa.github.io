import * as THREE from 'three'

/**
 * Parallax occlusion mapping for the trodden earth around the fire.
 *
 * The disc used to be the grass colour map tinted brown, which at this camera
 * angle is a flat wash across the middle of the frame — the one large surface
 * in the scene with nothing on it. A normal map alone does not fix that: the
 * disc is looked at from a low angle, and at low angles a normal map only
 * shifts shading, so the ground still reads as painted.
 *
 * This marches the view ray through a height field and returns the UV where it
 * meets the surface, so ruts genuinely occlude what is behind them and the
 * silhouette of a stone shifts as the camera moves.
 *
 * The patch is injected into the kit's own MeshStandardMaterial rather than
 * replacing it, so the scene's lights, the fog and the fire's pool of light all
 * still apply.
 *
 * It assumes a **flat, horizontal, +Y-facing** surface whose UVs run along
 * world +X and world -Z — i.e. a PlaneGeometry or CircleGeometry rotated -90
 * degrees about X, which is how every ground plane here is built. That lets the
 * tangent frame be written out as a constant instead of being derived per
 * fragment from screen-space derivatives, which is both cheaper and free of the
 * seams the derivative version leaves along UV discontinuities.
 */

export interface ParallaxOptions {
  /** Depth of the height field, in UV units. Sane range 0.01 - 0.06. */
  depth?: number
  /** Ray-march steps at grazing angles. Falls to a quarter of this head-on. */
  steps?: number
  /** How much the height field darkens the crevices. 0 disables. */
  occlusion?: number
}

export function applyParallax(material: THREE.Material, opts: ParallaxOptions = {}) {
  const { depth = 0.03, steps = 28, occlusion = 0.55 } = opts
  const mat = material as THREE.MeshStandardMaterial

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPomDepth = { value: depth }
    shader.uniforms.uPomSteps = { value: steps }
    shader.uniforms.uPomOcclusion = { value: occlusion }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vPomWorld;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vPomWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uPomDepth;
         uniform float uPomSteps;
         uniform float uPomOcclusion;
         varying vec3 vPomWorld;

         /* Height comes from the colour map's luminance, inverted: on a ground
            texture the crevices are the dark pixels, so the albedo already is a
            height field and no extra map has to be downloaded.

            A macro rather than a function because <common> is included before
            <map_pars_fragment>, so \`map\` does not exist yet at this point in
            the shader — only where the macro is expanded, further down. */
         #define pomHeight(_uv) (1.0 - dot(texture2D(map, _uv).rgb, vec3(0.299, 0.587, 0.114)))`
      )
      .replace(
        '#include <map_fragment>',
        `// Ray direction in the surface's own frame. The surface is flat and
         // horizontal, so its tangent frame is (+X, -Z, +Y) everywhere.
         vec3 pomEye = normalize(cameraPosition - vPomWorld);
         vec3 pomRay = vec3(pomEye.x, -pomEye.z, max(pomEye.y, 0.12));

         // More steps at grazing angles, where the ray crosses more of the
         // height field per unit of depth and stepping coarsely shows as
         // stair-casing along every rut.
         float pomN = mix(uPomSteps, uPomSteps * 0.25, pomRay.z);
         vec2 pomStep = (pomRay.xy / pomRay.z) * uPomDepth / pomN;
         float pomLayer = 1.0 / pomN;

         vec2 pomUv = vMapUv;
         float pomDepthNow = 0.0;
         float pomSurface = pomHeight(pomUv);
         for (int i = 0; i < 64; i++) {
           if (float(i) >= pomN || pomDepthNow >= pomSurface) break;
           pomUv -= pomStep;
           pomSurface = pomHeight(pomUv);
           pomDepthNow += pomLayer;
         }

         // One secant refinement. Without it the hit lands on a layer boundary
         // and the ruts get visible contour banding.
         vec2 pomPrev = pomUv + pomStep;
         float pomAfter = pomSurface - pomDepthNow;
         float pomBefore = pomHeight(pomPrev) - pomDepthNow + pomLayer;
         pomUv = mix(pomUv, pomPrev, clamp(pomAfter / (pomAfter - pomBefore), 0.0, 1.0));

         vec4 sampledDiffuseColor = texture2D(map, pomUv);
         diffuseColor *= sampledDiffuseColor;
         // Cavity darkening, so the depth survives being lit by a single warm
         // point light that reaches the whole disc almost evenly.
         diffuseColor.rgb *= 1.0 - uPomOcclusion * clamp(pomHeight(pomUv), 0.0, 1.0);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
         #ifdef USE_ROUGHNESSMAP
           roughnessFactor *= texture2D(roughnessMap, pomUv).g;
         #endif`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_TANGENTSPACE
           vec3 pomN2 = texture2D(normalMap, pomUv).xyz * 2.0 - 1.0;
           pomN2.xy *= normalScale;
           // Constant tangent frame, then straight into view space, which is
           // where the rest of the shader expects \`normal\` to be.
           vec3 pomWorldN =
             normalize(pomN2.x * vec3(1.0, 0.0, 0.0) +
                       pomN2.y * vec3(0.0, 0.0, -1.0) +
                       pomN2.z * vec3(0.0, 1.0, 0.0));
           normal = normalize((viewMatrix * vec4(pomWorldN, 0.0)).xyz);
         #endif`
      )
  }

  mat.needsUpdate = true
  return mat
}
