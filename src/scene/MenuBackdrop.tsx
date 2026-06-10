import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { color, fract, mix, sin, smoothstep, uniform, uv } from 'three/tsl'

/**
 * T103v2 → T110: layered living backdrop — scrolling grid horizon, aurora
 * bands, depth-attenuated stars. Shared by the menu AND every non-race
 * screen (track setup, lobbies, analyzing) so menus never go full black.
 */
export function MenuBackdrop() {
  const uTime = useMemo(() => uniform(0), [])

  const gridMat = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const gu = uv()
    const cell = 36
    const gx = fract(gu.x.mul(cell)).sub(0.5).abs()
    const gz = fract(gu.y.mul(cell).add(uTime.mul(0.06))).sub(0.5).abs()
    const lines = smoothstep(0.035, 0.0, gx).add(smoothstep(0.035, 0.0, gz)).min(1)
    // fade toward horizon (uv.y → 1) and at the near edge
    const fade = smoothstep(1.0, 0.55, gu.y).mul(smoothstep(0.0, 0.15, gu.y))
    m.colorNode = color(new THREE.Color('#1a6f78'))
    m.opacityNode = lines.mul(fade).mul(0.3)
    return m
  }, [uTime])

  const auroraMat = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const au = uv()
    const wave = sin(au.x.mul(7).add(uTime.mul(0.25))).mul(0.5).add(0.5)
    const wave2 = sin(au.x.mul(11).sub(uTime.mul(0.17)).add(2)).mul(0.5).add(0.5)
    const band = smoothstep(0.0, 0.45, au.y).mul(smoothstep(1.0, 0.55, au.y))
    m.colorNode = mix(color(new THREE.Color('#0b2d4a')), color(new THREE.Color('#16505c')), wave).add(
      color(new THREE.Color('#2a1140')).mul(wave2),
    )
    m.opacityNode = band.mul(wave.mul(0.4).add(0.25)).mul(0.5)
    return m
  }, [uTime])

  const stars = useMemo(() => {
    const make = (n: number, seed: number) => {
      const pos = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        const h1 = (((i + seed) * 2654435761) >>> 0) / 4294967296
        const h2 = (((i + seed) * 104729) % 65536) / 65536
        const h3 = (((i + seed) * 7919) % 4096) / 4096
        pos[i * 3] = (h1 - 0.5) * 160
        pos[i * 3 + 1] = (h2 - 0.3) * 70
        pos[i * 3 + 2] = -12 - h3 * 90
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      return g
    }
    return { a: make(420, 1), b: make(160, 999) }
  }, [])
  const starGroup = useRef<THREE.Group>(null)

  useFrame((_, dt) => {
    uTime.value += dt
    if (starGroup.current) starGroup.current.rotation.z += dt * 0.004
  })

  return (
    <group>
      {/* grid floor receding to the horizon */}
      <mesh rotation={[-Math.PI / 2.15, 0, 0]} position={[0, -4.5, -38]} material={gridMat}>
        <planeGeometry args={[260, 130]} />
      </mesh>
      {/* aurora wall behind everything */}
      <mesh position={[0, 14, -85]} material={auroraMat}>
        <planeGeometry args={[300, 90]} />
      </mesh>
      <group ref={starGroup}>
        <points geometry={stars.a}>
          <pointsMaterial color="#aac4ec" size={0.22} sizeAttenuation transparent opacity={0.9} depthWrite={false} />
        </points>
        <points geometry={stars.b}>
          <pointsMaterial color="#2ff3ff" size={0.4} sizeAttenuation transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} />
        </points>
      </group>
    </group>
  )
}
