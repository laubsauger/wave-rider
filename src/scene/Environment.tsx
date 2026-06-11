import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { abs, cameraPosition, color, fract, positionWorld, smoothstep, uniform } from 'three/tsl'
import { mulberry32, rngRange } from '../lib/prng'
import type { TrackData } from '../lib/track/generate'
import { poseAt, type FramePose, type TrackFrames } from '../lib/track/sample'
import { telemetry } from '../game/telemetry'
import { shipVmax } from '../lib/physics/ship'

/**
 * T31 → T107: neon grid floor — low-res ribbon that FOLLOWS the track's
 * path and elevation (~85m below, smoothed), so the world has an actual
 * floor that weaves with the course instead of a flat plane slicing
 * through it at one height. World-space TSL grid, fades with distance,
 * breathes with the music.
 */
export function GridFloor({ track, frames }: { track: TrackData; frames: TrackFrames }) {
  const uPulse = useMemo(() => uniform(0.4), [])

  const geometry = useMemo(() => {
    const STEP = 90 // m along track — low res on purpose
    const LATERAL = 14
    const HALF_W = 850
    const n = Math.max(3, Math.floor(track.length / STEP))
    const cx: number[] = []
    const cy: number[] = []
    const cz: number[] = []
    for (let i = 0; i <= n; i++) {
      const fi = Math.min(frames.count - 1, Math.round((i * STEP) / frames.ds))
      cx.push(frames.positions[fi * 3])
      cy.push(frames.positions[fi * 3 + 1])
      cz.push(frames.positions[fi * 3 + 2])
    }
    // smooth the height twice so loops/jumps don't tent the floor
    for (let p = 0; p < 3; p++) {
      for (let i = 1; i < cy.length - 1; i++) cy[i] = (cy[i - 1] + cy[i] + cy[i + 1]) / 3
    }
    const positions = new Float32Array((n + 1) * LATERAL * 3)
    for (let i = 0; i <= n; i++) {
      const i0 = Math.max(0, i - 1)
      const i1 = Math.min(n, i + 1)
      let dx = cx[i1] - cx[i0]
      let dz = cz[i1] - cz[i0]
      const dl = Math.hypot(dx, dz) || 1
      dx /= dl
      dz /= dl
      // horizontal perpendicular to the path
      const pxd = -dz
      const pzd = dx
      for (let j = 0; j < LATERAL; j++) {
        const t = (j / (LATERAL - 1)) * 2 - 1
        const o = (i * LATERAL + j) * 3
        positions[o] = cx[i] + pxd * t * HALF_W
        positions[o + 1] = cy[i] - 85
        positions[o + 2] = cz[i] + pzd * t * HALF_W
      }
    }
    const indices = new Uint32Array(n * (LATERAL - 1) * 6)
    let k = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < LATERAL - 1; j++) {
        const a = i * LATERAL + j
        const b = a + LATERAL
        indices.set([a, b, a + 1, a + 1, b, b + 1], k)
        k += 6
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setIndex(new THREE.BufferAttribute(indices, 1))
    return g
  }, [track, frames])

  const material = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const gx = abs(fract(positionWorld.x.div(45)).sub(0.5))
    const gz = abs(fract(positionWorld.z.div(45)).sub(0.5))
    const lines = smoothstep(0.03, 0.0, gx).add(smoothstep(0.03, 0.0, gz)).min(1)
    const dist = positionWorld.sub(cameraPosition).length()
    const fade = smoothstep(1600, 150, dist)
    m.colorNode = color(new THREE.Color(track.theme.glow))
    m.opacityNode = lines.mul(fade).mul(uPulse)
    return m
  }, [track.theme.glow, uPulse])

  useFrame((_, dt) => {
    // T118/T149: the floor is BACKDROP — quiet, slow, never competing.
    // energy² keeps it dim until the song actually pushes.
    const e = telemetry.energy
    const target = 0.09 + e * e * 0.14 * track.theme.pulse
    uPulse.value += (target - uPulse.value) * Math.min(1, dt * 0.6)
  })

  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}

