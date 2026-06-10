import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'

/**
 * Ship v5 (T66): WipEout-style wedge racer. Wide flat delta planform
 * extruded thin with chamfered edges — low, fast, horizontal. Engine block
 * embedded in the trailing edge with twin glow slots. Nose -Z.
 */

function planformGeometry(widthScale: number, tipSweep: number): THREE.ExtrudeGeometry {
  const w = widthScale
  const shape = new THREE.Shape()
  // symmetric delta planform, y = along ship (− nose), x = span
  shape.moveTo(0, -2.7) // nose tip
  shape.lineTo(0.34 * w, -1.1)
  shape.lineTo(1.28 * w, 0.55 + tipSweep) // right wing tip
  shape.lineTo(1.05 * w, 1.05 + tipSweep)
  shape.lineTo(0.5 * w, 0.95)
  shape.lineTo(0.46 * w, 1.45) // engine pod trailing edge
  shape.lineTo(-0.46 * w, 1.45)
  shape.lineTo(-0.5 * w, 0.95)
  shape.lineTo(-1.05 * w, 1.05 + tipSweep)
  shape.lineTo(-1.28 * w, 0.55 + tipSweep) // left wing tip
  shape.lineTo(-0.34 * w, -1.1)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.18,
    bevelEnabled: true,
    bevelThickness: 0.11,
    bevelSize: 0.13,
    bevelSegments: 1,
  })
  geo.rotateX(Math.PI / 2) // planform flat, thickness vertical
  geo.translate(0, 0.2, 0)
  return geo
}

export function ShipMesh({
  accent = '#2ff3ff',
  boost = 0,
  power,
  variant = 0,
  opacity = 1,
  transparent = false,
}: {
  accent?: string
  boost?: number
  power?: () => number
  /** 0 standard, 1 narrow fwd-swept, 2 wide cruiser */
  variant?: 0 | 1 | 2
  opacity?: number
  transparent?: boolean
}) {
  const engineMat = useRef<THREE.MeshStandardMaterial>(null)
  const flameL = useRef<THREE.Mesh>(null)
  const flameR = useRef<THREE.Mesh>(null)
  const wispL = useRef<THREE.Mesh>(null)
  const wispR = useRef<THREE.Mesh>(null)

  const bodyGeo = useMemo(() => {
    if (variant === 1) return planformGeometry(0.85, -0.55)
    if (variant === 2) return planformGeometry(1.18, 0.15)
    return planformGeometry(1, 0)
  }, [variant])

  const hull = useMemo(
    () => ({ metalness: 0.9, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.15, flatShading: true, opacity: opacity ?? 1, transparent: transparent ?? false }),
    [opacity, transparent],
  )

  useFrame(({ clock }) => {
    const p = power ? power() : boost
    if (engineMat.current) {
      engineMat.current.emissiveIntensity = 1.8 + Math.sin(clock.elapsedTime * 31) * 0.3 + p * 4
    }
    // T69: condensation wisps stream off the nose past ~70% power
    const wispO = Math.max(0, (p - 0.7) * 1.6) * (0.55 + Math.sin(clock.elapsedTime * 23) * 0.45)
    for (const wm of [wispL.current, wispR.current]) {
      if (wm) (wm.material as THREE.MeshBasicMaterial).opacity = Math.min(0.5, wispO)
    }
    const len = Math.max(0.001, 0.25 + p * 2.3 + Math.sin(clock.elapsedTime * 47) * 0.12 * p)
    for (const f of [flameL.current, flameR.current]) {
      if (f) {
        f.scale.y = len
        f.position.z = 1.48 + len * 0.5
        f.visible = p > 0.02
      }
    }
  })

  return (
    <group>
      {/* wedge body */}
      <mesh castShadow geometry={bodyGeo}>
        <meshPhysicalMaterial color="#aeb9d6" {...hull} />
      </mesh>
      {/* raised spine plate */}
      <mesh castShadow position={[0, 0.34, -0.15]} scale={[0.4, 0.1, 2.0]}>
        <boxGeometry />
        <meshPhysicalMaterial color="#69758f" {...hull} />
      </mesh>
      {/* canopy — low bubble, front third */}
      <mesh position={[0, 0.38, -1.0]} scale={[0.22, 0.12, 0.62]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshPhysicalMaterial color="#060d20" metalness={0.2} roughness={0.05} clearcoat={1} emissive={accent} emissiveIntensity={0.35} transparent={transparent} opacity={opacity ?? 1} />
      </mesh>
      {/* engine block — wide, flat, embedded in tail */}
      <mesh castShadow position={[0, 0.22, 1.32]} scale={[1.0, 0.26, 0.42]}>
        <boxGeometry />
        <meshPhysicalMaterial color="#39435c" {...hull} />
      </mesh>
      {/* twin horizontal glow slots */}
      {[-0.45, 0.45].map((x) => (
        <mesh key={x} position={[x, 0.22, 1.55]} scale={[0.36, 0.1, 0.04]}>
          <boxGeometry />
          <meshStandardMaterial ref={x < 0 ? engineMat : undefined} color="#000" emissive={accent} emissiveIntensity={2} toneMapped={false} />
        </mesh>
      ))}
      {/* flames — wide flat plumes */}
      {[-0.45, 0.45].map((x, i) => (
        <mesh key={x} ref={i === 0 ? flameL : flameR} position={[x, 0.22, 1.5]} rotation={[Math.PI / 2, 0, 0]} scale={[1.8, 1, 0.45]}>
          <coneGeometry args={[0.12, 1, 8, 1, true]} />
          <meshBasicMaterial color={accent} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
      {/* wingtip accent edges */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 1.16, 0.2, 0.78]} rotation={[0, side * -0.45, 0]} scale={[0.05, 0.1, 0.6]}>
          <boxGeometry />
          <meshStandardMaterial color="#000" emissive={accent} emissiveIntensity={2.4} toneMapped={false} />
        </mesh>
      ))}
      {/* T69: nose condensation wisps — flicker in under hard power */}
      {[-1, 1].map((side) => (
        <mesh
          key={`wisp${side}`}
          ref={side < 0 ? wispL : wispR}
          position={[side * 0.3, 0.16, -2.1]}
          rotation={[0, side * 0.5, side * 0.9]}
          scale={[0.04, 0.5, 1]}
        >
          <planeGeometry />
          <meshBasicMaterial
            color="#cfe8ff"
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {/* nose stripe decals */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.13, 0.33, -1.5]} rotation={[0, side * 0.1, 0]} scale={[0.025, 0.03, 1.6]}>
          <boxGeometry />
          <meshStandardMaterial color="#000" emissive={accent} emissiveIntensity={1.3} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}
