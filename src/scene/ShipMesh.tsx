import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'

/**
 * Ship v2 (T29): arrow dart — long flattened-diamond fuselage, needle nose,
 * swept delta wings, twin nacelles, fin. Low-poly silhouette, modern
 * materials: clearcoat hull + emissive trim. Nose points -Z.
 */

function deltaWingGeometry(span: number, chord: number, sweep: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.lineTo(span, sweep)
  shape.lineTo(span * 0.92, sweep + chord * 0.45)
  shape.lineTo(0.12, chord)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false })
  geo.rotateX(Math.PI / 2)
  return geo
}

export function ShipMesh({
  accent = '#2ff3ff',
  boost = 0,
  power,
  variant = 0,
}: {
  accent?: string
  boost?: number
  /** optional per-frame thrust/boost intensity 0..2 — drives flame cones */
  power?: () => number
  /** T41: 0 dart (hero), 1 talon (forward-swept), 2 manta (wide flat) */
  variant?: 0 | 1 | 2
}) {
  const engineL = useRef<THREE.MeshStandardMaterial>(null)
  const engineR = useRef<THREE.MeshStandardMaterial>(null)
  const flameL = useRef<THREE.Mesh>(null)
  const flameR = useRef<THREE.Mesh>(null)

  // T36/T41: pod-racer proportions — narrow span, long body; per-variant wings
  const wingGeo = useMemo(() => {
    if (variant === 1) return deltaWingGeometry(1.15, 0.7, -0.5) // talon: forward swept
    if (variant === 2) return deltaWingGeometry(1.55, 1.1, 0.35) // manta: broad blade
    return deltaWingGeometry(1.05, 0.85, 0.62)
  }, [variant])
  const nacelleX = variant === 2 ? 0.85 : 0.58
  const finScale: [number, number, number] =
    variant === 1 ? [0.05, 0.9, 0.4] : variant === 2 ? [0.05, 0.001, 0.001] : [0.05, 0.65, 0.5]
  const hull = useMemo(
    () => ({ color: '#aeb9d6', metalness: 0.92, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, flatShading: true }),
    [],
  )

  useFrame(({ clock }) => {
    const p = power ? power() : boost
    const flicker = 2.2 + Math.sin(clock.elapsedTime * 31) * 0.35 + p * 4
    if (engineL.current) engineL.current.emissiveIntensity = flicker
    if (engineR.current) engineR.current.emissiveIntensity = flicker
    // cone local axis is Y (rotated into +Z): scale.y sets length, recenter
    // so the base stays glued to the nacelle
    const len = Math.max(0.001, 0.3 + p * 2.4 + Math.sin(clock.elapsedTime * 47) * 0.14 * p)
    for (const f of [flameL.current, flameR.current]) {
      if (f) {
        f.scale.y = len
        f.position.z = 0.55 + len * 0.5
        f.visible = p > 0.02
      }
    }
  })

  return (
    <group castShadow>
      {/* fuselage — long narrow diamond cross-section */}
      <mesh castShadow scale={[0.36, 0.24, 2.5]} rotation={[0, 0, Math.PI / 4]}>
        <cylinderGeometry args={[0.42, 0.56, 1, 4, 1]} />
        <meshPhysicalMaterial {...hull} />
      </mesh>
      {/* needle nose — most of the ship's length */}
      <mesh castShadow position={[0, -0.01, -2.6]} rotation={[-Math.PI / 2, Math.PI / 4, 0]} scale={[0.27, 3.2, 0.15]}>
        <coneGeometry args={[0.5, 1, 4]} />
        <meshPhysicalMaterial {...hull} />
      </mesh>
      {/* canopy */}
      <mesh position={[0, 0.17, -0.55]} scale={[0.2, 0.11, 0.8]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshPhysicalMaterial
          color="#060d20"
          metalness={0.2}
          roughness={0.05}
          clearcoat={1}
          emissive={accent}
          emissiveIntensity={0.3}
        />
      </mesh>
      {/* swept delta wings — short span, racing trim */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          castShadow
          geometry={wingGeo}
          position={[side * 0.28, -0.05, -0.35]}
          scale={[side, 1, 1]}
        >
          <meshPhysicalMaterial {...hull} color="#8e9cc0" />
        </mesh>
      ))}
      {/* wingtip accent edges */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 1.3, -0.05, 0.42]} scale={[0.05, 0.14, 0.85]}>
          <boxGeometry />
          <meshStandardMaterial color="#000" emissive={accent} emissiveIntensity={2.4} toneMapped={false} />
        </mesh>
      ))}
      {/* tail fin (manta variant drops it) */}
      <mesh castShadow position={[0, 0.26, 1.45]} rotation={[0.5, 0, 0]} scale={finScale}>
        <boxGeometry />
        <meshPhysicalMaterial {...hull} color="#8e9cc0" />
      </mesh>
      {/* dorsal intake greeble */}
      <mesh castShadow position={[0, 0.16, 0.5]} scale={[0.22, 0.1, 0.6]}>
        <boxGeometry />
        <meshPhysicalMaterial {...hull} color="#39435c" />
      </mesh>
      {/* nacelles + engine glow + flames */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * nacelleX, -0.04, 0.85]}>
          <mesh castShadow scale={[0.2, 0.2, 1.15]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.9, 1.05, 1, 6]} />
            <meshPhysicalMaterial {...hull} color="#39435c" />
          </mesh>
          <mesh position={[0, 0, 0.6]} scale={[0.15, 0.15, 0.08]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[1, 1, 1, 10]} />
            <meshStandardMaterial
              ref={side < 0 ? engineL : engineR}
              color="#000000"
              emissive={accent}
              emissiveIntensity={2.2}
              toneMapped={false}
            />
          </mesh>
          {/* flame cone, points backwards (+z), y-scale = length */}
          <mesh ref={side < 0 ? flameL : flameR} position={[0, 0, 0.55]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.12, 1, 8, 1, true]} />
            <meshBasicMaterial
              color={accent}
              transparent
              opacity={0.85}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      {/* belly trim strip */}
      <mesh position={[0, -0.13, -0.6]} scale={[0.3, 0.03, 3.2]}>
        <boxGeometry />
        <meshStandardMaterial color="#000000" emissive={accent} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
    </group>
  )
}
