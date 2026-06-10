import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { clamp, hash, mix, pass, smoothstep, time, uniform, uv, vec3, vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { telemetry } from '../game/telemetry'

/**
 * Post chain v4 (T106): bloom + radial motion blur + speed-linked chromatic
 * aberration, then filmic s-curve, vignette, fine film grain. Per-theme
 * shadow tint removed (read as too much). All color math on rgb only —
 * vec4 through outputNode kills the pipeline silently (B23/V21).
 * Everything scales with fxIntensity; 0 → no post at all (V10).
 */
export function Effects({ fxIntensity }: { fxIntensity: number }) {
  const renderer = useThree((s) => s.gl) as unknown as THREE.WebGPURenderer
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const uBlur = useMemo(() => uniform(0), [])
  const uCa = useMemo(() => uniform(0), [])

  const post = useMemo(() => {
    if (fxIntensity <= 0) return null
    const scenePass = pass(scene, camera)
    const color = scenePass.getTextureNode('output')
    const bloomNode = bloom(color, 1.25 * fxIntensity, 0.6, 0.78)

    const dir = uv().sub(0.5)

    // T106: chromatic aberration — red pulled in, blue pushed out, ramping
    // with speed. Replaces the warp-streak job: speed reads at the edges.
    const caOff = dir.mul(uCa)
    const caColor = vec3(
      color.sample(uv().sub(caOff)).r,
      color.sample(uv()).g,
      color.sample(uv().add(caOff)).b,
    )

    // radial blur: taps pulled toward screen center, masked to the edges
    const radial = color
      .sample(uv().sub(dir.mul(uBlur.mul(0.012))))
      .add(color.sample(uv().sub(dir.mul(uBlur.mul(0.026)))))
      .add(color.sample(uv().sub(dir.mul(uBlur.mul(0.042)))))
      .add(color.sample(uv().sub(dir.mul(uBlur.mul(0.06)))))
      .mul(0.25)
    const edgeMask = smoothstep(0.12, 0.55, dir.length()).mul(uBlur.min(1))
    const rgb = mix(caColor, radial.rgb, edgeMask).add(bloomNode.rgb)

    // tone curve: gentle filmic s-curve — deeper blacks, kept highlights
    const c01 = clamp(rgb, 0, 1)
    const sCurve = c01.mul(c01).mul(c01.mul(-2).add(3))
    const toned = mix(rgb, sCurve, 0.22 * fxIntensity)

    // vignette
    const vig = smoothstep(0.48, 1.05, dir.length()).mul(0.32 * fxIntensity)
    const vignetted = toned.mul(vig.oneMinus())

    // film grain — B25: seed multipliers must exceed pixel pitch or
    // hash().toUint() quantizes neighbors together → horizontal static
    // streaks crawling the frame. High-frequency 2D seed + low amplitude.
    const grainSeed = uv().x.mul(39163.7).add(uv().y.mul(21717.3)).add(time.mul(127.1))
    const grain = hash(grainSeed).sub(0.5).mul(0.014 * fxIntensity)

    const post = new THREE.PostProcessing(renderer)
    post.outputNode = vec4(vignetted.add(grain), 1)
    return post
  }, [renderer, scene, camera, fxIntensity, uBlur, uCa])

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
    // CA: faint floor, ramps with speed + boost kick
    const caTarget = (0.0006 + Math.max(0, kph - 300) / 900 * 0.004 + telemetry.boostFlash * 0.002) * fxIntensity
    uCa.value += (Math.min(0.006, caTarget) - uCa.value) * 0.12
    if (post) post.render()
    else renderer.render(scene, camera)
  }, 1)

  return null
}
