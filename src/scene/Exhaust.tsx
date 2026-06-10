import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { attribute, color, float, mix, sin, smoothstep, sub, uniform } from 'three/tsl'

const POINTS = 38

interface TrailProps {
  /** ref to the ship group; engine offsets are in its local space */
  shipRef: React.RefObject<THREE.Group | null>
  offsets: [number, number, number][]
  color: string
  /** 0..1+ thrust/boost intensity, read per frame */
  intensity: () => number
}

/**
 * Exhaust v2 (T30): camera-facing ribbon with a TSL gradient — white-hot
 * core fading to accent at the edges, alpha falls off along the trail,
 * subtle flicker bands. Geometry rebuilt per frame from a position ring
 * buffer; the look lives in the shader, not vertex colors.
 */
export function ExhaustTrails({ shipRef, offsets, color: accent, intensity }: TrailProps) {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([])
  const uPower = useMemo(() => uniform(0), [])
  const uTime = useMemo(() => uniform(0), [])

  const material = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const u = attribute('uv').x // 0..1 across the ribbon
    const v = attribute('uv').y // 0..1 along the trail (age)
    const cross = sub(1, sub(u, 0.5).abs().mul(2)) // 1 center → 0 edges
    // T101: hot core is NARROW and fades with age — accent owns the trail,
    // white only kisses the first meters (was blooming everything to white)
    const core = smoothstep(0.78, 0.99, cross).mul(sub(1, v).pow(2))
    // T127: the head IS the flame — white-hot burst right at the nozzle,
    // power-scaled, melting into the accent trail
    const flameHead = sub(1, v).pow(8).mul(uPower.mul(0.9))
    m.colorNode = mix(color(new THREE.Color(accent)), color(new THREE.Color('#ffffff')), core.mul(0.6).add(flameHead).min(1)).mul(
      float(1.05).add(uPower.mul(0.45)).add(flameHead.mul(0.8)),
    )
    const flicker = sin(v.mul(26).sub(uTime.mul(34))).mul(0.12).add(0.88)
    m.opacityNode = cross
      .pow(1.6)
      .mul(sub(1, v).pow(2.6))
      .mul(uPower.min(1.5))
      .mul(flicker)
    return m
  }, [accent, uPower, uTime])

  const trails = useMemo(
    () =>
      offsets.map(() => {
        const uvs = new Float32Array(POINTS * 2 * 2)
        for (let i = 0; i < POINTS; i++) {
          const v = i / (POINTS - 1)
          uvs.set([0, v, 1, v], i * 4)
        }
        const idx = new Uint16Array((POINTS - 1) * 6)
        for (let i = 0; i < POINTS - 1; i++) {
          const a = i * 2
          idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6)
        }
        return {
          history: new Float32Array(POINTS * 3),
          filled: 0,
          positions: new Float32Array(POINTS * 2 * 3),
          uvs,
          indices: idx,
          // T50: fixed-rate emission state — no frame-paced stutter
          acc: 0,
          lastX: 0,
          lastY: 0,
          lastZ: 0,
          primed: false,
        }
      }),
    [offsets],
  )

  const tmp = useMemo(
    () => ({
      p: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      toCam: new THREE.Vector3(),
      side: new THREE.Vector3(),
    }),
    [],
  )

  const EMIT_DT = 1 / 90

  useFrame(({ camera, clock }, dt) => {
    const ship = shipRef.current
    if (!ship) return
    const power = intensity()
    uPower.value += (power - uPower.value) * 0.25
    uTime.value = clock.elapsedTime

    trails.forEach((trail, ti) => {
      const mesh = meshRefs.current[ti]
      if (!mesh) return

      tmp.p.set(...offsets[ti])
      ship.localToWorld(tmp.p)
      if (!trail.primed) {
        trail.lastX = tmp.p.x
        trail.lastY = tmp.p.y
        trail.lastZ = tmp.p.z
        trail.primed = true
      }

      // T50: emit at a fixed 90Hz, interpolating along this frame's motion —
      // history spacing stays even regardless of frame pacing
      trail.acc += Math.min(0.1, dt)
      let emits = Math.floor(trail.acc / EMIT_DT)
      if (emits > 0) {
        trail.acc -= emits * EMIT_DT
        emits = Math.min(emits, POINTS)
        for (let e = 1; e <= emits; e++) {
          const f = e / emits
          trail.history.copyWithin(3, 0, (POINTS - 1) * 3)
          trail.history[0] = trail.lastX + (tmp.p.x - trail.lastX) * f
          trail.history[1] = trail.lastY + (tmp.p.y - trail.lastY) * f
          trail.history[2] = trail.lastZ + (tmp.p.z - trail.lastZ) * f
          if (trail.filled < POINTS) trail.filled++
        }
        trail.lastX = tmp.p.x
        trail.lastY = tmp.p.y
        trail.lastZ = tmp.p.z
      } else {
        // keep the head glued to the engine between emits
        trail.history[0] = tmp.p.x
        trail.history[1] = tmp.p.y
        trail.history[2] = tmp.p.z
      }

      const n = trail.filled
      for (let i = 0; i < POINTS; i++) {
        const j = Math.max(0, Math.min(i, n - 1))
        const x = trail.history[j * 3]
        const y = trail.history[j * 3 + 1]
        const z = trail.history[j * 3 + 2]
        const k = Math.max(0, Math.min(j + 1, n - 1))
        tmp.dir.set(trail.history[k * 3] - x, trail.history[k * 3 + 1] - y, trail.history[k * 3 + 2] - z)
        tmp.toCam.set(camera.position.x - x, camera.position.y - y, camera.position.z - z)
        tmp.side.crossVectors(tmp.dir, tmp.toCam)
        const len = tmp.side.length()
        if (len > 1e-6) tmp.side.divideScalar(len)
        else tmp.side.set(0, 1, 0)

        const age = i / POINTS
        // T127: head at FULL width — it's the flame now, widest at the
        // nozzle, tapering down the trail
        const w = 0.22 * (1 - age * 0.72) * (0.3 + Math.min(1.5, power) * 0.65)
        trail.positions.set(
          [x + tmp.side.x * w, y + tmp.side.y * w, z + tmp.side.z * w, x - tmp.side.x * w, y - tmp.side.y * w, z - tmp.side.z * w],
          i * 6,
        )
      }

      const geo = mesh.geometry
      geo.attributes.position.array.set(trail.positions)
      geo.attributes.position.needsUpdate = true
      // B18: frustumCulled=false → no bounding sphere needed; computing it on
      // degenerate first-frame quads spammed NaN warnings
    })
  })

  return (
    <>
      {trails.map((trail, i) => (
        <mesh key={i} ref={(m) => void (meshRefs.current[i] = m)} frustumCulled={false} material={material}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[trail.positions, 3]} />
            <bufferAttribute attach="attributes-uv" args={[trail.uvs, 2]} />
            <bufferAttribute attach="index" args={[trail.indices, 1]} />
          </bufferGeometry>
        </mesh>
      ))}
    </>
  )
}
