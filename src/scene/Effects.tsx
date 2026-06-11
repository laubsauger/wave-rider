import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { clamp, convertToTexture, hash, mix, pass, smoothstep, time, uniform, uv, vec3, vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
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
  const uBokeh = useMemo(() => uniform(0.5), [])
  const uFocus = useMemo(() => uniform(12), [])
  const uRange = useMemo(() => uniform(55), [])
  const uVig = useMemo(() => uniform(0.26), [])
  const uVigStart = useMemo(() => uniform(0.46), [])
  const uHeat = useMemo(() => uniform(0), [])
  const frameN = useRef(0)
  const lastGpuT = useRef(0)

  const post = useMemo(() => {
    if (fxIntensity <= 0) return null
    const scenePass = pass(scene, camera)
    const raw = scenePass.getTextureNode('output')
    // T137 → T148: focus sits ON the ship (~9m from the chase cam) with a
    // wide near band — you and the road ahead stay SHARP, the far world
    // melts away with speed. Bokeh ∝ speed via uBokeh. Focus distance and
    // band ride uniforms: at speed the FOV stretch pushes the aim point
    // deeper into the frame, so the focal plane chases it (uFocus) and the
    // sharp band widens (uRange) — the road you steer at never blurs.
    const focused = dof(raw, scenePass.getViewZNode(), uFocus, uRange, uBokeh)
    const color = convertToTexture(focused)
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

    // T162/T169: vignette is ALIVE — tightening into tunnel vision as speed
    // climbs. Both the strength (uVig) AND the inner radius (uVigStart) are
    // frame-driven: the dark ring closes toward the focal point like a
    // fighter-jet greyout, not just dimmed corners.
    const vig = smoothstep(uVigStart, 0.92, dir.length()).mul(uVig)
    const vignetted = toned.mul(vig.oneMinus())

    // T169: RE-ENTRY HEAT — past ~1000 kph the screen edges ignite, plasma
    // veil intensifying toward the ceiling. Hot orange→white, shimmering.
    const heatMask = smoothstep(0.3, 0.85, dir.length())
    const heatShimmer = hash(uv().x.mul(733.7).add(uv().y.mul(521.3)).add(time.mul(43))).mul(0.3).add(0.7)
    const heatCol = mix(vec3(1.0, 0.32, 0.08), vec3(1.0, 0.85, 0.55), uHeat)
    const heated = vignetted.add(heatCol.mul(heatMask).mul(heatShimmer).mul(uHeat).mul(0.55))

    // film grain — B25: seed multipliers must exceed pixel pitch or
    // hash().toUint() quantizes neighbors together → horizontal static
    // streaks crawling the frame. High-frequency 2D seed + low amplitude.
    const grainSeed = uv().x.mul(39163.7).add(uv().y.mul(21717.3)).add(time.mul(127.1))
    const grain = hash(grainSeed).sub(0.5).mul(0.014 * fxIntensity)

    const post = new THREE.PostProcessing(renderer)
    post.outputNode = vec4(heated.add(grain), 1)
    return post
  }, [renderer, scene, camera, fxIntensity, uBlur, uCa, uBokeh, uFocus, uRange, uVig, uVigStart, uHeat])

  useEffect(() => {
    return () => {
      post?.dispose()
    }
  }, [post])

  // T173: earliest hook this frame — stamps the start so the post-render
  // delta below = total main-thread JS time (sim + scene + render encode)
  useFrame(() => {
    telemetry.frameStart = performance.now()
  }, -100)

  useFrame(() => {
    const kph = telemetry.speed * 3.6
    const target =
      (Math.max(0, (kph - 480) / 600) + telemetry.boostFlash * 0.5 + telemetry.beat * 0.08) * fxIntensity
    uBlur.value += (Math.min(1.4, target) - uBlur.value) * 0.1
    // CA: faint floor, ramps with speed + boost kick
    const caTarget = (0.0006 + Math.max(0, kph - 300) / 900 * 0.004 + telemetry.boostFlash * 0.002 + uHeat.value * 0.005) * fxIntensity
    uCa.value += (Math.min(0.011, caTarget) - uCa.value) * 0.12
    // T137: bokeh swells with speed — standing still stays crisp
    const bokehTarget = (0.4 + Math.min(1, kph / 900) * 2.2) * fxIntensity
    uBokeh.value += (bokehTarget - uBokeh.value) * 0.08
    // focal plane chases the aim point: FOV stretch at speed pushes "right in
    // front of the ship" deeper in view-Z, so focus moves out and the sharp
    // band widens with it. Band reaches FAR enough that the next boost pad
    // (~100-200m) stays readable — blur is for the far world, not the path.
    const speedN = Math.min(1, kph / 1100)
    uFocus.value += (14 + speedN * 26 - uFocus.value) * 0.08
    uRange.value += (75 + speedN * 170 - uRange.value) * 0.08
    // T162/T169: tunnel vision — ring DARKENS and CLOSES with speed; boost
    // squeezes it harder for a beat
    const vigTarget = (0.32 + Math.min(0.55, (kph / 1600) * 0.55) + telemetry.boostFlash * 0.18) * fxIntensity
    uVig.value += (vigTarget - uVig.value) * 0.06
    const vigStartTarget = 0.46 - (Math.min(0.26, (kph / 1500) * 0.26) + telemetry.boostFlash * 0.05) * fxIntensity
    uVigStart.value += (vigStartTarget - uVigStart.value) * 0.06
    // T169: re-entry heat builds 1000 → 2500 kph
    const heatTarget = Math.min(1, Math.max(0, (kph - 1000) / 1500)) * fxIntensity
    uHeat.value += (heatTarget - uHeat.value) * 0.05
    if (post) post.render()
    else renderer.render(scene, camera)

    // T173: REAL gpu-side numbers for PerfHud — timestamp queries resolve
    // async every ~20 frames (cheap), draw calls/tris read every frame
    type GpuInfo = {
      render: { timestamp?: number; drawCalls?: number; calls?: number; triangles?: number }
    }
    const info = (renderer.info as unknown as GpuInfo).render
    telemetry.drawCalls = info.drawCalls ?? info.calls ?? 0
    telemetry.triangles = info.triangles ?? 0
    // main-thread busy time this frame (EMA): GPU at 2ms during fps dips
    // proved the stalls live HERE, not on the GPU
    const busy = performance.now() - telemetry.frameStart
    telemetry.cpuMs += (busy - telemetry.cpuMs) * 0.1
    frameN.current++
    if (frameN.current % 20 === 0) {
      type TsRenderer = { resolveTimestampsAsync?: (type?: string) => Promise<unknown> }
      void (renderer as unknown as TsRenderer)
        .resolveTimestampsAsync?.('render')
        ?.then(() => {
          const t = (renderer.info as unknown as GpuInfo).render.timestamp
          if (typeof t !== 'number') return
          // the counter ACCUMULATES across frames between resolves — report
          // the per-frame average over the 20-frame window, not the raw sum
          // (the raw sum read as "150ms gpu" while vsync sat at 79fps)
          const d = t - lastGpuT.current
          lastGpuT.current = t
          if (d > 0) telemetry.gpuMs = d / 20
        })
        .catch(() => {})
    }
  }, 1)

  return null
}
