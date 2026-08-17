import * as THREE from 'three'

/**
 * Neon outline for a hovered tent, as an inverted hull.
 *
 * **Why not a Fresnel rim.** A Fresnel term is bright where the surface turns
 * away from the eye, and a tent is four flat panels pointing more or less
 * straight at the camera. There is no grazing angle anywhere on it except a
 * pixel or two right at the silhouette, so a rim strong enough to be *seen* is
 * a rim wide enough to have crept across the whole face — which is what the
 * hover highlight had become: a solid glowing slab with the stripes, the trim
 * and the doorway all washed out of it.
 *
 * **Why not the post-processing Outline pass.** It draws exactly the right
 * picture, and it costs a depth pre-pass, a mask render and a two-stage blur on
 * *every* frame the scene ever renders, for something on screen a second at a
 * time.
 *
 * **What this is.** The tent's own geometry, drawn a second time, with the
 * vertices pushed out along their normals and only the back faces kept. Where
 * the swollen copy is behind the real tent the depth test throws it away; where
 * it pokes out past the silhouette it survives, as a band of constant width
 * running round the edge — over the roof ridge, down the poles, along the guy
 * ropes. One extra draw per hovered tent, nothing at all when nothing is
 * hovered, and the colour is driven far enough over 1 that the bloom pass that
 * is already running throws the halo off it.
 *
 * The shell writes no depth and takes no lighting: it is a flat emissive band,
 * which is what a neon outline is.
 */
export function makeOutlineShell(color: THREE.Color) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      /** 0 when not hovered — the mesh is hidden outright at that point. */
      uStrength: { value: 0 },
      /**
       * Push along the normal, in the tent's own object units (scale 0.62), so
       * about 3 to 4 screen pixels from the lobby camera. Wide enough to read
       * as a drawn line, narrow enough that it never becomes a second tent.
       */
      uThickness: { value: 0.028 },
    },
    vertexShader: /* glsl */ `
      uniform float uThickness;
      void main() {
        vec3 swollen = position + normal * uThickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( swollen, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      void main() {
        // Well past the bloom threshold on purpose. See the note above.
        gl_FragColor = vec4( uColor * uStrength * 3.0, uStrength );
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })

  return {
    material,
    set(strength: number) {
      material.uniforms.uStrength.value = strength
    },
  }
}