/**
 * R9d/T104: procedural equirect environment map — deep black sky, faint
 * horizon band, scattered neon blobs in the theme palette. WebGPURenderer
 * consumes scene.environment via EnvironmentNode/PMREM (verified in three
 * 0.182). Hull clearcoat picks up the neon reflections; intensity kept low
 * so the C11 deep blacks stay deep. Tier-gated by the caller (C7).
 */
export function SceneEnvironment({ track }: { track: TrackData }) {
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    const W = 128
    const H = 64
    const data = new Uint8Array(W * H * 4)
    const glow = new THREE.Color(track.theme.glow)
    const edge = new THREE.Color(track.theme.edge)
    const rng = mulberry32((track.seed ^ 0x517e9d) >>> 0)
    const blobs = Array.from({ length: 14 }, () => ({
      u: rng(),
      v: 0.3 + rng() * 0.35,
      r: 0.015 + rng() * 0.05,
      c: rng() < 0.5 ? glow : edge,
      i: 0.6 + rng() * 1.6,
    }))
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1)
      // faint horizon band just below the midline
      const horizon = Math.exp(-Math.pow((v - 0.55) / 0.06, 2)) * 0.22
      for (let x = 0; x < W; x++) {
        const u = x / (W - 1)
        let r = glow.r * horizon
        let g = glow.g * horizon
        let b = glow.b * horizon
        for (const bl of blobs) {
          const du = Math.min(Math.abs(u - bl.u), 1 - Math.abs(u - bl.u)) // wrap seam
          const dv = v - bl.v
          const f = Math.exp(-(du * du + dv * dv) / (bl.r * bl.r)) * bl.i
          r += bl.c.r * f
          g += bl.c.g * f
          b += bl.c.b * f
        }
        const o = (y * W + x) * 4
        data[o] = Math.min(255, r * 255)
        data[o + 1] = Math.min(255, g * 255)
        data[o + 2] = Math.min(255, b * 255)
        data[o + 3] = 255
      }
    }
    const tex = new THREE.DataTexture(data, W, H)
    tex.mapping = THREE.EquirectangularReflectionMapping
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    scene.environment = tex
    scene.environmentIntensity = 0.45
    return () => {
      scene.environment = null
      tex.dispose()
    }
  }, [scene, track])

  return null
}

const WF_BARS = 96
const wfObj = new THREE.Object3D()

/**
 * T124 → T132: waveform horizon v2 — TWO offset rings of slim bars (far
 * ring tall + dim, near ring shorter + half-bar phase shifted) with glow
 * tip caps. Layered silhouette, not an EQ wall in your face. Heights sample
 * the song's energy around the current play position, heavily smoothed.
 */
