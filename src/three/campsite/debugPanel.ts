import * as THREE from 'three'
import type { BloomEffect, BrightnessContrastEffect, VignetteEffect } from 'postprocessing'
import type { SplitToneEffect } from './grade'
import { TREE_GAIN, GRASS_GAIN } from './debugGain'
import { ALL_STANDARD_MATERIALS, BARK_MATERIALS } from './useKit'
import { TREE_CANOPY_SHADERS } from './wind'

/* -------------------------------------------------------------------------- */
/*  Lighting debug panel — lil-gui, gated behind `?debug`, lazy-imported.       */
/*                                                                              */
/*  Binds directly to the live THREE objects (light refs, effect instances)     */
/*  rather than to the React props that built them, since mutating a plain      */
/*  JS constant like NIGHT.moon.intensity does not itself trigger a re-render   */
/*  and the JSX prop would go stale. Fog is the one exception — its near/far/    */
/*  ceiling/height are baked into the GLSL fog chunk as string literals at       */
/*  `installHeightFog()` time (see fog.ts), not uniforms, so they cannot be      */
/*  safely live-edited without forcing every material in the scene to           */
/*  recompile. They're read-only here; edit fog.ts's constants directly.        */
/* -------------------------------------------------------------------------- */

export interface DebugHandles {
  moon?: THREE.DirectionalLight | null
  rim?: THREE.DirectionalLight | null
  hemisphere?: THREE.HemisphereLight | null
  ambient?: THREE.AmbientLight | null
  fireKey?: THREE.PointLight | null
  bloom?: BloomEffect | null
  contrast?: BrightnessContrastEffect | null
  splitTone?: SplitToneEffect | null
  vignette?: VignetteEffect | null
  /** Arbitrary constants object dump (NIGHT, FIRELIGHT, ...), console-only. */
  constants?: Record<string, unknown>
}

export function debugEnabled() {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('debug')
}

