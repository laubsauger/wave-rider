import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { abs, cameraPosition, color, fract, positionWorld, smoothstep, uniform } from 'three/tsl'
import { mulberry32, rngRange } from '../lib/prng'
import type { TrackData } from '../lib/track/generate'
import { poseAt, type FramePose, type TrackFrames } from '../lib/track/sample'
import { telemetry } from '../game/telemetry'

/**
 * T31: neon grid floor far below the track — world-space TSL grid, fades
 * with distance, breathes with the music.
 */
export function GridFloor({ track }: { track: TrackData }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const uPulse = useMemo(() => uniform(0.4), [])

  const material = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
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

  useFrame(({ camera }) => {
    // T57: the floor shimmers with the high end, not the beat
    uPulse.value = 0.2 + (telemetry.centroid * 0.55 + telemetry.energy * 0.15) * track.theme.pulse
    if (meshRef.current) meshRef.current.position.set(camera.position.x, -70, camera.position.z)
  })

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} material={material} frustumCulled={false}>
      <planeGeometry args={[3600, 3600, 1, 1]} />
    </mesh>
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
        poseAt(frames, Math.min(s, track.length - 1), side * rngRange(rng, 170, 430), 0, pose)
        const h = rngRange(rng, 110, 300)
        obj.position.set(pose.px, pose.py - 90, pose.pz)
        obj.scale.set(rngRange(rng, 90, 230), h, rngRange(rng, 90, 230))
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

const STREAKS = 64
const STREAK_RANGE = 180

/**
 * T33: warp streaks — a tube of thin light shards around the ship that
 * stream past at high speed. Pure speed communication, V10-scaled.
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
    const vmax = track.avgSpeed * 1.45 + 60
    // T40: kicks in earlier, beat-boosted, harder at the top end
    const strength = (Math.max(0, (v / vmax - 0.45) / 0.55) + telemetry.beat * 0.15) * fxIntensity
    if (matRef.current) matRef.current.opacity = Math.min(0.75, strength * 0.7)
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
      obj.scale.set(0.06, 0.06, sh.len * (0.6 + strength * 2.2))
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
