import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { AURORA_BOUNCE_HIGH, AURORA_BOUNCE_LOW, AURORA_BOUNCE_MID, applyWind } from './wind'

/**
 * Loader + helpers for the campsite kit.
 *
 * The GLB is built by tools/export-campsite.py from the Dreamscape Campsite
 * Unity pack, patched by tools/fix-alpha.mjs, then cut down to what the scene
 * actually places by tools/strip-kit.mjs. Anything added to the scene has to be
 * added to that script's keep list too, or the export will not contain it.
 *
 * Node names in the shipped kit:
 *   Tent, TreeA, TreeB, TreeC, GrassA, GrassB, Flowers_0, Flowers_1,
 *   Firewood, FireRocks, Lamp, Bench, Stone, Torch, Pillow7, SleepingBag1,
 *   Backpack
 */

export const KIT_URL = '/models/campsite-kit.glb'

export interface Part {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

/** A glTF mesh with several primitives arrives as a Group of Meshes. */
export function collectParts(node: THREE.Object3D | undefined): Part[] {
  if (!node) return []
  const out: Part[] = []
  node.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      for (const mat of mats) out.push({ geometry: m.geometry, material: mat })
    }
  })
  return out
}

export function useKit() {
  const gltf = useGLTF(KIT_URL)
  const { gl } = useThree()

  return useMemo(() => {
    const byName = new Map<string, THREE.Object3D>()
    gltf.scene.traverse((o) => byName.set(o.name, o))

    const part = (name: string) => collectParts(byName.get(name))

    /*
      Anisotropic filtering on every map the kit ships.

      glTF textures arrive at anisotropy 1, which is trilinear: the hardware
      picks one mip level for the whole fragment, so a surface seen at a glancing
      angle — the bench under the journal, the ground the camp stands on, the
      side of a tent — samples a mip chosen for its *narrow* axis and comes out
      soft in the other. It is the single cheapest sharpness in the renderer and
      it is why the table read as a low-resolution texture no matter how large
      the map was.
    */
    const maxAniso = gl.capabilities.getMaxAnisotropy()
    const aniso = Math.min(16, maxAniso)
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const m = mat as THREE.MeshStandardMaterial
        for (const map of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.emissiveMap]) {
          if (map && map.anisotropy !== aniso) {
            map.anisotropy = aniso
            map.needsUpdate = true
          }
        }
      }
    })

    // Foliage reads as cardboard without two-sided rendering, and the pack
    // authors its leaves as single-sided cards. Alpha cutout itself is set in
    // the GLB by tools/fix-alpha.mjs.
    //
    // **Cards only.** This used to run over every primitive of a tree, which
    // includes the trunk — and a trunk is a closed solid, so two-sided is not a
    // thing you can see, only a thing you pay for: with back-face culling off,
    // the far wall of every trunk in the wood is rasterised and shaded through
    // a full standard-material evaluation with fourteen lights in it, then
    // thrown away by the depth test. Seventy-one trunks' worth. Slot 0 is the
    // bark in this kit; every slot after it is leaf cards, and `treeParts`
    // below sets `DoubleSide` on those explicitly when it rebuilds them.
    for (const name of ['TreeA', 'TreeB', 'TreeC']) {
      part(name).forEach((p, i) => {
        if (i === 0) return
        ;(p.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
      })
    }
    for (const name of ['GrassA', 'GrassB']) {
      for (const p of part(name)) {
        ;(p.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
      }
    }

    // The pack ships the lantern, the burning firewood and the glassware with
    // high emissive strength for Unity's HDR pipeline. Left alone they dominate
    // the bloom — the shelf's jars came out as flat magenta and green blocks
    // with no shape at all.
    for (const [name, intensity] of [
      ['Lamp', 0.45],
      ['Firewood', 1.6],
      ['Jar', 0.22],
      ['Potion', 0.22],
      ['Torch', 0.4],
    ] as const) {
      for (const p of part(name)) {
        ;(p.material as THREE.MeshStandardMaterial).emissiveIntensity = intensity
      }
    }

    // The pack's grass is authored for daylight, so it needs pulling down into
    // a night palette.
    //
    // The field is *blue* by default and warm only where a flame actually
    // reaches it — see `setWarmLights` in wind.ts, which hands the blade shader
    // the camp's real light positions. The previous pass tinted the whole
    // clearing one warm value from the coals out to the treeline, which is what
    // made the grass read as an orange carpet under a blue sky.
    //
    // Lambert, not Standard, and for the same reason the tree leaves are — but
    // it matters far more here. The field is the largest thing in frame by
    // fragment count: several thousand alpha-cutout blades, several layers
    // deep over the whole bottom half of the picture, and alpha cutout is the
    // one case where the depth test cannot reject a fragment before shading it.
    // Every one of those fragments was running a full PBR evaluation — a GGX
    // lobe per light, across nine lights — for a surface whose roughness is 1
    // and whose specular response is therefore a flat, colourless sheen nobody
    // would miss. Lambert has no specular term at all.
    const grassCache = new Map<string, Part[]>()
    const grassParts = (name: 'GrassA' | 'GrassB'): Part[] => {
      const cached = grassCache.get(name)
      if (cached) return cached
      const out = part(name).map((p) => {
        const src = p.material as THREE.MeshStandardMaterial
        const m = new THREE.MeshLambertMaterial({
          map: src.map,
          // White, deliberately: the hue is `mapTint` below, applied after the
          // map has been flattened. A colour left here would be greyed along
          // with the straw it is trying to overrule. See WindOptions.
          color: new THREE.Color('#ffffff'),
          alphaTest: src.alphaTest,
          transparent: src.transparent,
          side: THREE.DoubleSide,
        })
        applyWind(m, {
          amplitude: 0.075,
          speed: 1.9,
          height: 0.4,
          firelight: true,
          // Most of the way to grey. Enough of the map's own colour survives to
          // keep the blades from looking printed, and not enough for the straw
          // to come back through the tint.
          desaturateMap: 0.68,
          /*
            The field's actual colour, and it is *rust*, not green.

            Sampling the reference frame across the clearing gives rgb(61,6,2)
            in the fire's pool, rgb(25,4,7) at the front of frame and
            rgb(17,3,6) in the corners: the green channel is under ten
            everywhere. That is not a green field lit warm — a green field lit
            warm still has green in the parts the fire does not reach — it is
            dead autumn grass with a fire standing on it, and the only light in
            the clearing is the fire.

            A green tint here was costing twice: the lit half came out olive
            because green survives an orange light better than red does, and the
            unlit half came out grey-green because there is nothing else out
            there to give it a hue.
          */
          mapTint: new THREE.Color('#5ea23e'),
          // The soil end. Still the ambient occlusion under every tent, bench
          // and trunk that no shadow map at this scale can draw.
          rootTint: new THREE.Color('#1c0d07'),
          // And the moonlit tips. Warm-dark rather than the old blue-green:
          // the far field in the reference is near-black with a red cast, not
          // a cool one, because nothing cold reaches the floor of a clearing.
          tipTint: new THREE.Color('#3f4a2c'),
          coolGain: 0.60,
          // The fire and six torches are the only warm light in the clearing
          // and the field is what they are standing in; a camp whose grass does
          // not change colour toward the coals reads as a green carpet with
          // lamps on it. But this is an *additive* term over a field that the
          // fire's point light is already lighting warm, so it stacks on top of
          // real firelight rather than replacing it — at 0.85 the two together
          // took the whole foreground to straw.
          warmGain: 0.11,
          // Redder than the old amber. The pool in the reference runs to
          // rgb(133,46,18) at its brightest — nearly two stops of red over
          // green — and an amber light on a rust field lands on orange, not on
          // that.
          warmColor: new THREE.Color('#ff9a55'),
          // The ramp between a blade at the treeline and a blade at the fire is
          // a colour ramp the whole way rather than a switch at the end of one.
          warmTint: new THREE.Color('#f0a56e'),
        })
        return { geometry: p.geometry, material: m }
      })
      grassCache.set(name, out)
      return out
    }

    /* --------------------------------------------------------- tree tints */

    // One material per species, tinted per instance.
    //
    // The first cut cloned a leaf material for every (species, colour) pair,
    // which turned 55 trees into 30 draw calls of two-to-six instances each and
    // compiled a separate shader program for every one of them. InstancedMesh
    // carries a per-instance colour that multiplies into diffuse, so the same
    // spread of autumn colours costs one material per species instead.
    const leafCache = new Map<string, Part[]>()

    const treeParts = (species: 'TreeA' | 'TreeB' | 'TreeC'): Part[] => {
      const cached = leafCache.get(species)
      if (cached) return cached

      const out = part(species).map((p, i) => {
        // Slot 0 is bark. Left at MeshStandardMaterial (it is a closed solid,
        // not a card, so the specular-lobe problem below does not apply) but
        // it was getting none of the floor the canopy above it gets — same
        // moon, same hemisphere, nothing else — so every trunk read as a
        // black stripe under a lit crown. Same flat night-sky floor as the
        // leaves, just without a map to carry it through.
        if (i === 0) {
          const bark = p.material as THREE.MeshStandardMaterial
          bark.emissive = new THREE.Color('#2a1f1a')
          bark.emissiveIntensity = 0.42
          return p
        }
        const src = p.material as THREE.MeshStandardMaterial
        // Lambert, not Standard — and this is the single biggest thing wrong
        // with how the wood was reading.
        //
        // A leaf card is one triangle pair with no normal map and no roughness
        // map, so the only thing MeshStandardMaterial's specular lobe can do
        // with it is put a flat, colourless sheen across the whole canopy. At
        // 0.04 reflectance that sounds like nothing; summed over a key, a rim,
        // a bounce and a hemisphere it was brighter than the leaf's own diffuse
        // — which is why the forest came out pale silver-blue *whatever* the
        // tints were set to, and why darkening the albedo did nothing at all.
        // Lambert has no specular term, so the canopy is its own colour again.
        const m = new THREE.MeshLambertMaterial({
          map: src.map,
          color: src.color.clone(),
          alphaTest: src.alphaTest,
          transparent: src.transparent,
          side: THREE.DoubleSide,
          // A floor under the canopy, in the colour of the sky.
          //
          // The moon is behind the camp, so every tree the reader is looking at
          // is back-lit and the face turned toward the lens receives the
          // hemisphere term and nothing else — which took the near wood to
          // literal black. This is the sky lighting the leaves, which no light
          // in the scene reaches out to do, and it is a floor rather than a
          // lift: it does nothing at all to a canopy that is already lit.
          //
          // Through the leaf map, not flat. A constant emissive is the same
          // value on every fragment of the canopy, which fills the silhouette
          // in and turns fifty trees into fifty cutouts — the exact thing the
          // per-instance tints exist to avoid.
          // Down hard, and this is most of why the wood read as grey.
          //
          // A constant emissive is the same value on every fragment of every
          // canopy of a species — fifty trees receiving one flat navy, at an
          // intensity that made it the largest single term in the forest. It
          // *was* the floor under the wood, so it cannot simply go; but the
          // aurora bounce below does the same job with a colour that varies by
          // position and height, so the floor moves from it to that.
          // Not navy. Sampling the reference's canopies gives rgb(1,4,13) on the
          // left, rgb(15,1,7) on the right and rgb(23,6,16) in the middle — red
          // *above* blue everywhere except the far left, because what reaches
          // that wood is torchlight and the violet end of the display, not a
          // blue sky. A navy floor here is what made every tree read as a
          // cut-out against the aurora rather than as part of the same night.
          emissive: new THREE.Color('#191a26'),
          emissiveIntensity: 0.27,
          emissiveMap: src.map,
        })
        applyWind(m, {
          amplitude: 0.16,
          speed: 0.85,
          height: 22,
          // Firelight on the near wood.
          //
          // The point lights cannot do this: the campfire's reach is eleven
          // metres, chosen so it does not pour through the tent doorways, and
          // the first rank of trees starts at about six — so the wood was lit
          // by the moon and the sky alone and came out cold against a camp that
          // is entirely warm. This is the same falloff the grass uses, read at
          // a canopy's scale, which is what puts the amber on the trunks and
          // low branches around the clearing.
          firelight: true,
          warmOnly: true,
          // A blade's radii, widened for something ten metres up and twenty
          // out: the fire reaches about twelve metres of wood, a torch about
          // seven.
          warmReach: 2.3,
          warmGain: 0.16,
          warmColor: new THREE.Color('#ff8c3c'),
          // The curtain lighting the canopy. Base and span in world metres: the
          // kit's tree is 22 units tall and the scatter scales it to a third,
          // so a crown lands somewhere between five and twelve metres up. The
          // base is low enough now to catch the shoulders of the canopy too —
          // starting it at the crowns left the bulk of the wood on the flat
          // emissive, which is exactly the term this is replacing.
          // Raised from 0.038/1.0/6: the trees standing behind the tents,
          // away from the fire's own warmOnly term above, had nothing else
          // to separate them from the black behind them — the curtains are
          // still meant to stay mostly *in the sky*, but a wood with no
          // silhouette against a moving light source overhead read as flat.
          // Lower base and wider span pull the term down past the crowns
          // into the shoulders, which is the part of the canopy actually
          // sitting in the gap behind the tents.
          aurora: {
            low: AURORA_BOUNCE_LOW,
            mid: AURORA_BOUNCE_MID,
            high: AURORA_BOUNCE_HIGH,
            gain: 0.1,
            base: 0.6,
            span: 9,
          },
        })
        return { geometry: p.geometry, material: m }
      })
      leafCache.set(species, out)
      return out
    }

    return {
      scene: gltf.scene,
      get: (name: string) => byName.get(name),
      parts: part,
      treeParts,
      grassParts,
    }
  }, [gltf, gl])
}

useGLTF.preload(KIT_URL)

/**
 * Clones a part list with tinted, independently-owned materials.
 * Used for the tents, which share one mesh and one texture set.
 */
export function tintParts(parts: Part[], tint: string, extra?: Partial<THREE.MeshStandardMaterial>) {
  return parts.map(({ geometry, material }) => {
    const m = (material as THREE.MeshStandardMaterial).clone()
    m.color = new THREE.Color(tint)
    if (extra) Object.assign(m, extra)
    return { geometry, material: m }
  })
}
