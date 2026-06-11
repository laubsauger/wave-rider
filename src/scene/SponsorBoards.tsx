import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import type { TrackData } from '../lib/track/generate'
import { poseAt, type FramePose, type TrackFrames } from '../lib/track/sample'
import { telemetry } from '../game/telemetry'

/**
 * T122/T126: sponsor boards — three floating holo displays around the start
 * straight. Fly DOWN into place during READY/countdown, lift off after GO.
 * Soft holo wobble (slow noise, a ghosted blur layer) — no strobing.
 */

const BOARD_W = 13.5
const BOARD_H = 8

interface BoardSpec {
  s: number
  d: number
  h: number
  /** inward tilt (rad, around board up) — 0 for the center board */
  tilt: number
  phase: number
}

export function SponsorBoards({ track, frames }: { track: TrackData; frames: TrackFrames }) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null)
  const groupRefs = useRef<(THREE.Group | null)[]>([])
  const matRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const ghostRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const anim = useRef({ lift: 0 })

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
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 4
      ctx.strokeRect(14, 14, 996, 612)
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = '600 38px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.letterSpacing = '14px'
      ctx.fillText('SPONSORED BY', 512, 96)
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
    // local road edge at the board's s — widthScale can run 2.2× base
    const halfW =
      (track.width * frames.widths[Math.min(frames.count - 1, Math.round(55 / frames.ds))]) / 2
    // T133: tilt sign verified against the start frame (b = +x, board normal
    // -t): LEFT board (d<0) rotates POSITIVE around up to face the line
    const specs: BoardSpec[] = [
      { s: 55, d: -(halfW + 16), h: 6, tilt: 0.38, phase: 0 },
      { s: 55, d: halfW + 16, h: 6, tilt: -0.38, phase: 2.1 },
      { s: 100, d: 0, h: 14, tilt: 0, phase: 4.2 },
    ]
    const pose = {} as FramePose
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const tiltQ = new THREE.Quaternion()
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
      // T126: side boards angle in toward the racing line
      tiltQ.setFromAxisAngle(new THREE.Vector3(pose.nx, pose.ny, pose.nz), spec.tilt)
      return {
        ...spec,
        position: new THREE.Vector3(pose.px, pose.py, pose.pz),
        quaternion: tiltQ.clone().multiply(q),
        up: new THREE.Vector3(pose.nx, pose.ny, pose.nz),
      }
    })
  }, [track, frames])

  useFrame(({ clock }, dt) => {
    const playerS = telemetry.progress * track.length
    const cd = telemetry.countdown
    const t = clock.elapsedTime

    // T126/T133 timeline: drop happens DURING READY — boards are parked in
    // place before the digits start, lift off once the race is running
    let drop = 0
    if (cd > 4.5) drop = 60 // high while the scene settles
    else if (cd > 3.2) drop = ((cd - 3.2) / 1.3) ** 2 * 60 // landing through READY
    if (cd <= 0) anim.current.lift = Math.min(6, anim.current.lift + dt)
    const lift = anim.current.lift
    const rise = lift * lift * 4
    const liftFade = Math.max(0, 1 - lift / 4)

    for (let i = 0; i < boards.length; i++) {
      const g = groupRefs.current[i]
      const b = boards[i]
      if (!g) continue
      const bob = Math.sin(t * 0.9 + b.phase) * 0.5
      const y = bob + drop + rise
      g.position.set(b.position.x + b.up.x * y, b.position.y + b.up.y * y, b.position.z + b.up.z * y)
      // T133: brighter baseline + occasional slow swell — present, not strobing
      const wobble = 1.0 + Math.sin(t * 1.1 + b.phase) * 0.05 + Math.max(0, Math.sin(t * 0.4 + b.phase)) ** 3 * 0.25
      const past = Math.max(0, playerS - b.s + 15)
      const fade = Math.max(0, 1 - past / 45) * liftFade
      const mat = matRefs.current[i]
      if (mat) mat.opacity = fade * wobble
      const ghost = ghostRefs.current[i]
      if (ghost) ghost.opacity = fade * 0.16 * wobble
      g.visible = fade > 0.01
    }
  })

  if (!tex) return null

  return (
    <group>
      {boards.map((b, i) => (
        <group key={i} ref={(g) => void (groupRefs.current[i] = g)} position={b.position} quaternion={b.quaternion}>
          {/* dark casing — emissive sits inset, not raw (T121 language) */}
          <mesh position={[0, 0, -0.24]}>
            <boxGeometry args={[BOARD_W + 0.8, BOARD_H + 0.8, 0.4]} />
            <meshStandardMaterial color="#0c0f1c" metalness={0.7} roughness={0.45} />
          </mesh>
          {/* T126: ghosted blur layer behind the screen — cheap holo blur */}
          <mesh position={[0.12, -0.1, -0.06]} scale={[1.05, 1.05, 1]}>
            <planeGeometry args={[BOARD_W, BOARD_H]} />
            <meshBasicMaterial
              ref={(m) => void (ghostRefs.current[i] = m)}
              map={tex}
              transparent
              opacity={0.16}
              depthWrite={false}
              toneMapped={false}
            />
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
          {/* emitter strip — T133: actually glows now */}
          <mesh position={[0, -BOARD_H / 2 - 0.5, 0]}>
            <boxGeometry args={[BOARD_W * 0.7, 0.22, 0.18]} />
            <meshBasicMaterial color={new THREE.Color(track.theme.glow).multiplyScalar(2.2)} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
