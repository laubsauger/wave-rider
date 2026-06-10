import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { mix, pass, smoothstep, uniform, uv } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { telemetry } from '../game/telemetry'

/**
 * Post chain v2 (T44): stronger bloom + radial motion blur that ramps with
 * speed and boost. fxIntensity 0 → no post at all (V10).
 */
export function Effects({ fxIntensity }: { fxIntensity: number }) {
  const renderer = useThree((s) => s.gl) as unknown as THREE.WebGPURenderer
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const uBlur = useMemo(() => uniform(0), [])

  const post = useMemo(() => {
    if (fxIntensity <= 0) return null
    const scenePass = pass(scene, camera)
    const color = scenePass.getTextureNode('output')
    const bloomNode = bloom(color, 1.25 * fxIntensity, 0.6, 0.78)

    // radial blur: 5 taps pulled toward screen center, masked to the edges
    const dir = uv().sub(0.5)
    const radial = color
      .sample(uv().sub(dir.mul(uBlur.mul(0.012))))
      .add(color.sample(uv().sub(dir.mul(uBlur.mul(0.026)))))
      .add(color.sample(uv().sub(dir.mul(uBlur.mul(0.042)))))
      .add(color.sample(uv().sub(dir.mul(uBlur.mul(0.06)))))
      .mul(0.25)
    const edgeMask = smoothstep(0.12, 0.55, dir.length()).mul(uBlur.min(1))
    const post = new THREE.PostProcessing(renderer)
    post.outputNode = mix(color, radial, edgeMask).add(bloomNode)
    return post
  }, [renderer, scene, camera, fxIntensity, uBlur])

  useEffect(() => {
    return () => {
      post?.dispose()
    }
  }, [post])

  useFrame(() => {
    const kph = telemetry.speed * 3.6
    const target =
      (Math.max(0, (kph - 480) / 600) + telemetry.boostFlash * 0.5 + telemetry.beat * 0.08) * fxIntensity
    uBlur.value += (Math.min(1.4, target) - uBlur.value) * 0.1
    if (post) post.render()
    else renderer.render(scene, camera)
  }, 1)

  return null
}
