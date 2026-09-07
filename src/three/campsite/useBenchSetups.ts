import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

export const BENCH_SETUPS_URL = '/models/bench-setups.glb'
const DRACO_DECODER_PATH = '/draco/'

/**
 * The imported lantern candle is intentionally a short stub. Geometry is
 * compressed upward from its base so it continues to sit in the holder; the
 * wick and procedural flame are lowered by this same authored-space amount.
 */
// Halve the currently visible 55% stub, not the original full-height candle.
// The matching top drop keeps the base seated while lowering wick and flame.
export const LANTERN_CANDLE_HEIGHT_SCALE = 0.275
export const LANTERN_CANDLE_TOP_DROP = 0.04018

/**
 * One of the three bench layouts authored in Unity's Props scene.
 *
 * The exported roots are centred on the midpoint of the two Book3 placeholder
 * origins. Their meshes already contain every child transform baked in, so the
 * only runtime transform is the common conversion from the Unity staging bench
 * to the smaller bench used inside the web tent.
 */
export function useBenchSetup(index: number) {
  const gltf = useGLTF(BENCH_SETUPS_URL, DRACO_DECODER_PATH)

  return useMemo(() => {
    const source = gltf.scene.getObjectByName(`BenchSetup${index + 1}`)
    if (!source) throw new Error(`Missing BenchSetup${index + 1} in ${BENCH_SETUPS_URL}`)

    const clone = source.clone(true)
    clone.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = false
      mesh.receiveShadow = true

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const isLanternPart = mesh.name.includes('Lantern_Table')
      const isWhiteCandle = materials.some((material) => material.name.startsWith('Candle_White'))
      const isWick = materials.some((material) => material.name.startsWith('Candle_Holder_Black')) &&
        mesh.name.includes('Candle_Wick')

      if (isLanternPart && (isWhiteCandle || isWick)) {
        const geometry = mesh.geometry.clone()
        geometry.computeBoundingBox()
        if (isWhiteCandle && geometry.boundingBox) {
          // This OBJ-derived mesh keeps its authored vertical along local -Z;
          // local +Z points down after the GLTF axis conversion. Preserve the
          // holder-facing base (max Z) and pull only the top downward.
          const base = geometry.boundingBox.max.z
          const position = geometry.getAttribute('position') as THREE.BufferAttribute
          for (let vertex = 0; vertex < position.count; vertex++) {
            const z = position.getZ(vertex)
            position.setZ(vertex, base + (z - base) * LANTERN_CANDLE_HEIGHT_SCALE)
          }
          position.needsUpdate = true
          geometry.computeVertexNormals()
        } else if (isWick) {
          geometry.translate(0, 0, LANTERN_CANDLE_TOP_DROP)
        }
        geometry.computeBoundingBox()
        geometry.computeBoundingSphere()
        mesh.geometry = geometry
      }
    })
    return clone
  }, [gltf.scene, index])
}

useGLTF.preload(BENCH_SETUPS_URL, DRACO_DECODER_PATH)
