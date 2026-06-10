import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { ShipMesh } from './ShipMesh'
import { ExhaustTrails } from './Exhaust'
import { poseAt, type TrackFrames } from '../lib/track/sample'

interface NetShipProps {
  s: number
  d: number
  v: number
  yaw: number
  frames: TrackFrames
  accent: string
  finished: boolean
  isGhost?: boolean
}

const tmpMatrix = new THREE.Matrix4()
const tmpEye = new THREE.Vector3(0, 0, 0)
const tmpDir = new THREE.Vector3()
const tmpUp = new THREE.Vector3()
const pose = { px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, tx: 0, ty: 0, tz: 0, bx: 0, by: 0, bz: 0 }

export function NetworkShip({ s, d, v, yaw, frames, accent, finished, isGhost }: NetShipProps) {
  const groupRef = useRef<THREE.Group>(null)

  useFrame(() => {
    const g = groupRef.current
    if (!g) return

    poseAt(frames, Math.max(0, s), d, 0.9, pose)
    g.position.set(pose.px, pose.py, pose.pz)
    
    tmpDir.set(-pose.tx, -pose.ty, -pose.tz)
    tmpUp.set(pose.nx, pose.ny, pose.nz)
    tmpMatrix.lookAt(tmpEye, tmpDir, tmpUp)
    g.quaternion.setFromRotationMatrix(tmpMatrix)
    
    g.rotateY(Math.PI - yaw * 1.2)
  })

  const power = () => (!finished && v > 1 ? 0.6 : 0)

  return (
    <group>
      <group ref={groupRef}>
        <ShipMesh accent={accent} power={power} variant={1} opacity={isGhost ? 0.35 : 1} transparent={isGhost} />
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
