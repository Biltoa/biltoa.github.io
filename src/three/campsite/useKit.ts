import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { AURORA_BOUNCE_HIGH, AURORA_BOUNCE_LOW, AURORA_BOUNCE_MID, applyWind } from './wind'
import { attachDebugGain, TREE_GAIN, GRASS_GAIN } from './debugGain'

/**
 * Bark materials, one per species, collected as they're built so the
 * `?debug` panel can expose a shared colour/emissive control for them — see
 * campsite/debugPanel.ts. Trees are the one part of the scene that stayed on
 * MeshStandardMaterial (see the note at `treeParts` below), so a much
 * brighter key/rim light reaches their full PBR response instead of the
 * flattened Lambert response everything else gets.
 */
export const BARK_MATERIALS: THREE.MeshStandardMaterial[] = []

/**
 * Every kit material the scene renders (tents, benches, stones, torches,
 * props — everything that didn't get converted to Lambert), for the `?debug`
 * panel's metalness and specular sliders. Typed as `MeshStandardMaterial`,
 * holding the `MeshPhysicalMaterial` subclass the traversal below upgrades
 * them to. Registered once, in the load-time
 * traversal below, before anything clones them — `tintParts` clones from
 * these, and clones carry `.needsUpdate` recompiles independently, so a
 * slider bound only to these originals would not reach a tent's actual
 * on-screen material. Push happens in the same traversal that strips
 * roughness/metalness maps, so this list is exactly "every material that
 * still has a metalness concept at all."
 */
export const ALL_STANDARD_MATERIALS: THREE.MeshStandardMaterial[] = []

/**
 * The three tents' own cloned materials, in the order the tents mount, for the
 * `?debug` panel's tent-roughness slider. A subset of ALL_STANDARD_MATERIALS:
 * roughness is the one value that is set per-tent rather than kit-wide (see
 * `tintParts`' caller in CampHero.tsx), so it needs its own list to bind to.
 */
export const TENT_MATERIALS: THREE.MeshStandardMaterial[] = []

/** Guards the material-upgrade traversal in useKit() — see its comment. */
const upgradedKitScenes = new WeakSet<THREE.Object3D>()

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

export const KIT_URL = '/models/campsite-kit.glb?v=2'

export interface Part {
  geometry: THREE.BufferGeometry
  material: THREE.Material
}

interface PreparedKit {
  scene: THREE.Group
  get: (name: string) => THREE.Object3D | undefined
  parts: (name: string) => Part[]
  treeParts: (species: 'TreeA' | 'TreeB' | 'TreeC') => Part[]
  grassParts: (name: 'GrassA' | 'GrassB') => Part[]
}

/**
 * `useGLTF` shares one scene across every hook consumer. Keep the expensive
 * preparation shared at the same lifetime too, while preserving a distinct
 * anisotropy pass for a different renderer (whose capability limit can differ).
 */
const preparedKits = new WeakMap<
  THREE.Group,
  WeakMap<THREE.WebGLRenderer, PreparedKit>
