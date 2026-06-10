import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { ShipMesh } from './ShipMesh'
import { ExhaustTrails } from './Exhaust'
import { poseAt, type TrackFrames } from '../lib/track/sample'
import type { OpponentState } from '../lib/network/p2p'

interface NetShipProps {
  /** B19: live source read per frame — props froze at mount (opponent was
   * null then), so the ship never appeared. Never gate mount on sim state. */
  source: () => OpponentState | null
  frames: TrackFrames
  accent: string
  isGhost?: boolean
}

const tmpMatrix = new THREE.Matrix4()
const tmpEye = new THREE.Vector3(0, 0, 0)
const tmpDir = new THREE.Vector3()
const tmpUp = new THREE.Vector3()
const pose = { px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, tx: 0, ty: 0, tz: 0, bx: 0, by: 0, bz: 0 }

export function NetworkShip({ source, frames, accent, isGhost }: NetShipProps) {
  const groupRef = useRef<THREE.Group>(null)
  // smoothed local view of the remote state (10Hz updates → 60fps motion)
  const cur = useRef({ s: 0, d: 0, v: 0, yaw: 0, init: false })

  useFrame((_, dt) => {
    const g = groupRef.current
    if (!g) return
    const tgt = source()
    if (!tgt) {
      g.visible = false
      return
    }
    g.visible = true
    const c = cur.current
    if (!c.init) {
      c.s = tgt.s
      c.d = tgt.d
      c.init = true
    }
    // dead-reckon forward at their speed, correct toward the last packet
    c.v += (tgt.v - c.v) * Math.min(1, dt * 6)
    c.s += c.v * dt
    c.s += (tgt.s + tgt.v * 0.08 - c.s) * Math.min(1, dt * 4)
    c.d += (tgt.d - c.d) * Math.min(1, dt * 8)
    c.yaw += (tgt.yaw - c.yaw) * Math.min(1, dt * 8)

    poseAt(frames, Math.max(0, c.s), c.d, 0.9, pose)
    g.position.set(pose.px, pose.py, pose.pz)
    tmpDir.set(-pose.tx, -pose.ty, -pose.tz)
    tmpUp.set(pose.nx, pose.ny, pose.nz)
    tmpMatrix.lookAt(tmpEye, tmpDir, tmpUp)
    g.quaternion.setFromRotationMatrix(tmpMatrix)
    g.rotateY(Math.PI - c.yaw * 1.2)
  })

  const power = () => {
    const tgt = source()
    return tgt && !tgt.finished && tgt.v > 1 ? 0.7 : 0
  }

  return (
    <group>
      <group ref={groupRef} visible={false}>
        <ShipMesh accent={accent} power={power} variant={1} />
        {/* beacon: visible through everything */}
        <mesh position={[0, 4, 0]} rotation={[Math.PI, 0, 0]} renderOrder={999}>
          <coneGeometry args={[0.5, 1.5, 4]} />
          <meshBasicMaterial color={accent} depthTest={false} depthWrite={false} transparent opacity={isGhost ? 0.4 : 0.85} />
        </mesh>
      </group>
      <ExhaustTrails
        shipRef={groupRef}
        offsets={[[-0.45, 0.22, 1.6], [0.45, 0.22, 1.6]]}
        color={accent}
        intensity={power}
      />
    </group>
  )
}
