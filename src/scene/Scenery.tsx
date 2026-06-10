import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { mulberry32, rngRange } from '../lib/prng'
import type { TrackData } from '../lib/track/generate'
import { poseAt, type FramePose, type TrackFrames } from '../lib/track/sample'
import { telemetry } from '../game/telemetry'

const MAX_PYLONS = 900
const MAX_RINGS = 120

/**
 * Trackside geometry (T18, C11): instanced neon pylons rising from the void,
 * arch gates at section changes, holo rings over high-energy stretches.
 * Seeded from track.seed (V8) — same song, same skyline.
 */
export function Scenery({ track, frames }: { track: TrackData; frames: TrackFrames }) {
  const pylonGlowMat = useRef<THREE.MeshStandardMaterial>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const archMat = useRef<THREE.MeshStandardMaterial>(null)

  const data = useMemo(() => {
    const rng = mulberry32((track.seed ^ 0x777aa1) >>> 0)
    const pose = {} as FramePose
    const obj = new THREE.Object3D()
    const halfW = track.width / 2

    // pylons — alternating sides, varied height/distance
    const pylonMatrices: THREE.Matrix4[] = []
    const glowMatrices: THREE.Matrix4[] = []
    const spacing = Math.max(90, track.length / (MAX_PYLONS / 2))
    for (let s = 60; s < track.length - 60; s += spacing * rngRange(rng, 0.7, 1.3)) {
      for (const side of [-1, 1]) {
        if (rng() < 0.25) continue
        const lateral = side * (halfW + rngRange(rng, 7, 26))
        const h = rngRange(rng, 8, 34)
        poseAt(frames, s, lateral, 0, pose)
        obj.position.set(pose.px, pose.py + h / 2 - 26, pose.pz)
        obj.rotation.set(0, rng() * Math.PI, 0)
        obj.scale.set(rngRange(rng, 0.9, 2.2), h, rngRange(rng, 0.9, 2.2))
        obj.updateMatrix()
        pylonMatrices.push(obj.matrix.clone())
        // glow cap on top
        obj.position.y += h / 2 + 0.4
        obj.scale.set(obj.scale.x * 1.1, 0.5, obj.scale.z * 1.1)
        obj.updateMatrix()
        glowMatrices.push(obj.matrix.clone())
      }
    }

    // arch gates at section boundaries
    const archMatrices: THREE.Matrix4[] = []
    const up = new THREE.Vector3()
    const tangent = new THREE.Vector3()
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    for (const seg of track.segments) {
      if (seg.sectionIndex === 0 && seg.start === 0) continue
      const prev = track.segments.find((x) => x.end === seg.start)
      if (!prev || prev.sectionIndex === seg.sectionIndex) continue
      const s = seg.start
      poseAt(frames, s, 0, 0, pose)
      tangent.set(pose.tx, pose.ty, pose.tz)
      up.set(pose.nx, pose.ny, pose.nz)
      m.lookAt(new THREE.Vector3(0, 0, 0), tangent, up)
      q.setFromRotationMatrix(m)
      for (const part of [-1, 0, 1]) {
        obj.quaternion.copy(q)
        if (part === 0) {
          // lintel
          obj.position.set(pose.px + up.x * (halfW + 4), pose.py + up.y * (halfW + 4), pose.pz + up.z * (halfW + 4))
          obj.scale.set(track.width + 7, 1.1, 1.1)
        } else {
          const bx = pose.bx * part * (halfW + 2.8)
          const by = pose.by * part * (halfW + 2.8)
          const bz = pose.bz * part * (halfW + 2.8)
          obj.position.set(
            pose.px + bx + up.x * (halfW + 4) * 0.5,
            pose.py + by + up.y * (halfW + 4) * 0.5,
            pose.pz + bz + up.z * (halfW + 4) * 0.5,
          )
          obj.scale.set(1.1, halfW + 4, 1.1)
        }
        obj.updateMatrix()
        archMatrices.push(obj.matrix.clone())
      }
    }

    // holo rings over high-energy sections
    const ringMatrices: THREE.Matrix4[] = []
    for (const seg of track.segments) {
      if (ringMatrices.length >= MAX_RINGS) break
      const sectionEnergy = track.sectionEnergies[seg.sectionIndex] ?? 0.5
      if (sectionEnergy < 0.55) continue
      for (let s = seg.start + 120; s < seg.end - 60; s += 420) {
        if (ringMatrices.length >= MAX_RINGS) break
        poseAt(frames, s, 0, 7, pose)
        tangent.set(pose.tx, pose.ty, pose.tz)
        up.set(pose.nx, pose.ny, pose.nz)
        m.lookAt(new THREE.Vector3(0, 0, 0), tangent, up)
        q.setFromRotationMatrix(m)
        obj.quaternion.copy(q)
        obj.position.set(pose.px, pose.py, pose.pz)
        const r = rngRange(rng, 0.9, 1.25)
        obj.scale.set(r, r, r)
        obj.updateMatrix()
        ringMatrices.push(obj.matrix.clone())
      }
    }

    return { pylonMatrices, glowMatrices, archMatrices, ringMatrices }
  }, [track, frames])

  // beat-reactive glow (T21) — V10-safe: brightness only, no motion
  useFrame(() => {
    const e = telemetry.energy * track.theme.pulse
    if (pylonGlowMat.current) pylonGlowMat.current.emissiveIntensity = 0.8 + e * 3
    if (archMat.current) archMat.current.emissiveIntensity = 1.2 + e * 3.5
    if (ringMat.current) ringMat.current.opacity = 0.25 + e * 0.5
  })

  return (
    <group>
      <Instanced matrices={data.pylonMatrices}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#0c0f1c" metalness={0.7} roughness={0.5} emissive={track.theme.glow} emissiveIntensity={0.06} />
      </Instanced>
      <Instanced matrices={data.glowMatrices}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={pylonGlowMat} color="#000" emissive={track.theme.edge} emissiveIntensity={1.2} toneMapped={false} />
      </Instanced>
      <Instanced matrices={data.archMatrices}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial ref={archMat} color="#05060f" emissive={track.theme.glow} emissiveIntensity={1.6} toneMapped={false} />
      </Instanced>
      <Instanced matrices={data.ringMatrices}>
        <torusGeometry args={[10, 0.35, 8, 48]} />
        <meshBasicMaterial
          ref={ringMat}
          color={track.theme.edge}
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </Instanced>
    </group>
  )
}

function Instanced({ matrices, children }: { matrices: THREE.Matrix4[]; children: React.ReactNode }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const count = matrices.length

  useMemo(() => {
    // populated on first render via callback ref below
  }, [])

  return (
    <instancedMesh
      ref={(mesh) => {
        ref.current = mesh
        if (mesh) {
          for (let i = 0; i < count; i++) mesh.setMatrixAt(i, matrices[i])
          mesh.instanceMatrix.needsUpdate = true
          mesh.frustumCulled = false
        }
      }}
      args={[undefined, undefined, Math.max(1, count)]}
    >
      {children}
    </instancedMesh>
  )
}
