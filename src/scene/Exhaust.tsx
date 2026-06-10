import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'

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
 * Engine exhaust ribbons (T17): camera-facing strips rebuilt per frame from
 * a ring buffer of past engine positions. Additive, fades with age.
 */
export function ExhaustTrails({ shipRef, offsets, color, intensity }: TrailProps) {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([])
  const c = useMemo(() => new THREE.Color(color), [color])

  const trails = useMemo(
    () =>
      offsets.map(() => ({
        history: new Float32Array(POINTS * 3),
        filled: 0,
        positions: new Float32Array(POINTS * 2 * 3),
        colors: new Float32Array(POINTS * 2 * 4),
        indices: (() => {
          const idx = new Uint16Array((POINTS - 1) * 6)
          for (let i = 0; i < POINTS - 1; i++) {
            const a = i * 2
            idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6)
          }
          return idx
        })(),
      })),
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

  useFrame(({ camera }) => {
    const ship = shipRef.current
    if (!ship) return
    const power = intensity()

    trails.forEach((trail, ti) => {
      const mesh = meshRefs.current[ti]
      if (!mesh) return

      // shift history, append current engine world pos
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
        const w = 0.16 * (1 - age) * (0.25 + power * 0.7)
        trail.positions.set(
          [x + tmp.side.x * w, y + tmp.side.y * w, z + tmp.side.z * w, x - tmp.side.x * w, y - tmp.side.y * w, z - tmp.side.z * w],
          i * 6,
        )
        const alpha = (1 - age) ** 3 * Math.min(1, power * 1.2)
        trail.colors.set([c.r, c.g, c.b, alpha, c.r, c.g, c.b, alpha], i * 8)
      }

      const geo = mesh.geometry
      geo.attributes.position.array.set(trail.positions)
      geo.attributes.position.needsUpdate = true
      geo.attributes.color.array.set(trail.colors)
      geo.attributes.color.needsUpdate = true
      geo.computeBoundingSphere()
    })
  })

  return (
    <>
      {trails.map((trail, i) => (
        <mesh key={i} ref={(m) => void (meshRefs.current[i] = m)} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[trail.positions, 3]} />
            <bufferAttribute attach="attributes-color" args={[trail.colors, 4]} />
            <bufferAttribute attach="index" args={[trail.indices, 1]} />
          </bufferGeometry>
          <meshBasicMaterial
            vertexColors
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </>
  )
}
