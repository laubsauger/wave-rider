import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { color, dot, float, max, normalView, normalize, positionView, pow, sub } from 'three/tsl'
import { buildHullDetail } from './hull/buildHull'

/**
 * Ship v5 (T66): WipEout-style wedge racer. Wide flat delta planform
 * extruded thin with chamfered edges — low, fast, horizontal. Engine block
 * embedded in the trailing edge with twin glow slots. Nose -Z.
 */

function planformGeometry(widthScale: number, tipSweep: number): THREE.ExtrudeGeometry {
  const w = widthScale
  const shape = new THREE.Shape()
  // symmetric delta planform, y = along ship (− nose), x = span
  // T109v2: hard rearward sweep — long raked leading edge from the nose all
  // the way back, tips land beside the engine pod. Dart, not falcon.
  shape.moveTo(0, -2.7) // nose tip
  shape.lineTo(0.28 * w, -1.2)
  shape.lineTo(0.92 * w, 1.02 + tipSweep) // right wing tip — far aft
  shape.lineTo(0.58 * w, 1.2 + tipSweep)
  shape.lineTo(0.3 * w, 1.0)
  shape.lineTo(0.2 * w, 1.46) // engine pod trailing edge — pinched tail
  shape.lineTo(-0.2 * w, 1.46)
  shape.lineTo(-0.3 * w, 1.0)
  shape.lineTo(-0.58 * w, 1.2 + tipSweep)
  shape.lineTo(-0.92 * w, 1.02 + tipSweep) // left wing tip
  shape.lineTo(-0.28 * w, -1.2)
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
  const wispL = useRef<THREE.Mesh>(null)
  const wispR = useRef<THREE.Mesh>(null)

  // T134: ONE shared material for both outer slots — with a per-mesh ref
  // only the left one pulsed, the right read as a dead light
  const outerLightMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#000',
        emissive: new THREE.Color(accent),
        emissiveIntensity: 2,
        toneMapped: false,
      }),
    [accent],
  )

  const bodyGeo = useMemo(() => {
    if (variant === 1) return planformGeometry(0.85, -0.55)
    if (variant === 2) return planformGeometry(1.18, 0.15)
    return planformGeometry(1, 0)
  }, [variant])

  // R9a: panel lines + plates + greebles + livery, merged to 2 draw calls
  const hullDetail = useMemo(() => buildHullDetail(variant), [variant])

  // T125: shiny — low roughness so env reflections actually read.
  // Rim light: fresnel-driven accent emissive on every hull material — the
  // silhouette stays readable in the player color even on pitch black.
  const hullMats = useMemo(() => {
    const vDir = normalize(positionView.negate())
    // tight power — flat-shaded faces grab fresnel wholesale, so a soft
    // exponent floods the hull in accent instead of trimming the outline
    const fres = pow(sub(1, max(float(0), dot(normalView, vDir))), 4)
    const rim = color(new THREE.Color(accent)).mul(fres).mul(0.5)
    const mk = (hex: string, roughness: number) => {
      const m = new THREE.MeshPhysicalNodeMaterial({
        color: new THREE.Color(hex),
        metalness: 0.92,
        roughness,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        flatShading: true,
        opacity: opacity ?? 1,
        transparent: transparent ?? false,
      })
      m.emissiveNode = rim
      return m
    }
    return {
      body: mk('#323b52', 0.1),
      spine: mk('#262e44', 0.1),
      detail: mk('#3d4860', 0.42),
      engine: mk('#1b2233', 0.1),
    }
  }, [accent, opacity, transparent])

  useFrame(({ clock }) => {
    const p = power ? power() : boost
    outerLightMat.emissiveIntensity = 1.8 + Math.sin(clock.elapsedTime * 31) * 0.3 + p * 4
    // T69: condensation wisps stream off the nose past ~70% power
    const wispO = Math.max(0, (p - 0.7) * 1.6) * (0.55 + Math.sin(clock.elapsedTime * 23) * 0.45)
    for (const wm of [wispL.current, wispR.current]) {
      if (wm) (wm.material as THREE.MeshBasicMaterial).opacity = Math.min(0.5, wispO)
    }
  })

  return (
    <group>
      {/* wedge body — dark gunmetal, accents carry the color (C11).
          T173: ONLY the body casts a shadow — spine/detail/engine shadows
          live entirely inside the body's, pure shadow-pass waste ×6 ships */}
      <mesh castShadow geometry={bodyGeo} material={hullMats.body} />
      {/* raised spine plate */}
      <mesh position={[0, 0.34, -0.15]} scale={[0.34, 0.09, 2.0]} material={hullMats.spine}>
        <boxGeometry />
      </mesh>
      {/* R9a: merged detail pass — panel seams, plates, fins, scoops */}
      <mesh geometry={hullDetail.detail} material={hullMats.detail} />
      {/* R9a: merged livery pass — vents + wing slashes in team accent */}
      <mesh geometry={hullDetail.accent}>
        <meshStandardMaterial
          color="#000"
          emissive={accent}
          emissiveIntensity={1.5}
          toneMapped={false}
          transparent={transparent}
          opacity={opacity ?? 1}
        />
      </mesh>
      {/* canopy — low bubble, front third */}
      <mesh position={[0, 0.38, -1.0]} scale={[0.22, 0.12, 0.62]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshPhysicalMaterial color="#060d20" metalness={0.2} roughness={0.05} clearcoat={1} emissive={accent} emissiveIntensity={0.35} transparent={transparent} opacity={opacity ?? 1} />
      </mesh>
      {/* engine block — pod sunk into the pinched tail */}
      <mesh position={[0, 0.22, 1.3]} scale={[0.86, 0.24, 0.46]} material={hullMats.engine}>
        <boxGeometry />
      </mesh>
      {/* T125: QUAD tail lights — big outers, small inners */}
      {[-0.3, 0.3].map((x) => (
        <mesh key={`o${x}`} position={[x, 0.22, 1.56]} scale={[0.38, 0.16, 0.05]} material={outerLightMat}>
          <boxGeometry />
        </mesh>
      ))}
      {[-0.09, 0.09].map((x) => (
        <mesh key={`i${x}`} position={[x, 0.22, 1.56]} scale={[0.11, 0.1, 0.05]}>
          <boxGeometry />
          <meshStandardMaterial color="#000" emissive={accent} emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
      ))}
      {/* T127: cone flames removed — the exhaust TRAIL is the flame now */}
      {/* wingtip accent edges — follow the hard sweep */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.78, 0.2, 0.92]} rotation={[0, side * -0.28, 0]} scale={[0.05, 0.1, 0.7]}>
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
