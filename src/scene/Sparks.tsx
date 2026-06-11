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
/** T153: hot orange embers — heavier, shorter-lived, layered over the sparks */
const EMBERS = 120
/** explosion fireball blobs — expanding hot spheres, hang then die */
const FIRE = 36
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
  /** T153: wall impact pulse — ember burst; Sparks clears it */
  wallPulse: number
  clearWall: () => void
  /** hull explosion pulse — full fireball + debris shower; Sparks clears it */
  explodePulse: number
  clearExplode: () => void
}

interface Pool {
  pos: Float32Array
  vel: Float32Array
  life: Float32Array
  maxLife: Float32Array
  cursor: number
  count: number
  /** live particles after the last step — 0 + no spawns ⇒ skip everything */
  alive: number
  /** a spawn happened since the last step */
  dirty: boolean
}

function makePool(count: number): Pool {
  return {
    pos: new Float32Array(count * 3),
    vel: new Float32Array(count * 3),
    life: new Float32Array(count),
    maxLife: new Float32Array(count),
    cursor: 0,
    count,
    alive: 0,
    dirty: false,
  }
}

const tmpLocal = new THREE.Vector3()
const tmpObj = new THREE.Object3D()
const tmpVel = new THREE.Vector3()

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
  const emberMesh = useRef<THREE.InstancedMesh>(null)
  const fireMesh = useRef<THREE.InstancedMesh>(null)
  const sparks = useMemo(() => makePool(SPARKS), [])
  const dust = useMemo(() => makePool(DUST), [])
  const embers = useMemo(() => makePool(EMBERS), [])
  const fire = useMemo(() => makePool(FIRE), [])
  const rng = useMemo(() => mulberry32(0x59a47c1), [])
  const emitAcc = useRef({ grind: 0, brake: 0, ember: 0 })

  const spawn = (pool: Pool, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) => {
    const i = pool.cursor
    pool.cursor = (pool.cursor + 1) % pool.count
    // T173: indexed writes — `.set([x,y,z])` allocated 2 arrays per particle
    const o = i * 3
    pool.pos[o] = x
    pool.pos[o + 1] = y
    pool.pos[o + 2] = z
    pool.vel[o] = vx
    pool.vel[o + 1] = vy
    pool.vel[o + 2] = vz
    pool.life[i] = life
    pool.maxLife[i] = life
    pool.dirty = true
  }

  useFrame((_, dt) => {
    if (fxIntensity <= 0) {
      if (sparkMesh.current) sparkMesh.current.visible = false
      if (dustMesh.current) dustMesh.current.visible = false
      if (emberMesh.current) emberMesh.current.visible = false
      if (fireMesh.current) fireMesh.current.visible = false
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
      // T153: ember stream rides the grind — hot, heavy, dies fast
      emitAcc.current.ember += dt * Math.min(110, st.v * 0.6) * fxIntensity
      while (emitAcc.current.ember >= 1) {
        emitAcc.current.ember -= 1
        const p = local(side * (1.15 + rng() * 0.25), 0.05, 0.2 + r() * 1.4)
        spawn(embers, p.x, p.y, p.z, r() * 6, 1 + rng() * 5, 4 + r() * 6, 0.12 + rng() * 0.22)
      }
    }
    // T153: wall IMPACT → ember burst, count ∝ hit speed
    if (st.wallPulse > 0) {
      const n = Math.min(EMBERS, Math.round(8 + st.wallPulse * 0.8))
      const side = Math.sign(st.d) || 1
      for (let i = 0; i < n; i++) {
        const p = local(side * (1.1 + rng() * 0.4), 0.1 + rng() * 0.4, r() * 1.6)
        spawn(embers, p.x, p.y, p.z, side * (2 + rng() * 6) + r() * 3, 2 + rng() * 6, r() * 8, 0.15 + rng() * 0.3)
      }
      st.clearWall()
    }
    // hull EXPLOSION — this is the death you're supposed to SEE: a fireball
    // of expanding hot blobs + a full-sphere shower of fast embers + white
    // debris streaks. Dwarfs a wall hit by an order of magnitude.
    if (st.explodePulse > 0) {
      for (let i = 0; i < FIRE; i++) {
        const p = local(r() * 1.2, 0.2 + rng() * 0.6, r() * 1.4)
        spawn(fire, p.x, p.y, p.z, r() * 9, 2 + rng() * 8, r() * 9, 0.45 + rng() * 0.45)
      }
      for (let i = 0; i < 100; i++) {
        const p = local(r() * 0.8, 0.2 + rng() * 0.5, r() * 0.9)
        // omnidirectional, FAST — debris, not a sprinkle
        spawn(embers, p.x, p.y, p.z, r() * 26, 4 + rng() * 22, r() * 26, 0.5 + rng() * 0.7)
      }
      for (let i = 0; i < 70; i++) {
        const p = local(r() * 0.6, 0.3 + rng() * 0.4, r() * 0.7)
        spawn(sparks, p.x, p.y, p.z, r() * 34, 6 + rng() * 26, r() * 34, 0.4 + rng() * 0.6)
      }
      st.clearExplode()
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

    // T173: a pool with nothing alive and nothing spawned is a no-op — skip
    // the integrate loop AND the draw entirely (matrix writes were running
    // for all ~360 slots every frame even with zero particles)
    const idle = (pool: Pool, mesh: THREE.InstancedMesh | null) => {
      if (pool.alive === 0 && !pool.dirty) {
        if (mesh) mesh.visible = false
        return true
      }
      return false
    }

    // integrate + write instances — blob mode (dust) for soft puffs
    const step = (pool: Pool, mesh: THREE.InstancedMesh | null, size: (a: number) => number, gravity: number) => {
      if (!mesh || idle(pool, mesh)) return
      pool.dirty = false
      let alive = 0
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
        if (pool.life[i] > 0) alive++
        tmpObj.scale.set(s, s, s)
        tmpObj.rotation.set(0, 0, 0)
        tmpObj.updateMatrix()
        mesh.setMatrixAt(i, tmpObj.matrix)
      }
      pool.alive = alive
      mesh.visible = true
      mesh.instanceMatrix.needsUpdate = true
    }

    // T153v2: streak mode — needle-thin, stretched along velocity. Sparks
    // AND embers both; only dust stays a puff (it's dust).
    const stepStreaks = (pool: Pool, mesh: THREE.InstancedMesh | null, thick: number, lenK: number, gravity: number) => {
      if (!mesh || idle(pool, mesh)) return
      pool.dirty = false
      let alive = 0
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
        const vx = pool.vel[i * 3]
        const vy = pool.vel[i * 3 + 1]
        const vz = pool.vel[i * 3 + 2]
        const speed = Math.hypot(vx, vy, vz)
        if (pool.life[i] > 0 && speed > 0.01) {
          tmpVel.set(tmpObj.position.x + vx, tmpObj.position.y + vy, tmpObj.position.z + vz)
          tmpObj.lookAt(tmpVel)
          tmpObj.scale.set(thick, thick, (0.18 + speed * lenK) * a + 0.04)
          alive++
        } else {
          tmpObj.scale.setScalar(0)
        }
        tmpObj.updateMatrix()
        mesh.setMatrixAt(i, tmpObj.matrix)
      }
      pool.alive = alive
      mesh.visible = true
      mesh.instanceMatrix.needsUpdate = true
    }

    stepStreaks(sparks, sparkMesh.current, 0.022, 0.05, G)
    step(dust, dustMesh.current, (a) => 0.5 + (1 - a) * 1.3, 4)
    stepStreaks(embers, emberMesh.current, 0.016, 0.035, 44)
    // fireball: blobs EXPAND as they die, light gravity so the cloud hangs
    step(fire, fireMesh.current, (a) => 0.5 + (1 - a) * 4.2, 6)
  }, 0.5) // B34: after pose writers

  return (
    <group>
      <instancedMesh ref={sparkMesh} args={[undefined, undefined, SPARKS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color={new THREE.Color(accent).lerp(new THREE.Color('#ffffff'), 0.7).multiplyScalar(2)}
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      {/* T153v2: ember layer — needle streaks, over-bright core so bloom
          draws the hot line, not an orange puff */}
      <instancedMesh ref={emberMesh} args={[undefined, undefined, EMBERS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color={new THREE.Color('#ffa040').multiplyScalar(2.4)}
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      {/* explosion fireball — hot expanding spheres, additive so the cluster
          blooms into one mass */}
      <instancedMesh ref={fireMesh} args={[undefined, undefined, FIRE]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshBasicMaterial
          color={new THREE.Color('#ff7a30').multiplyScalar(2.2)}
          transparent
          opacity={0.42}
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