export function WaveformHorizon({
  track,
  energyCurve,
  frameInterval,
}: {
  track: TrackData
  energyCurve: Float32Array
  frameInterval: number
}) {
  const farRef = useRef<THREE.InstancedMesh>(null)
  const nearRef = useRef<THREE.InstancedMesh>(null)
  const capRef = useRef<THREE.InstancedMesh>(null)
  const groupRef = useRef<THREE.Group>(null)
  const heights = useMemo(() => new Float32Array(WF_BARS * 2).fill(20), [])
  // sit just inside the fog falloff so the silhouette reads
  const radius = Math.min(900, 2.1 / track.theme.fogDensity)

  // T139: per-bar character — widths, height scale, palette mix, shade. A
  // skyline, not a uniform EQ. Seeded (render-side but deterministic).
  const barProps = useMemo(() => {
    const rng = mulberry32((track.seed ^ 0x5ca11e) >>> 0)
    return Array.from({ length: WF_BARS * 2 }, () => ({
      w: rngRange(rng, 0.45, 1.7),
      hMul: rngRange(rng, 0.6, 1.45),
      mixT: rng(),
      bright: rngRange(rng, 0.35, 1.1),
    }))
  }, [track.seed])

  // T149: skyline colors EVOLVE — base drifts toward the section palette
  // like the rails do, per-bar mix/shade variation layered on top
  const wfDrift = useMemo(
    () => ({
      base: new THREE.Color(track.theme.glow),
      target: new THREE.Color(track.theme.glow),
      edge: new THREE.Color(track.theme.edge),
      tmp: new THREE.Color(),
    }),
    [track.theme],
  )

  useFrame(({ camera }, dt) => {
    const group = groupRef.current
    if (!group || !farRef.current || !nearRef.current || !capRef.current) return
    group.position.set(camera.position.x, 0, camera.position.z)

    // T149: drift the skyline base color toward the live section palette
    const sectionColor = track.sectionPalettes[telemetry.sectionIndex]
    if (sectionColor) wfDrift.target.set(sectionColor)
    wfDrift.base.lerp(wfDrift.target, Math.min(1, dt * 0.4))
    const caps = capRef.current
    const near = nearRef.current
    for (let i = 0; i < WF_BARS; i++) {
      const p = barProps[WF_BARS + i]
      wfDrift.tmp.copy(wfDrift.base).lerp(wfDrift.edge, p.mixT).multiplyScalar(p.bright)
      caps.setColorAt(i, wfDrift.tmp)
      near.setColorAt(i, wfDrift.tmp.multiplyScalar(0.25))
    }
    if (caps.instanceColor) caps.instanceColor.needsUpdate = true
    if (near.instanceColor) near.instanceColor.needsUpdate = true

    const fi = Math.floor(telemetry.songTime / frameInterval)
    const layers = [
      // T139: far ring drifts SLOWER than the near one — parallax in time
      { mesh: farRef.current, r: radius, hMax: 230, base: 26, phase: 0, slot: 0, k: Math.min(1, dt * 0.5) },
      { mesh: nearRef.current, r: radius * 0.8, hMax: 130, base: 14, phase: Math.PI / WF_BARS, slot: 1, k: Math.min(1, dt * 1.6) },
    ]
    for (const L of layers) {
      for (let i = 0; i < WF_BARS; i++) {
        const off = Math.round((i - WF_BARS / 2) * 14) + L.slot * 7
        const idx = Math.min(energyCurve.length - 1, Math.max(0, fi + off))
        const e = energyCurve[idx] ?? 0
        const hi = L.slot * WF_BARS + i
        const props = barProps[hi]
        heights[hi] += (L.base + e * L.hMax * props.hMul - heights[hi]) * L.k
        const a = (i / WF_BARS) * Math.PI * 2 + L.phase
        const h = heights[hi]
        wfObj.position.set(Math.cos(a) * L.r, -85 + h / 2, Math.sin(a) * L.r)
        wfObj.rotation.set(0, -a, 0)
        // T139: per-bar width — towers, slivers, gaps
        wfObj.scale.set(L.r * 0.026 * props.w, h, 5 + props.w * 4)
        wfObj.updateMatrix()
        L.mesh.setMatrixAt(i, wfObj.matrix)
        // glow caps ride the NEAR ring tips only
        if (L.slot === 1) {
          wfObj.position.y = -85 + h
          wfObj.scale.set(L.r * 0.026 * props.w, 0.9 + props.w * 0.5, 5 + props.w * 4)
          wfObj.updateMatrix()
          capRef.current.setMatrixAt(i, wfObj.matrix)
        }
      }
      L.mesh.instanceMatrix.needsUpdate = true
    }
    capRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <group ref={groupRef}>
      <instancedMesh ref={farRef} args={[undefined, undefined, WF_BARS]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color="#04060e" metalness={0.2} roughness={0.9} emissive={track.theme.glow} emissiveIntensity={0.03} flatShading />
      </instancedMesh>
      <instancedMesh ref={nearRef} args={[undefined, undefined, WF_BARS]} frustumCulled={false}>
        <boxGeometry />
        <meshStandardMaterial color="#070a16" metalness={0.3} roughness={0.8} emissive={track.theme.glow} emissiveIntensity={0.06} flatShading />
      </instancedMesh>
      {/* tip caps — the skyline's faint neon crest (per-bar palette mix) */}
      <instancedMesh ref={capRef} args={[undefined, undefined, WF_BARS]} frustumCulled={false}>
        <boxGeometry />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}

/** T31: distant low-poly ridge silhouettes flanking the course. */
export function Ridges({ track, frames }: { track: TrackData; frames: TrackFrames }) {
  const matrices = useMemo(() => {
    const rng = mulberry32((track.seed ^ 0x9d2f33) >>> 0)
    const pose = {} as FramePose
    const obj = new THREE.Object3D()
    const out: THREE.Matrix4[] = []
    for (let s = 0; s < track.length; s += rngRange(rng, 380, 700)) {
      for (const side of [-1, 1]) {
        if (rng() < 0.3) continue
        const lateral = rngRange(rng, 170, 430)
        poseAt(frames, Math.min(s, track.length - 1), side * lateral, 0, pose)
        const h = rngRange(rng, 110, 300)
        // B28: radius must respect lateral clearance — 230m-wide cones placed
        // 170m out reached INTO the track corridor; their lit flat faces were
        // the mystery theme-colored "slab" at deck level
        const r = Math.min(rngRange(rng, 90, 230), lateral - 80)
        obj.position.set(pose.px, pose.py - 90, pose.pz)
        obj.scale.set(r, h, r)
        obj.rotation.set(0, rng() * Math.PI * 2, 0)
        obj.updateMatrix()
        out.push(obj.matrix.clone())
        if (out.length >= 240) return out
      }
    }
    return out
  }, [track, frames])

  return (
    <instancedMesh
      args={[undefined, undefined, Math.max(1, matrices.length)]}
      ref={(mesh) => {
        if (mesh) {
          matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
          mesh.instanceMatrix.needsUpdate = true
          mesh.frustumCulled = false
        }
      }}
    >
      <coneGeometry args={[1, 1, 5]} />
      <meshStandardMaterial color="#070a16" metalness={0.2} roughness={0.95} flatShading />
    </instancedMesh>
  )
}

const STREAKS = 36
const STREAK_RANGE = 200

/**
 * T33 → T111: warp streaks v2 — sparser, thinner, later onset, gentler
 * opacity. A whisper of hyperspace at the top end, not a particle storm.
 * Pure speed communication, V10-scaled.
 */
export function WarpStreaks({
  shipRef,
  track,
  speed,
  fxIntensity,
}: {
  shipRef: React.RefObject<THREE.Group | null>
  track: TrackData
  speed: () => number
  fxIntensity: number
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const groupRef = useRef<THREE.Group>(null)
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  const travel = useRef(0)

  const shards = useMemo(() => {
    const rng = mulberry32((track.seed ^ 0x51e4) >>> 0)
    return Array.from({ length: STREAKS }, () => ({
      angle: rng() * Math.PI * 2,
      radius: rngRange(rng, 8, 17),
      z0: rng() * STREAK_RANGE,
      len: rngRange(rng, 4, 9),
    }))
  }, [track.seed])

  const obj = useMemo(() => new THREE.Object3D(), [])

  useFrame((_, dt) => {
    const ship = shipRef.current
    const mesh = meshRef.current
    const group = groupRef.current
    if (!ship || !mesh || !group) return

    const v = speed()
    const vmax = shipVmax(track.avgSpeed, true) // single source (V12) — was a stale 3.0× copy
    // T111: later onset, subtle ceiling — present at pace, loud never
    const strength = (Math.max(0, (v / vmax - 0.6) / 0.4) + telemetry.beat * 0.08) * fxIntensity
    if (matRef.current) matRef.current.opacity = Math.min(0.34, strength * 0.4)
    mesh.visible = strength > 0.02
    if (!mesh.visible) return

    group.position.copy(ship.position)
    group.quaternion.copy(ship.quaternion)
    // ship model is yaw-flipped π; flip back so +z streams behind
    group.rotateY(Math.PI)

    travel.current = (travel.current + v * dt) % STREAK_RANGE
    for (let i = 0; i < STREAKS; i++) {
      const sh = shards[i]
      const z = ((sh.z0 + travel.current) % STREAK_RANGE) - STREAK_RANGE / 2
      obj.position.set(Math.cos(sh.angle) * sh.radius, Math.sin(sh.angle) * sh.radius, z)
      obj.rotation.set(0, 0, 0)
      obj.scale.set(0.032, 0.032, sh.len * (0.5 + strength * 2.6))
      obj.updateMatrix()
      mesh.setMatrixAt(i, obj.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, STREAKS]} frustumCulled={false}>
        <boxGeometry />
        <meshBasicMaterial
          ref={matRef}
          color="#cfe8ff"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  )
}
