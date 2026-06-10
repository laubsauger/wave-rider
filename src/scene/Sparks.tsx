import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { mulberry32 } from '../lib/prng'

/**
 * R9e/T104: contact particles — wall-grind sparks shower off the scraping
 * side, airbrake sparks snap off the wingtips under hard scrub, landing
 * kicks up a dust puff. Pure render-side cosmetics (sim state is read-only),
 * pool-based instancing, everything scales with fxIntensity → 0 = off (V10).
 */

const SPARKS = 160
const DUST = 48
const G = 26

export interface SparkSource {
  onWall: boolean
  braking: boolean
  airborne: boolean
  v: number
  /** lateral offset — sign tells which wall is being ground */
  d: number
  /** landing impact pulse; Sparks clears it after spawning */
  landPulse: number
  clearLand: () => void
}

interface Pool {
  pos: Float32Array
  vel: Float32Array
  life: Float32Array
  maxLife: Float32Array
  cursor: number
  count: number
}

function makePool(count: number): Pool {
  return {
    pos: new Float32Array(count * 3),
    vel: new Float32Array(count * 3),
    life: new Float32Array(count),
    maxLife: new Float32Array(count),
    cursor: 0,
    count,
  }
}

const tmpLocal = new THREE.Vector3()
const tmpObj = new THREE.Object3D()

export function Sparks({
  shipRef,
  source,
  accent,
  fxIntensity,
}: {
  shipRef: React.RefObject<THREE.Group | null>
  source: () => SparkSource
  accent: string
  fxIntensity: number
}) {
  const sparkMesh = useRef<THREE.InstancedMesh>(null)
  const dustMesh = useRef<THREE.InstancedMesh>(null)
  const sparks = useMemo(() => makePool(SPARKS), [])
  const dust = useMemo(() => makePool(DUST), [])
  const rng = useMemo(() => mulberry32(0x59a47c1), [])
  const emitAcc = useRef({ grind: 0, brake: 0 })

  const spawn = (pool: Pool, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) => {
    const i = pool.cursor
    pool.cursor = (pool.cursor + 1) % pool.count
    pool.pos.set([x, y, z], i * 3)
    pool.vel.set([vx, vy, vz], i * 3)
    pool.life[i] = life
    pool.maxLife[i] = life
  }

  useFrame((_, dt) => {
    if (fxIntensity <= 0) {
      if (sparkMesh.current) sparkMesh.current.visible = false
      if (dustMesh.current) dustMesh.current.visible = false
      return
    }
    const ship = shipRef.current
    if (!ship) return
    const st = source()

    // world-space emit helper from ship-local offsets
    const local = (lx: number, ly: number, lz: number) => {
      tmpLocal.set(lx, ly, lz)
      return ship.localToWorld(tmpLocal)
    }
    // ship model is rotateY(π)-flipped: local +x renders on -d side, so
    // grind side in local space = +sign(d)
    const r = () => rng() * 2 - 1

    // wall grind: continuous shower while scraping, rate ∝ speed
    if (st.onWall && st.v > 20) {
      emitAcc.current.grind += dt * Math.min(160, st.v * 0.9) * fxIntensity
      const side = Math.sign(st.d) || 1
      while (emitAcc.current.grind >= 1) {
        emitAcc.current.grind -= 1
        const p = local(side * (1.1 + rng() * 0.3), 0.1, 0.4 + r() * 1.2)
        spawn(
          sparks,
          p.x, p.y, p.z,
          r() * 4, 2 + rng() * 7, r() * 4,
          0.25 + rng() * 0.3,
        )
      }
    }
    // airbrake scrub at speed: wingtip snaps
    if (st.braking && !st.airborne && st.v > 60) {
      emitAcc.current.brake += dt * 34 * fxIntensity
      while (emitAcc.current.brake >= 1) {
        emitAcc.current.brake -= 1
        const wing = rng() < 0.5 ? -1 : 1
        const p = local(wing * 1.2, 0.15, 0.7 + rng() * 0.5)
        spawn(sparks, p.x, p.y, p.z, r() * 3, 1.5 + rng() * 4, r() * 3, 0.18 + rng() * 0.2)
      }
    }
    // landing: one dust burst scaled by impact
    if (st.landPulse > 0) {
      const n = Math.min(DUST, Math.round(6 + st.landPulse * 0.5) | 0)
      for (let i = 0; i < n; i++) {
        const p = local(r() * 1.4, -0.3, r() * 1.6)
        spawn(dust, p.x, p.y, p.z, r() * 6, 1 + rng() * 3.5, r() * 6, 0.5 + rng() * 0.5)
      }
      st.clearLand()
    }

    // integrate + write instances
    const step = (pool: Pool, mesh: THREE.InstancedMesh | null, size: (a: number) => number, gravity: number) => {
      if (!mesh) return
      mesh.visible = true
      for (let i = 0; i < pool.count; i++) {
        if (pool.life[i] > 0) {
          pool.life[i] -= dt
          pool.vel[i * 3 + 1] -= gravity * dt
          pool.pos[i * 3] += pool.vel[i * 3] * dt
          pool.pos[i * 3 + 1] += pool.vel[i * 3 + 1] * dt
          pool.pos[i * 3 + 2] += pool.vel[i * 3 + 2] * dt
        }
        const a = Math.max(0, pool.life[i] / Math.max(1e-4, pool.maxLife[i]))
        tmpObj.position.set(pool.pos[i * 3], pool.pos[i * 3 + 1], pool.pos[i * 3 + 2])
        const s = pool.life[i] > 0 ? size(a) : 0
        tmpObj.scale.set(s, s, s)
        tmpObj.rotation.set(0, 0, 0)
        tmpObj.updateMatrix()
        mesh.setMatrixAt(i, tmpObj.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
    step(sparks, sparkMesh.current, (a) => 0.05 + a * 0.07, G)
    step(dust, dustMesh.current, (a) => 0.5 + (1 - a) * 1.3, 4)
  })

  return (
    <group>
      <instancedMesh ref={sparkMesh} args={[undefined, undefined, SPARKS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 2.4]} />
        <meshBasicMaterial
          color={new THREE.Color(accent).lerp(new THREE.Color('#ffe9c4'), 0.6)}
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh ref={dustMesh} args={[undefined, undefined, DUST]} frustumCulled={false}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshBasicMaterial
          color="#3a4258"
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  )
}