>()

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
    let byRenderer = preparedKits.get(gltf.scene)
    const cachedKit = byRenderer?.get(gl)
    if (cachedKit) return cachedKit

    if (!byRenderer) {
      byRenderer = new WeakMap<THREE.WebGLRenderer, PreparedKit>()
      preparedKits.set(gltf.scene, byRenderer)
    }

    const byName = new Map<string, THREE.Object3D>()
    gltf.scene.traverse((o) => byName.set(o.name, o))

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

    // LIGHTING-REWORK (2026-08-17): third pass at the same "white streak"
    // report — see LIGHTING_TUNING.md for the full history.
    //
    // **Why the first two passes appeared not to work: this block threw.**
    // `new THREE.MeshPhysicalMaterial().copy(m)` raises
    // `Cannot read properties of undefined (reading 'x')` on the *first*
    // mesh it touches (see the note at the copy below), and the throw
    // escapes into React, so every later `useKit()` call found the
    // once-only guard already set and did nothing. Net effect on the
    // shipped scene: nothing was upgraded, no map was stripped past
    // `Tent_0`, `specularIntensity` was never written, and
    // `ALL_STANDARD_MATERIALS` stayed empty — which also left the
    // `?debug` panel's metalness and specular sliders wired to an empty
    // list. That is why turning either knob "helped but didn't clear it":
    // neither knob was connected to anything on screen.
    //
    // Roughness controls the *spread* of a specular lobe, not whether one
    // exists. Fresnel reflectance (Schlick's approximation) climbs toward
    // 1.0 at grazing angles for *any* dielectric, at *any* roughness — a
    // rough surface still throws a wide, dim highlight, and thin edge
    // geometry (rope, trim, a canopy's silhouette) is exactly the shape
    // that puts a grazing angle in front of the camera constantly. With
    // the fire/moon/rim intensities this scene now runs at, that grazing
    // term alone carries enough energy to blow through Bloom regardless
    // of how matte the surface is. No amount of roughness fixes that —
    // it's a different term.
    //
    // `MeshStandardMaterial` has no way to turn that term down; only
    // `MeshPhysicalMaterial`'s `specularIntensity` (KHR_materials_specular)
    // scales the reflectance itself, independent of every light in the
    // scene. Upgrading every material found here to `MeshPhysicalMaterial`
    // and pinning `specularIntensity` low is the one lever that kills the
    // grazing highlight without touching a single light value — which is
    // what was explicitly asked for.
    //
    // **Guarded to run exactly once, scene-wide — not once per hook call.**
    // `useKit()` is called from Scatter, Torch, Candle, TentInterior and
    // Tent (×3, one per tent), and `useGLTF`'s cache means every one of
    // those calls' `gltf.scene` is the *same* shared object graph, not a
    // copy. Without the guard this traverse ran again for every one of
    // those components in the same commit, and because it *disposes* the
    // material it just replaced, each later call was disposing the exact
    // material instance an earlier call had already handed to a `Part` and
    // (for direct, un-cloned uses like Bench/Stone) already attached to a
    // mesh mid-frame — freshly-live materials thrown away and recompiled
    // five-plus times over on every load. Reproduced as a hang: headless
    // `tools/shot.mjs` timed out waiting for a stable frame twice in a row
    // with this un-guarded, while the always-warm interactive dev tab
    // (already past that first commit before the bug was introduced)
    // never showed it — the tell that it was a first-mount-only problem.
    if (!upgradedKitScenes.has(gltf.scene)) {
      upgradedKitScenes.add(gltf.scene)
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        const upgraded = materials.map((mat) => {
          const m = mat as THREE.MeshStandardMaterial
          if (m.roughnessMap) m.roughnessMap = null
          if (m.metalnessMap) m.metalnessMap = null
          // Not `new MeshPhysicalMaterial().copy(m)`: `MeshPhysicalMaterial.copy`
          // reads physical-only fields off the *source* — `source.clearcoatNormalScale`
          // is a Vector2 a `MeshStandardMaterial` does not have — and throws
          // `Cannot read properties of undefined (reading 'x')` on the first
          // material it sees. Copying with the *standard* material's own `copy`
          // moves every field the source actually has and leaves the physical-only
          // ones at their constructor defaults, which is what we want; the defines
          // have to be put back afterwards because `MeshStandardMaterial.copy`
          // overwrites them with `{ STANDARD: '' }` and dropping `PHYSICAL` would
          // compile the standard shader — no `specularIntensity` in it at all.
          const phys = new THREE.MeshPhysicalMaterial()
          THREE.MeshStandardMaterial.prototype.copy.call(phys, m)
          phys.defines = { STANDARD: '', PHYSICAL: '' }
          // 0.15, measured against the artefact rather than guessed: on the
          // cot rails (the clearest instance of it — a thin blue metal rail a
          // couple of metres from the fire) the count of near-neutral bright
          // pixels in a fixed crop runs 196 at the glTF default of 1.0, 151 at
          // 0.3, 134 at 0.15 and 113 at 0.04. Under about 0.2 the white edge
          // stops reading as a highlight; under about 0.1 the tent's weave and
          // the glassware lose the only specular that gave them a surface at
          // all. 0.15 is the far end of the first range and the near end of
          // the second.
          phys.specularIntensity = 0.15
          phys.needsUpdate = true
          m.dispose()
          ALL_STANDARD_MATERIALS.push(phys)
          return phys
        })
        mesh.material = Array.isArray(mesh.material) ? upgraded : upgraded[0]
      })
    }

    const partCache = new Map<string, Part[]>()
    const part = (name: string): Part[] => {
      const cached = partCache.get(name)
      if (cached) return cached
      const parts = collectParts(byName.get(name))
      partCache.set(name, parts)
      return parts
    }

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
          // Texture-masked sky floor. Thin blades frequently face away from
          // both directionals; a very low cool emissive keeps their printed
          // detail visible without turning the field into a self-lit carpet.
          emissive: new THREE.Color('#31563a'),
          emissiveMap: src.map,
          emissiveIntensity: 1,
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
          mapTint: new THREE.Color('#587f52'),
          // The soil end. Still the ambient occlusion under every tent, bench
          // and trunk that no shadow map at this scale can draw.
          rootTint: new THREE.Color('#18261d'),
          // And the moonlit tips. Warm-dark rather than the old blue-green:
          // the far field in the reference is near-black with a red cast, not
          // a cool one, because nothing cold reaches the floor of a clearing.
          // VISUAL-13.9 (2026-08-30): '#3f4a2c' -> '#26382f', coolGain 0.60 ->
          // 0.86. The tips were a warm olive at every radius, so a blade at the
          // edge of the frame was the same colour as a blade at the coals and
          // the fire stopped reading as the thing lighting the field. The far
          // end of the ramp is a dark blue-green now; the warm terms below are
          // unchanged, so the pool round the fire is the only warm ground.
          tipTint: new THREE.Color('#50735b'),
          coolGain: 1.02,
          // The fire and six torches are the only warm light in the clearing
          // and the field is what they are standing in; a camp whose grass does
          // not change colour toward the coals reads as a green carpet with
          // lamps on it. But this is an *additive* term over a field that the
          // fire's point light is already lighting warm, so it stacks on top of
          // real firelight rather than replacing it — at 0.85 the two together
          // took the whole foreground to straw.
          warmGain: 0.065,
          // Redder than the old amber. The pool in the reference runs to
          // rgb(133,46,18) at its brightest — nearly two stops of red over
          // green — and an amber light on a rust field lands on orange, not on
          // that.
          warmColor: new THREE.Color('#e88d48'),
          // The ramp between a blade at the treeline and a blade at the fire is
          // a colour ramp the whole way rather than a switch at the end of one.
          warmTint: new THREE.Color('#b48a5b'),
        })
        // LIGHTING-REWORK (2026-08-17): live gain for the ?debug panel's
        // "Grass" slider, requested separately from the scene-wide
        // hemisphere/ambient that also light this material.
        attachDebugGain(m, GRASS_GAIN)
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
          // LIGHTING-REWORK (2026-08-17): color '#610000' and
          // emissiveIntensity 0.42->0.59 baked from the ?debug panel's
          // "Tree bark" folder at the user's request — added because this
          // material stayed MeshStandardMaterial (see the comment above),
          // so it's the one tree surface with a full PBR response to the
          // much brighter key/rim baked in this session, and the one the
          // user flagged as reading too bright at the pack's own colour.
          // VISUAL-13.8 (2026-08-30): '#610000' -> '#2c2118', emissiveIntensity
          // 0.59 -> 0.34. A saturated dark red on every trunk in the wood put a
          // third hue family into a frame that already has fire and aurora in
          // it, and it is most of why the near stand read as a different art
          // style from the tents. Bark is brown, and it is dark.
          bark.color = new THREE.Color('#2c2118')
          bark.emissive = new THREE.Color('#1a1712')
          bark.emissiveIntensity = 0.34
          BARK_MATERIALS.push(bark)
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
          emissive: new THREE.Color('#243d34'),
          emissiveIntensity: 0.58,
          emissiveMap: src.map,
        })
        applyWind(m, {
          amplitude: 0.16,
          speed: 0.85,
          height: 22,
          // LIGHTING-REWORK (2026-08-17): explicit tip/root/coolGain, baked
          // from the ?debug panel's "Trees (top/bottom gradient)" folder —
          // top-lit-by-moon (near white), darker/greyer at the base. Without
          // these the tree leaf material fell through to applyWind's own
          // generic defaults ('#7d9cd6'/'#24304a'/1.2), which is what grass
          // gets when it doesn't override them either — trees now have their
          // own, matching grass's existing explicit block below.
          tipTint: new THREE.Color('#ffffff'),
          rootTint: new THREE.Color('#6b6b6b'),
          coolGain: 1.41,
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
          warmReach: 1.55,
          warmGain: 0.08,
          warmColor: new THREE.Color('#d88343'),
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
            // VISUAL-13.8 (2026-08-30): gain 0.1 -> 0.065. The curtain still
            // catches the crowns; it no longer washes the whole stand toward
            // the sky's own colour, which was flattening the depth ramp above.
            gain: 0.065,
            base: 0.6,
            span: 9,
          },
        })
        // LIGHTING-REWORK (2026-08-17): live gain for the ?debug panel's
        // "Trees" slider, requested separately from "Grass" above.
        attachDebugGain(m, TREE_GAIN)
        return { geometry: p.geometry, material: m }
      })
      leafCache.set(species, out)
      return out
    }

    const prepared: PreparedKit = {
      scene: gltf.scene,
      get: (name: string) => byName.get(name),
      parts: part,
      treeParts,
      grassParts,
    }
    byRenderer.set(gl, prepared)
    return prepared
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
    // Registered separately from the traversal in useKit() above: this is
    // a *clone*, made fresh per call (once per tent instance), so it isn't
    // the same object that traversal saw. Without this the debug
    // metalness slider would move the un-rendered originals and every
    // tent on screen would sit still.
    ALL_STANDARD_MATERIALS.push(m)
    TENT_MATERIALS.push(m)
    return { geometry, material: m }
  })
}