export async function mountDebugPanel(handles: DebugHandles) {
  const { default: GUI } = await import('lil-gui')
  const gui = new GUI({ title: 'Lighting (?debug)' })

  const colorCtrl = (folder: any, obj: { color: THREE.Color }, label: string) => {
    const proxy = { hex: `#${obj.color.getHexString()}` }
    folder.addColor(proxy, 'hex').name(label).onChange((v: string) => obj.color.set(v))
  }

  if (handles.moon) {
    const f = gui.addFolder('Moon (key)')
    f.add(handles.moon, 'intensity', 0, 4, 0.01)
    colorCtrl(f, handles.moon, 'color')
  }
  if (handles.rim) {
    const f = gui.addFolder('Rim')
    f.add(handles.rim, 'intensity', 0, 2, 0.01)
    colorCtrl(f, handles.rim, 'color')
    // Position, not target — this is a THREE.DirectionalLight with no
    // explicit `target` set (JSX-mounted with just `position`), so it
    // shines at the default target (0,0,0) and only the *direction* from
    // position to origin matters, not the distance. Sliders move the
    // position and the light re-aims itself every frame automatically.
    f.add(handles.rim.position, 'x', -60, 60, 0.5)
    f.add(handles.rim.position, 'y', -20, 60, 0.5)
    f.add(handles.rim.position, 'z', -80, 40, 0.5)
  }
  if (handles.hemisphere) {
    const f = gui.addFolder('Hemisphere')
    f.add(handles.hemisphere, 'intensity', 0, 1, 0.01)
    colorCtrl(f, handles.hemisphere as unknown as { color: THREE.Color }, 'sky')
    const proxy = { hex: `#${(handles.hemisphere as any).groundColor.getHexString()}` }
    f.addColor(proxy, 'hex').name('ground').onChange((v: string) => (handles.hemisphere as any).groundColor.set(v))
  }
  if (handles.ambient) {
    const f = gui.addFolder('Ambient')
    f.add(handles.ambient, 'intensity', 0, 1, 0.01)
    colorCtrl(f, handles.ambient, 'color')
  }
  if (handles.fireKey) {
    const f = gui.addFolder('Fire key light')
    // LIGHTING-REWORK (2026-08-17): binding intensity to the light ref did
    // nothing — Campfire's useFrame recomputes `light.current.intensity =
    // FIRELIGHT.key.intensity * flicker` every frame (Effects.tsx), which
    // stomps any direct assignment within one frame. Bound to the actual
    // constant the flicker formula reads from instead; `distance` isn't
    // touched per frame, so the ref binding for it was already live.
    const fireKeyConst = (handles.constants?.FIRELIGHT as { key: { intensity: number } } | undefined)?.key
    if (fireKeyConst) f.add(fireKeyConst, 'intensity', 0, 150, 0.5).name('intensity (base, pre-flicker)')
    f.add(handles.fireKey, 'distance', 1, 40, 0.5)
  }
  if (handles.bloom) {
    const f = gui.addFolder('Bloom')
    const b = handles.bloom as unknown as {
      intensity: number
      luminanceMaterial: { threshold: number; smoothing: number }
    }
    f.add(b, 'intensity', 0, 4, 0.01)
    if (b.luminanceMaterial) {
      f.add(b.luminanceMaterial, 'threshold', 0, 1, 0.005).name('luminanceThreshold')
      f.add(b.luminanceMaterial, 'smoothing', 0, 1, 0.005).name('luminanceSmoothing')
    }
  }
  if (handles.contrast) {
    const f = gui.addFolder('Brightness / Contrast')
    const c = handles.contrast as unknown as { uniforms: Map<string, { value: number }> }
    const brightness = c.uniforms.get('brightness')
    const contrast = c.uniforms.get('contrast')
    if (brightness) f.add(brightness, 'value', -0.3, 0.3, 0.005).name('brightness')
    if (contrast) f.add(contrast, 'value', -0.3, 0.3, 0.005).name('contrast')
  }
  if (handles.splitTone) {
    const f = gui.addFolder('Split tone')
    const st = handles.splitTone as unknown as { uniforms: Map<string, { value: any }> }
    const shadowAmt = st.uniforms.get('uShadowAmount')
    const highlightAmt = st.uniforms.get('uHighlightAmount')
    const shadowCol = st.uniforms.get('uShadow')
    const highlightCol = st.uniforms.get('uHighlight')
    if (shadowAmt) f.add(shadowAmt, 'value', 0, 0.2, 0.001).name('shadowAmount')
    if (highlightAmt) f.add(highlightAmt, 'value', 0, 0.2, 0.001).name('highlightAmount')
    if (shadowCol) {
      const proxy = { hex: `#${(shadowCol.value as THREE.Color).getHexString()}` }
      f.addColor(proxy, 'hex').name('shadow').onChange((v: string) => (shadowCol.value as THREE.Color).set(v))
    }
    if (highlightCol) {
      const proxy = { hex: `#${(highlightCol.value as THREE.Color).getHexString()}` }
      f.addColor(proxy, 'hex').name('highlight').onChange((v: string) => (highlightCol.value as THREE.Color).set(v))
    }
  }
  if (handles.vignette) {
    const f = gui.addFolder('Vignette')
    const v = handles.vignette as unknown as { uniforms: Map<string, { value: number }> }
    const offset = v.uniforms.get('offset')
    const darkness = v.uniforms.get('darkness')
    if (offset) f.add(offset, 'value', 0, 1, 0.01).name('offset')
    if (darkness) f.add(darkness, 'value', 0, 1, 0.01).name('darkness')
  }

  {
    const f = gui.addFolder('Trees (canopy gain)')
    f.add(TREE_GAIN, 'value', 0, 3, 0.01).name('gain')
  }
  if (TREE_CANOPY_SHADERS.length) {
    const f = gui.addFolder('Trees (top/bottom gradient)')
    const first = TREE_CANOPY_SHADERS[0].uniforms
    const proxy = {
      top: `#${first.uTipTint.value.getHexString()}`,
      bottom: `#${first.uRootTint.value.getHexString()}`,
      coolGain: first.uCoolGain.value,
      split: first.uFoliageSplit.value,
      softness: first.uFoliageSoftness.value,
    }
    f.addColor(proxy, 'top').name('top (moonlit) color').onChange((v: string) => {
      for (const s of TREE_CANOPY_SHADERS) s.uniforms.uTipTint.value.set(v)
    })
    f.addColor(proxy, 'bottom').name('bottom (shadow) color').onChange((v: string) => {
      for (const s of TREE_CANOPY_SHADERS) s.uniforms.uRootTint.value.set(v)
    })
    f.add(proxy, 'coolGain', 0, 3, 0.01).onChange((v: number) => {
      for (const s of TREE_CANOPY_SHADERS) s.uniforms.uCoolGain.value = v
    })
    f.add(proxy, 'split', 0, 1, 0.01).name('split height (0=base,1=tip)').onChange((v: number) => {
      for (const s of TREE_CANOPY_SHADERS) s.uniforms.uFoliageSplit.value = v
    })
    f.add(proxy, 'softness', 0.01, 0.6, 0.01).onChange((v: number) => {
      for (const s of TREE_CANOPY_SHADERS) s.uniforms.uFoliageSoftness.value = v
    })
  }
  {
    const f = gui.addFolder('Grass (blades + ground, gain)')
    f.add(GRASS_GAIN, 'value', 0, 3, 0.01).name('gain')
  }
  if (BARK_MATERIALS.length) {
    const f = gui.addFolder('Tree bark')
    const proxy = { hex: `#${BARK_MATERIALS[0].color.getHexString()}`, emissiveIntensity: BARK_MATERIALS[0].emissiveIntensity }
    f.addColor(proxy, 'hex').name('color').onChange((v: string) => {
      for (const m of BARK_MATERIALS) m.color.set(v)
    })
    f.add(proxy, 'emissiveIntensity', 0, 1, 0.01).onChange((v: number) => {
      for (const m of BARK_MATERIALS) m.emissiveIntensity = v
    })
  }

  if (ALL_STANDARD_MATERIALS.length) {
    const f = gui.addFolder('Metalness (all standard materials)')
    // LIGHTING-REWORK (2026-08-17): for testing whether metalness is the
    // "white streak" root cause. It isn't — checked the source glb
    // directly, `metallicFactor` is 0 on every material in the kit, and
    // glTF multiplies that scalar by the texture, so metalness is already
    // forced to exactly 0 regardless of what the removed metalnessMap
    // contained. Drag this up and every surface should go mirror-like
    // uniformly, which is not what the streak looked like.
    const proxy = { metalness: ALL_STANDARD_MATERIALS[0].metalness }
    f.add(proxy, 'metalness', 0, 1, 0.01).onChange((v: number) => {
      for (const m of ALL_STANDARD_MATERIALS) m.metalness = v
    })
    // The actual lever: Fresnel reflectance climbs toward white at grazing
    // angles regardless of roughness (that fix, tried first, helped but
    // didn't clear it — see LIGHTING_TUNING.md). specularIntensity scales
    // that reflectance term directly, independent of every light in the
    // scene. All kit materials were upgraded to MeshPhysicalMaterial and
    // pinned to 0.04 by default specifically so this control exists.
    const spec = ALL_STANDARD_MATERIALS[0] as unknown as { specularIntensity: number }
    const specProxy = { specularIntensity: spec.specularIntensity ?? 0.04 }
    f.add(specProxy, 'specularIntensity', 0, 1, 0.01).onChange((v: number) => {
      for (const m of ALL_STANDARD_MATERIALS) (m as unknown as { specularIntensity: number }).specularIntensity = v
    })
  }

  const fogFolder = gui.addFolder('Fog (read-only — baked into GLSL, edit fog.ts)')
  fogFolder.add({ near: 20 }, 'near').disable()
  fogFolder.add({ far: 58 }, 'far').disable()

  gui.add(
    {
      dump: () => {
        console.log('--- lighting values ---')
        if (handles.moon) console.log('moon', { intensity: handles.moon.intensity, color: `#${handles.moon.color.getHexString()}` })
        if (handles.rim)
          console.log('rim', {
            intensity: handles.rim.intensity,
            color: `#${handles.rim.color.getHexString()}`,
            position: handles.rim.position.toArray().map((v) => Math.round(v * 10) / 10),
          })
        if (handles.hemisphere)
          console.log('hemisphere', {
            intensity: handles.hemisphere.intensity,
            sky: `#${handles.hemisphere.color.getHexString()}`,
            ground: `#${(handles.hemisphere as any).groundColor.getHexString()}`,
          })
        if (handles.ambient) console.log('ambient', { intensity: handles.ambient.intensity, color: `#${handles.ambient.color.getHexString()}` })
        if (handles.fireKey) console.log('fireKey', { intensity: handles.fireKey.intensity, distance: handles.fireKey.distance })
        console.log('treeGain', TREE_GAIN.value, 'grassGain', GRASS_GAIN.value)
        if (TREE_CANOPY_SHADERS.length) {
          const u = TREE_CANOPY_SHADERS[0].uniforms
          console.log('treeCanopyGradient', {
            top: `#${u.uTipTint.value.getHexString()}`,
            bottom: `#${u.uRootTint.value.getHexString()}`,
            coolGain: u.uCoolGain.value,
            split: u.uFoliageSplit.value,
            softness: u.uFoliageSoftness.value,
          })
        }
        if (BARK_MATERIALS.length)
          console.log('bark', { color: `#${BARK_MATERIALS[0].color.getHexString()}`, emissiveIntensity: BARK_MATERIALS[0].emissiveIntensity })
        if (handles.constants) console.log('constants at load (NIGHT, FIRELIGHT, ...)', handles.constants)
        console.log('fog.ts constants: FOG_NEAR=20 FOG_FAR=58 — edit the file, these are baked into GLSL')
      },
    },
    'dump'
  ).name('Print current values to console')

  return () => gui.destroy()
}
