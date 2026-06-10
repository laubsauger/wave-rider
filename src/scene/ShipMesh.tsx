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

  // T59: faceted lathe hull — real silhouette: needle nose, cockpit bulge,
  // tapered tail. 8 radial segs + flat shading = crisp low-poly panels.
  const hullGeo = useMemo(() => {
    const profile = [
      new THREE.Vector2(0.015, -2.45),
      new THREE.Vector2(0.1, -1.75),
      new THREE.Vector2(0.24, -0.95),
      new THREE.Vector2(0.38, -0.15),
      new THREE.Vector2(0.41, 0.45),
      new THREE.Vector2(0.3, 1.1),
      new THREE.Vector2(0.13, 1.45),
      new THREE.Vector2(0.001, 1.5),
    ]
    const g = new THREE.LatheGeometry(profile, 8)
    g.rotateX(Math.PI / 2)
    g.scale(1.15, 0.55, 1)
    g.computeVertexNormals()
    return g
  }, [])
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
      {/* faceted hull, nose -Z (T59) */}
      <mesh castShadow geometry={hullGeo}>
        <meshPhysicalMaterial {...hull} />
      </mesh>
      {/* layered armor plates */}
      <mesh castShadow position={[0, 0.13, 0.2]} rotation={[0.06, 0, 0]} scale={[0.5, 0.05, 1.0]}>
        <boxGeometry />
        <meshPhysicalMaterial {...hull} color="#6b7790" />
      </mesh>
      <mesh castShadow position={[0, 0.1, -0.95]} rotation={[-0.08, 0, 0]} scale={[0.36, 0.045, 0.8]}>
        <boxGeometry />
        <meshPhysicalMaterial {...hull} color="#6b7790" />
      </mesh>
      {/* hull decal stripes */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.3, 0.05, -0.4]} rotation={[0, side * -0.06, 0]} scale={[0.02, 0.04, 2.2]}>
          <boxGeometry />
          <meshStandardMaterial color="#000" emissive={accent} emissiveIntensity={1.3} toneMapped={false} />
        </mesh>
      ))}
      {/* antenna */}
      <mesh position={[0, 0.42, 1.1]} rotation={[0.35, 0, 0]} scale={[0.015, 0.5, 0.015]}>
        <cylinderGeometry args={[1, 1, 1, 4]} />
        <meshStandardMaterial color="#222a3c" emissive={accent} emissiveIntensity={0.8} toneMapped={false} />
      </mesh>
      {/* underglow */}
      <mesh position={[0, -0.22, -0.3]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.1, 3.4, 1]}>
        <planeGeometry />
        <meshBasicMaterial
          color={accent}
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
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
