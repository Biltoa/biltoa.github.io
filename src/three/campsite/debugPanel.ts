import * as THREE from 'three'
import type { BloomEffect, BrightnessContrastEffect, VignetteEffect } from 'postprocessing'
import type { SplitToneEffect } from './grade'
import { TREE_GAIN, GRASS_GAIN } from './debugGain'
import { BARK_MATERIALS } from './useKit'

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
    f.add(handles.fireKey, 'intensity', 0, 80, 0.5)
    f.add(handles.fireKey, 'distance', 1, 30, 0.5)
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

  const fogFolder = gui.addFolder('Fog (read-only — baked into GLSL, edit fog.ts)')
  fogFolder.add({ near: 20 }, 'near').disable()
  fogFolder.add({ far: 58 }, 'far').disable()

  gui.add(
    {
      dump: () => {
        console.log('--- lighting values ---')
        if (handles.moon) console.log('moon', { intensity: handles.moon.intensity, color: `#${handles.moon.color.getHexString()}` })
        if (handles.rim) console.log('rim', { intensity: handles.rim.intensity, color: `#${handles.rim.color.getHexString()}` })
        if (handles.hemisphere)
          console.log('hemisphere', {
            intensity: handles.hemisphere.intensity,
            sky: `#${handles.hemisphere.color.getHexString()}`,
            ground: `#${(handles.hemisphere as any).groundColor.getHexString()}`,
          })
        if (handles.ambient) console.log('ambient', { intensity: handles.ambient.intensity, color: `#${handles.ambient.color.getHexString()}` })
        if (handles.fireKey) console.log('fireKey', { intensity: handles.fireKey.intensity, distance: handles.fireKey.distance })
        console.log('treeGain', TREE_GAIN.value, 'grassGain', GRASS_GAIN.value)
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
