import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'

/**
 * Procedural AG ship built from primitives — sleek dart hull, twin engine
 * nacelles, neon trim. Nose points -Z (three.js forward).
 */
export function ShipMesh({
  accent = '#2ff3ff',
  boost = 0,
  power,
}: {
  accent?: string
  boost?: number
  /** optional per-frame thrust/boost intensity 0..2 — drives flame cones */
  power?: () => number
}) {
  const engineL = useRef<THREE.MeshStandardMaterial>(null)
  const engineR = useRef<THREE.MeshStandardMaterial>(null)
  const flameL = useRef<THREE.Mesh>(null)
  const flameR = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    const p = power ? power() : boost
    const flicker = 2.2 + Math.sin(clock.elapsedTime * 31) * 0.35 + p * 4
    if (engineL.current) engineL.current.emissiveIntensity = flicker
    if (engineR.current) engineR.current.emissiveIntensity = flicker
    // cone local axis is Y (rotated into +Z): scale.y sets length, recenter so
    // the base stays glued to the nacelle
    const len = Math.max(0.001, 0.3 + p * 2.2 + Math.sin(clock.elapsedTime * 47) * 0.12 * p)
    for (const f of [flameL.current, flameR.current]) {
      if (f) {
        f.scale.y = len
        f.position.z = 0.62 + len * 0.5
        f.visible = p > 0.02
      }
    }
  })

  return (
    <group>
      {/* hull — stretched octahedron-ish dart */}
      <mesh scale={[0.9, 0.28, 2.4]}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshStandardMaterial color="#c8d4e8" metalness={0.85} roughness={0.25} flatShading />
      </mesh>
      {/* canopy */}
      <mesh position={[0, 0.22, -0.35]} scale={[0.34, 0.16, 0.8]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#0a1428" metalness={0.4} roughness={0.05} emissive={accent} emissiveIntensity={0.25} />
      </mesh>
      {/* wings */}
      <mesh position={[0, -0.05, 0.55]} scale={[2.5, 0.07, 0.9]}>
        <boxGeometry />
        <meshStandardMaterial color="#9aa8c0" metalness={0.85} roughness={0.3} flatShading />
      </mesh>
      {/* nacelles + engine glow */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 1.05, -0.02, 0.85]}>
          <mesh scale={[0.22, 0.22, 0.9]}>
            <cylinderGeometry args={[1, 0.8, 1, 8]} />
            <meshStandardMaterial color="#3a4458" metalness={0.9} roughness={0.35} flatShading />
          </mesh>
          <mesh position={[0, 0, 0.5]} scale={[0.16, 0.16, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[1, 1, 1, 10]} />
            <meshStandardMaterial
              ref={side < 0 ? engineL : engineR}
              color="#000000"
              emissive={accent}
              emissiveIntensity={2.2}
              toneMapped={false}
            />
          </mesh>
          {/* flame cone, points backwards (+z), z-scale driven by power */}
          <mesh ref={side < 0 ? flameL : flameR} position={[0, 0, 0.62]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.13, 1, 8, 1, true]} />
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
      {/* neon trim strip */}
      <mesh position={[0, -0.12, 0]} scale={[0.95, 0.03, 2.3]}>
        <boxGeometry />
        <meshStandardMaterial color="#000000" emissive={accent} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
    </group>
  )
}
