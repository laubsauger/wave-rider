import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { attribute, color, float, mix, sin, smoothstep, sub, uniform } from 'three/tsl'

const POINTS = 26

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
    const core = smoothstep(0.45, 0.95, cross) // white-hot center band
    m.colorNode = mix(color(new THREE.Color(accent)), color(new THREE.Color('#ffffff')), core).mul(
      float(1.6).add(uPower),
    )
    const flicker = sin(v.mul(26).sub(uTime.mul(34))).mul(0.12).add(0.88)
    m.opacityNode = cross
      .pow(1.6)
      .mul(sub(1, v).pow(2.6))
      .mul(uPower.min(1.2))
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

  useFrame(({ camera, clock }) => {
    const ship = shipRef.current
    if (!ship) return
    const power = intensity()
    uPower.value += (power - uPower.value) * 0.25
    uTime.value = clock.elapsedTime

    trails.forEach((trail, ti) => {
      const mesh = meshRefs.current[ti]
      if (!mesh) return

      trail.history.copyWithin(3, 0, (POINTS - 1) * 3)
      tmp.p.set(...offsets[ti])
      ship.localToWorld(tmp.p)
      trail.history[0] = tmp.p.x
      trail.history[1] = tmp.p.y
      trail.history[2] = tmp.p.z
      if (trail.filled < POINTS) trail.filled++

      const n = trail.filled
      for (let i = 0; i < POINTS; i++) {
        const j = Math.min(i, n - 1)
        const x = trail.history[j * 3]
        const y = trail.history[j * 3 + 1]
        const z = trail.history[j * 3 + 2]
        const k = Math.min(j + 1, n - 1)
        tmp.dir.set(trail.history[k * 3] - x, trail.history[k * 3 + 1] - y, trail.history[k * 3 + 2] - z)
        tmp.toCam.set(camera.position.x - x, camera.position.y - y, camera.position.z - z)
        tmp.side.crossVectors(tmp.dir, tmp.toCam)
        const len = tmp.side.length()
        if (len > 1e-6) tmp.side.divideScalar(len)
        else tmp.side.set(0, 1, 0)

        const age = i / POINTS
        const w = 0.15 * (1 - age * 0.75) * (0.3 + Math.min(1.4, power) * 0.6)
        trail.positions.set(
          [x + tmp.side.x * w, y + tmp.side.y * w, z + tmp.side.z * w, x - tmp.side.x * w, y - tmp.side.y * w, z - tmp.side.z * w],
          i * 6,
        )
      }

      const geo = mesh.geometry
      geo.attributes.position.array.set(trail.positions)
      geo.attributes.position.needsUpdate = true
      geo.computeBoundingSphere()
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
