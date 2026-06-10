import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { clamp, hash, luminance, mix, pass, smoothstep, time, uniform, uv, vec3, vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { telemetry } from '../game/telemetry'
import type { TrackTheme } from '../lib/track/generate'

/**
 * Post chain v3 (T44 + R9c/T104): bloom + radial motion blur, then the
 * polish stack — filmic s-curve, per-theme shadow grade, vignette, animated
 * film grain. Everything scales with fxIntensity; 0 → no post at all (V10).
 */
export function Effects({ fxIntensity, theme }: { fxIntensity: number; theme?: TrackTheme }) {
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
    const base = mix(color, radial, edgeMask).add(bloomNode)

    // R9c polish stack operates on rgb only — vec4 math through the s-curve
    // warped alpha and killed the pipeline (B23)
    const rgb = base.rgb

    // tone curve: gentle filmic s-curve — deeper blacks, kept highlights.
    // smoothstep form is bounded, so clamp rgb into it first
    const c01 = clamp(rgb, 0, 1)
    const sCurve = c01.mul(c01).mul(c01.mul(-2).add(3))
    const toned = mix(rgb, sCurve, 0.22 * fxIntensity)

    // per-theme grade: shadows drift toward the track's fog tint so each
    // mood carries its own cast; highlights stay clean. Fog colors are
    // near-black — normalize so the hue (not the level) drives the cast.
    const fogTint = new THREE.Color(theme?.fog ?? '#000000')
    const m = Math.max(0.02, Math.max(fogTint.r, fogTint.g, fogTint.b))
    const shadowMask = smoothstep(0.0, 0.45, luminance(toned)).oneMinus()
    const graded = toned.add(
      vec3(fogTint.r / m, fogTint.g / m, fogTint.b / m)
        .mul(shadowMask)
        .mul(theme ? 0.05 * fxIntensity : 0),
    )

    // vignette
    const vig = smoothstep(0.48, 1.05, dir.length()).mul(0.32 * fxIntensity)
    const vignetted = graded.mul(vig.oneMinus())

    // film grain: animated hash, additive, subtle (hash takes a FLOAT seed)
    const grainSeed = uv().x.mul(1287.4).add(uv().y.mul(7718.3)).add(time.mul(61.7))
    const grain = hash(grainSeed).sub(0.5).mul(0.035 * fxIntensity)

    const post = new THREE.PostProcessing(renderer)
    post.outputNode = vec4(vignetted.add(grain), 1)
    return post
  }, [renderer, scene, camera, fxIntensity, uBlur, theme])

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
