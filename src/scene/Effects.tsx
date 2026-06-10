import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { pass } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'

/**
 * WebGPU node-based post chain (T10): bloom keyed to fxIntensity (V10).
 * fxIntensity 0 → no post chain at all, plain render.
 */
export function Effects({ fxIntensity }: { fxIntensity: number }) {
  const renderer = useThree((s) => s.gl) as unknown as THREE.WebGPURenderer
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const post = useMemo(() => {
    if (fxIntensity <= 0) return null
    const scenePass = pass(scene, camera)
    const color = scenePass.getTextureNode('output')
    const bloomNode = bloom(color, 0.9 * fxIntensity, 0.55, 0.82)
    const post = new THREE.PostProcessing(renderer)
    post.outputNode = color.add(bloomNode)
    return post
  }, [renderer, scene, camera, fxIntensity])

  useEffect(() => {
    return () => {
      post?.dispose()
    }
  }, [post])

  // priority 1 → takes over r3f's render loop
  useFrame(() => {
    if (post) post.render()
    else renderer.render(scene, camera)
  }, 1)

  return null
}
