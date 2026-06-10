import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import type { TrackData } from '../lib/track/generate'
import { poseAt, type FramePose, type TrackFrames } from '../lib/track/sample'
import { telemetry } from '../game/telemetry'

/**
 * T122: sponsor boards — three floating holo displays around the start
 * straight (left, right, center overhead) carrying a SPONSORED BY card.
 * Ad-monetization sketch: bob gently, flicker like projections, fade out
 * once the pack has passed them.
 */

const BOARD_W = 11
const BOARD_H = 6.5

interface BoardSpec {
  s: number
  d: number
  h: number
  /** phase offset so the three don't bob in sync */
  phase: number
}

export function SponsorBoards({ track, frames }: { track: TrackData; frames: TrackFrames }) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null)
  const groupRefs = useRef<(THREE.Group | null)[]>([])
  const matRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([])

  // compose the card: caption + logo on a dark holo panel
  useEffect(() => {
    const img = new Image()
    img.src = `${import.meta.env.BASE_URL}images/logos/204logo.png`
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 1024
      canvas.height = 640
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = 'rgba(5, 9, 20, 0.96)'
      ctx.fillRect(0, 0, 1024, 640)
      // thin frame line
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 4
      ctx.strokeRect(14, 14, 996, 612)
      // caption
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = '600 38px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.letterSpacing = '14px'
      ctx.fillText('SPONSORED BY', 512, 96)
      // logo fit into the lower area, aspect preserved
      const maxW = 820
      const maxH = 430
      const k = Math.min(maxW / img.width, maxH / img.height)
      const w = img.width * k
      const h = img.height * k
      ctx.drawImage(img, (1024 - w) / 2, 140 + (maxH - h) / 2, w, h)
      const t = new THREE.CanvasTexture(canvas)
      t.colorSpace = THREE.SRGBColorSpace
      setTex(t)
    }
    return () => {
      img.onload = null
    }
  }, [])

  const boards = useMemo(() => {
    const halfW = track.width / 2
    const specs: BoardSpec[] = [
      { s: 55, d: -(halfW + 10), h: 5, phase: 0 },
      { s: 55, d: halfW + 10, h: 5, phase: 2.1 },
      { s: 100, d: 0, h: 13, phase: 4.2 },
    ]
    const pose = {} as FramePose
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    return specs.map((spec) => {
      poseAt(frames, spec.s, spec.d, spec.h, pose)
      // face BACK toward the grid: lookAt sets +Z = eye−target, and the
      // plane's front is its local +Z — so target must be +tangent
      m.lookAt(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(pose.tx, pose.ty, pose.tz),
        new THREE.Vector3(pose.nx, pose.ny, pose.nz),
      )
      q.setFromRotationMatrix(m)
      return {
        ...spec,
        position: new THREE.Vector3(pose.px, pose.py, pose.pz),
        quaternion: q.clone(),
        up: new THREE.Vector3(pose.nx, pose.ny, pose.nz),
      }
    })
  }, [track, frames])

  useFrame(({ clock }) => {
    const playerS = telemetry.progress * track.length
    for (let i = 0; i < boards.length; i++) {
      const g = groupRefs.current[i]
      const mat = matRefs.current[i]
      const b = boards[i]
      if (!g) continue
      // gentle hover bob
      const bob = Math.sin(clock.elapsedTime * 0.9 + b.phase) * 0.5
      g.position.set(
        b.position.x + b.up.x * bob,
        b.position.y + b.up.y * bob,
        b.position.z + b.up.z * bob,
      )
      // holo flicker + fade once the player is past
      const past = Math.max(0, playerS - b.s + 15)
      const fade = Math.max(0, 1 - past / 45)
      const flicker = 0.92 + Math.sin(clock.elapsedTime * 17 + b.phase * 3) * 0.08
      if (mat) mat.opacity = fade * flicker
      g.visible = fade > 0.01
    }
  })

  if (!tex) return null

  return (
    <group>
      {boards.map((b, i) => (
        <group key={i} ref={(g) => void (groupRefs.current[i] = g)} position={b.position} quaternion={b.quaternion}>
          {/* dark casing (T121 language: emissive sits inset, not raw) */}
          <mesh position={[0, 0, -0.22]}>
            <boxGeometry args={[BOARD_W + 0.7, BOARD_H + 0.7, 0.35]} />
            <meshStandardMaterial color="#0c0f1c" metalness={0.7} roughness={0.45} />
          </mesh>
          {/* screen */}
          <mesh>
            <planeGeometry args={[BOARD_W, BOARD_H]} />
            <meshBasicMaterial
              ref={(m) => void (matRefs.current[i] = m)}
              map={tex}
              transparent
              toneMapped={false}
            />
          </mesh>
          {/* underglow strip — reads as projector emitters */}
          <mesh position={[0, -BOARD_H / 2 - 0.5, 0]}>
            <boxGeometry args={[BOARD_W * 0.6, 0.12, 0.12]} />
            <meshBasicMaterial color={track.theme.glow} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
