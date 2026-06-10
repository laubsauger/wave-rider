import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { color, fract, smoothstep, uniform, uv } from 'three/tsl'
import type { TrackData } from '../lib/track/generate'
import type { TrackFrames } from '../lib/track/sample'
import { buildBoostPads, buildRail, buildRoad, buildWall, type RibbonGeometry } from '../lib/track/mesh'
import { telemetry } from '../game/telemetry'

function toGeometry(r: RibbonGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(r.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(r.indices, 1))
  return g
}

export function Track({ track, frames }: { track: TrackData; frames: TrackFrames }) {
  const railMats = useRef<(THREE.MeshStandardMaterial | null)[]>([])
  const padMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#031',
        emissive: track.theme.glow,
        emissiveIntensity: 2.4,
        toneMapped: false,
      }),
    [track.theme.glow],
  )

  const geo = useMemo(() => {
    return {
      road: toGeometry(buildRoad(track, frames)),
      railL: toGeometry(buildRail(track, frames, -1)),
      railR: toGeometry(buildRail(track, frames, 1)),
      wallL: toGeometry(buildWall(track, frames, -1)),
      wallR: toGeometry(buildWall(track, frames, 1)),
      pads: buildBoostPads(track, frames),
    }
  }, [track, frames])

  // T22: road surface = deep black + lateral glow stripes every 20m (speed
  // cue) + dashed center line. Stripe brightness rides the music (T21).
  const uEnergy = useMemo(() => uniform(0), [])
  const roadMat = useMemo(() => {
    const m = new THREE.MeshStandardNodeMaterial({
      color: new THREE.Color(track.theme.road),
      metalness: 0.55,
      roughness: 0.38,
    })
    const glow = color(new THREE.Color(track.theme.glow))
    const edge = color(new THREE.Color(track.theme.edge))
    const v = fract(uv().y)
    const stripe = smoothstep(0.93, 0.965, v).sub(smoothstep(0.965, 1.0, v))
    const xDist = uv().x.sub(0.5).abs()
    const f3 = fract(uv().y.mul(3))
    const dashGate = smoothstep(0.02, 0.08, f3).mul(smoothstep(0.62, 0.55, f3))
    const dash = smoothstep(0.02, 0.011, xDist).mul(dashGate)
    m.emissiveNode = glow
      .mul(stripe.mul(uEnergy.mul(1.6).add(0.4)))
      .add(edge.mul(dash.mul(0.45)))
      .add(glow.mul(0.05))
    return m
  }, [track.theme, uEnergy])

  // audio-reactive pulse (T21) — V10-safe: brightness only
  useFrame(() => {
    const e = telemetry.energy * track.theme.pulse
    uEnergy.value = e
    for (const mat of railMats.current) {
      if (mat) mat.emissiveIntensity = 1.6 + e * 2.8
    }
    padMaterial.emissiveIntensity = 2.2 + e * 2.5
  })

  const padQuats = useMemo(
    () =>
      geo.pads.map((p) => {
        const m = new THREE.Matrix4().lookAt(
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(p.tx, p.ty, p.tz),
          new THREE.Vector3(p.nx, p.ny, p.nz),
        )
        return new THREE.Quaternion().setFromRotationMatrix(m)
      }),
    [geo.pads],
  )

  return (
    <group>
      <mesh geometry={geo.road} material={roadMat} receiveShadow />
      {[geo.railL, geo.railR].map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial
            ref={(m) => void (railMats.current[i] = m)}
            color="#000000"
            emissive={track.theme.edge}
            emissiveIntensity={1.8}
            toneMapped={false}
          />
        </mesh>
      ))}
      {[geo.wallL, geo.wallR].map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial
            color={track.theme.road}
            emissive={track.theme.glow}
            emissiveIntensity={0.15}
            transparent
            opacity={0.85}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      <group>
        {geo.pads.map((p, i) => (
          <mesh key={i} position={[p.x, p.y, p.z]} quaternion={padQuats[i]} material={padMaterial}>
            <boxGeometry args={[4.4, 0.12, 14]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
