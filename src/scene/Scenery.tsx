import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { mulberry32, rngRange } from '../lib/prng'
import type { TrackData } from '../lib/track/generate'
import { poseAt, type FramePose, type TrackFrames } from '../lib/track/sample'
import { telemetry } from '../game/telemetry'

const MAX_PYLONS = 900
const MAX_RINGS = 120

/** V19: section accent at arc position s */
function paletteAt(track: TrackData, s: number): string {
  const seg = track.segments.find((sg) => s >= sg.start && s < sg.end)
  return track.sectionPalettes[seg?.sectionIndex ?? 0] ?? track.theme.edge
}

/**
 * Trackside geometry (T18, C11): instanced neon pylons rising from the void,
 * arch gates at section changes, holo rings over high-energy stretches.
 * Seeded from track.seed (V8); glow elements take their section's accent (V19).
 */
export function Scenery({ track, frames }: { track: TrackData; frames: TrackFrames }) {
  const glowMat = useRef<THREE.MeshBasicMaterial>(null)
  const archMat = useRef<THREE.MeshBasicMaterial>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const tunnelMat = useRef<THREE.MeshStandardMaterial>(null)
  const gateMat = useRef<THREE.MeshBasicMaterial>(null)
  const gateMesh = useRef<THREE.InstancedMesh | null>(null)
  const chevronMat = useRef<THREE.MeshBasicMaterial>(null)
  const biomeMat = useRef<THREE.MeshStandardMaterial>(null)
  const entryMat = useRef<THREE.MeshBasicMaterial>(null)

  const data = useMemo(() => {
    const rng = mulberry32((track.seed ^ 0x777aa1) >>> 0)
    const pose = {} as FramePose
    const obj = new THREE.Object3D()
    const c = new THREE.Color()
    const halfW = track.width / 2
    // B-class fix: trackside objects must clear the LOCAL road edge —
    // widthScale runs up to 2.2× now, base halfW put posts mid-road
    const lhw = (s: number) =>
      (track.width * frames.widths[Math.min(frames.count - 1, Math.max(0, Math.round(s / frames.ds)))]) / 2

    const pylonMatrices: THREE.Matrix4[] = []
    const glowMatrices: THREE.Matrix4[] = []
    const glowColors: THREE.Color[] = []
    const spacing = Math.max(90, track.length / (MAX_PYLONS / 2))
    for (let s = 60; s < track.length - 60; s += spacing * rngRange(rng, 0.7, 1.3)) {
      for (const side of [-1, 1]) {
        if (rng() < 0.25) continue
        const lateral = side * (lhw(s) + rngRange(rng, 8, 28))
        const h = rngRange(rng, 8, 36)
        poseAt(frames, s, lateral, 0, pose)
        obj.position.set(pose.px, pose.py + h / 2 - 26, pose.pz)
        obj.rotation.set(0, rng() * Math.PI, 0)
        obj.scale.set(rngRange(rng, 0.9, 2.4), h, rngRange(rng, 0.9, 2.4))
        obj.updateMatrix()
        pylonMatrices.push(obj.matrix.clone())
        obj.position.y += h / 2 + 0.4
        obj.scale.set(obj.scale.x * 1.1, 0.5, obj.scale.z * 1.1)
        obj.updateMatrix()
        glowMatrices.push(obj.matrix.clone())
        glowColors.push(c.set(paletteAt(track, s)).clone())
      }
    }

    const archMatrices: THREE.Matrix4[] = []
    const archColors: THREE.Color[] = []
    const up = new THREE.Vector3()
    const tangent = new THREE.Vector3()
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    for (const seg of track.segments) {
      const prev = track.segments.find((x) => x.end === seg.start)
      if (!prev || prev.sectionIndex === seg.sectionIndex) continue
      const s = seg.start
      const hw = lhw(s)
      poseAt(frames, s, 0, 0, pose)
      tangent.set(pose.tx, pose.ty, pose.tz)
      up.set(pose.nx, pose.ny, pose.nz)
      m.lookAt(new THREE.Vector3(0, 0, 0), tangent, up)
      q.setFromRotationMatrix(m)
      c.set(paletteAt(track, s + 1))
      for (const part of [-1, 0, 1]) {
        obj.quaternion.copy(q)
        if (part === 0) {
          obj.position.set(pose.px + up.x * (hw + 4), pose.py + up.y * (hw + 4), pose.pz + up.z * (hw + 4))
          obj.scale.set(hw * 2 + 7, 1.1, 1.1)
        } else {
          const bx = pose.bx * part * (hw + 2.8)
          const by = pose.by * part * (hw + 2.8)
          const bz = pose.bz * part * (hw + 2.8)
          obj.position.set(
            pose.px + bx + up.x * (hw + 4) * 0.5,
            pose.py + by + up.y * (hw + 4) * 0.5,
            pose.pz + bz + up.z * (hw + 4) * 0.5,
          )
          obj.scale.set(1.1, hw + 4, 1.1)
        }
        obj.updateMatrix()
        archMatrices.push(obj.matrix.clone())
        archColors.push(c.clone())
      }
    }

    const ringMatrices: THREE.Matrix4[] = []
    const ringColors: THREE.Color[] = []
    for (const seg of track.segments) {
      if (ringMatrices.length >= MAX_RINGS) break
      const sectionEnergy = track.sectionEnergies[seg.sectionIndex] ?? 0.5
      if (sectionEnergy < 0.55) continue
      for (let s = seg.start + 120; s < seg.end - 60; s += 420) {
        if (ringMatrices.length >= MAX_RINGS) break
        poseAt(frames, s, 0, 7, pose)
        tangent.set(pose.tx, pose.ty, pose.tz)
        up.set(pose.nx, pose.ny, pose.nz)
        m.lookAt(new THREE.Vector3(0, 0, 0), tangent, up)
        q.setFromRotationMatrix(m)
        obj.quaternion.copy(q)
        obj.position.set(pose.px, pose.py, pose.pz)
        const r = rngRange(rng, 0.9, 1.25) * Math.max(1, lhw(s) / halfW)
        obj.scale.set(r, r, r)
        obj.updateMatrix()
        ringMatrices.push(obj.matrix.clone())
        ringColors.push(c.set(paletteAt(track, s)).clone())
      }
    }

    // T43: rib tunnels through breakdown glides
    const tunnelMatrices: THREE.Matrix4[] = []
    const tunnelColors: THREE.Color[] = []
    for (const seg of track.segments) {
      if (seg.type !== 'glide') continue
      for (let s = seg.start + 20; s < seg.end - 10; s += 28) {
        if (tunnelMatrices.length >= 400) break
        poseAt(frames, s, 0, 2.2, pose)
        tangent.set(pose.tx, pose.ty, pose.tz)
        up.set(pose.nx, pose.ny, pose.nz)
        m.lookAt(new THREE.Vector3(0, 0, 0), tangent, up)
        q.setFromRotationMatrix(m)
        obj.quaternion.copy(q)
        obj.position.set(pose.px, pose.py, pose.pz)
        const r = track.width * 0.045
        obj.scale.set(r, r, r)
        obj.updateMatrix()
        tunnelMatrices.push(obj.matrix.clone())
        tunnelColors.push(c.set(paletteAt(track, s)).clone())
      }
    }

    // T42: overhead beat-gates on straights, chevrons on curve outsides.
    // T166: gates get LEGS down to the deck — connected structures, not
    // floating dark frames.
    const gateMatrices: THREE.Matrix4[] = []
    const gateColors: THREE.Color[] = []
    const gateS: number[] = []
    const gateLegMatrices: THREE.Matrix4[] = []
    const chevronMatrices: THREE.Matrix4[] = []
    const chevronColors: THREE.Color[] = []
    for (const seg of track.segments) {
      if (seg.type === 'straight') {
        for (let s = seg.start + 120; s < seg.end - 40; s += 240) {
          if (gateMatrices.length >= 200) break
          const gateH = halfW * 0.6
          const hw = lhw(s)
          poseAt(frames, s, 0, gateH, pose)
          tangent.set(pose.tx, pose.ty, pose.tz)
          up.set(pose.nx, pose.ny, pose.nz)
          m.lookAt(new THREE.Vector3(0, 0, 0), tangent, up)
          q.setFromRotationMatrix(m)
          obj.quaternion.copy(q)
          obj.position.set(pose.px, pose.py, pose.pz)
          obj.scale.set(hw * 2 + 5, 0.45, 0.45)
          obj.updateMatrix()
          gateMatrices.push(obj.matrix.clone())
          gateColors.push(c.set(paletteAt(track, s)).clone())
          gateS.push(s)
          // legs: deck → bar at both ends
          for (const side of [-1, 1]) {
            const lx = side * (hw + 2.2)
            obj.quaternion.copy(q)
            obj.position.set(
              pose.px + pose.bx * lx - up.x * (gateH / 2),
              pose.py + pose.by * lx - up.y * (gateH / 2),
              pose.pz + pose.bz * lx - up.z * (gateH / 2),
            )
            obj.scale.set(0.55, gateH, 0.55)
            obj.updateMatrix()
            gateLegMatrices.push(obj.matrix.clone())
          }
        }
      } else if (seg.type === 'curve' || seg.type === 'chicane') {
        for (let s = seg.start + 30; s < seg.end - 20; s += 60) {
          if (chevronMatrices.length >= 400) break
          for (const side of [-1, 1]) {
            poseAt(frames, s, side * (lhw(s) + 1.6), 1.4, pose)
            tangent.set(pose.tx, pose.ty, pose.tz)
            up.set(pose.nx, pose.ny, pose.nz)
            m.lookAt(new THREE.Vector3(0, 0, 0), tangent, up)
            q.setFromRotationMatrix(m)
            obj.quaternion.copy(q)
            obj.position.set(pose.px, pose.py, pose.pz)
            obj.rotateZ(side * 0.6)
            obj.scale.set(0.35, 2.4, 0.35)
            obj.updateMatrix()
            chevronMatrices.push(obj.matrix.clone())
            chevronColors.push(c.set(paletteAt(track, s)).clone())
          }
        }
      }
    }

    // R9f/T104: biome layer — mood picks the trackside world. City canyon
    // (aggressive/energetic), open desert monoliths (flowing), crystal
    // cavern shards (chill). Seeded scatter (V8), palette-tinted (V19).
    const biome = track.mood === 'chill' ? 'cavern' : track.mood === 'flowing' ? 'desert' : 'city'
    const biomeMatrices: THREE.Matrix4[] = []
    const biomeColors: THREE.Color[] = []
    const biomeSpacing = biome === 'desert' ? 260 : biome === 'city' ? 110 : 90
    for (let s = 80; s < track.length - 80; s += biomeSpacing * rngRange(rng, 0.65, 1.45)) {
      if (biomeMatrices.length >= 380) break
      for (const side of [-1, 1]) {
        if (rng() < (biome === 'desert' ? 0.45 : 0.3)) continue
        if (biome === 'city') {
          // tower slabs crowding the course into a canyon
          const lateral = side * (lhw(s) + rngRange(rng, 30, 130))
          const h = rngRange(rng, 30, 120)
          poseAt(frames, s, lateral, 0, pose)
          obj.position.set(pose.px, pose.py + h / 2 - 30, pose.pz)
          obj.rotation.set(0, rng() * Math.PI, 0)
          obj.scale.set(rngRange(rng, 6, 16), h, rngRange(rng, 6, 16))
        } else if (biome === 'desert') {
          // sparse monoliths far off the racing line
          const lateral = side * (lhw(s) + rngRange(rng, 60, 220))
          const h = rngRange(rng, 18, 64)
          poseAt(frames, s, lateral, 0, pose)
          obj.position.set(pose.px, pose.py + h / 2 - 32, pose.pz)
          obj.rotation.set(0, rng() * Math.PI * 2, 0)
          obj.scale.set(rngRange(rng, 14, 38), h, rngRange(rng, 14, 38))
        } else {
          // crystal shards jutting at angles near the track
          const lateral = side * (lhw(s) + rngRange(rng, 18, 80))
          const r = rngRange(rng, 3, 11)
          poseAt(frames, s, lateral, rngRange(rng, -18, 14), pose)
          obj.position.set(pose.px, pose.py, pose.pz)
          obj.rotation.set(rngRange(rng, -0.5, 0.5), rng() * Math.PI * 2, rngRange(rng, -0.5, 0.5))
          obj.scale.set(r * 0.45, r, r * 0.45)
        }
        obj.updateMatrix()
        biomeMatrices.push(obj.matrix.clone())
        biomeColors.push(c.set(paletteAt(track, s)).clone())
      }
    }

    // T155: capture gates — a double ring at every loop/corkscrew entry so
    // the player has something to AIM for (stay low through it or get reset)
    const entryMatrices: THREE.Matrix4[] = []
    const entryColors: THREE.Color[] = []
    for (const seg of track.segments) {
      if (seg.type !== 'loop' && seg.type !== 'corkscrew') continue
      if (entryMatrices.length >= 80) break
      const s = Math.max(2, seg.start - 12)
      poseAt(frames, s, 0, 4, pose)
      tangent.set(pose.tx, pose.ty, pose.tz)
      up.set(pose.nx, pose.ny, pose.nz)
      m.lookAt(new THREE.Vector3(0, 0, 0), tangent, up)
      q.setFromRotationMatrix(m)
      obj.quaternion.copy(q)
      obj.position.set(pose.px, pose.py, pose.pz)
      const r = (track.width / 2 + 4) / 10
      obj.scale.set(r, r, r)
      obj.updateMatrix()
      entryMatrices.push(obj.matrix.clone())
      entryColors.push(c.set(paletteAt(track, seg.start + 1)).clone())
    }

    return {
      pylonMatrices,
      glowMatrices,
      glowColors,
      archMatrices,
      archColors,
      ringMatrices,
      ringColors,
      tunnelMatrices,
      tunnelColors,
      gateMatrices,
      gateColors,
      gateS,
      gateLegMatrices,
      chevronMatrices,
      chevronColors,
      biome,
      biomeMatrices,
      biomeColors,
      entryMatrices,
      entryColors,
    }
  }, [track, frames])

  // beat-reactive glow (T21) — V10-safe: brightness only, no motion
  // T58: gate-pass detection state
  const lastPlayerS = useRef(0)
  const gateFlash = useRef(0)

  useFrame((_, dt) => {
    // T57: each channel owns its instruments — energy = sustained glow,
    // beat = percussive flashes (gates/pads), centroid = high-end sparkle.
    // T149: squared curves + lower floors — real dynamic range, not pegged.
    const eRaw = telemetry.energy * track.theme.pulse
    const e = eRaw * eRaw
    const b = telemetry.beat * track.theme.pulse
    const cRaw = telemetry.centroid * track.theme.pulse
    const c = cRaw * cRaw
    const secE = track.sectionEnergies[telemetry.sectionIndex] ?? 0.5
    // activation, not ambiance: idle floors near-black, the music SWITCHES
    // things on — was idling ~75% lit and only going brighter (eye fatigue)
    if (glowMat.current) glowMat.current.color.setScalar(0.04 + secE * 0.2 + e * 3.4)
    if (archMat.current) archMat.current.color.setScalar(0.05 + secE * 0.26 + e * 3.2)
    if (ringMat.current) ringMat.current.opacity = 0.02 + secE * 0.06 + e * 0.8
    if (tunnelMat.current) tunnelMat.current.emissiveIntensity = 0.05 + secE * 0.12 + e * 1.5
    if (chevronMat.current) chevronMat.current.color.setScalar(0.18 + c * 4.0)
    // R9f: crystal cavern breathes with the section energy
    if (biomeMat.current && data.biome === 'cavern') {
      biomeMat.current.emissiveIntensity = 0.06 + secE * 0.16 + e * 1.0
    }
    // T155: capture gates pulse on the beat — still the thing to aim for, so
    // a readable floor stays
    if (entryMat.current) entryMat.current.color.setScalar(0.6 + b * 3.0)

    // T58: threading a gate → big flash + HUD kick
    const playerS = telemetry.progress * track.length
    if (data.gateS.some((gs) => gs > lastPlayerS.current && gs <= playerS)) {
      gateFlash.current = 1
      telemetry.boostFlash = Math.max(telemetry.boostFlash, 0.6)
    }
    lastPlayerS.current = playerS
    gateFlash.current = Math.max(0, gateFlash.current - dt * 2.5)
    // T64: beat wave radiates from the player — near gates flash hard in
    // their OWN palette color, far gates idle. No uniform white blink.
    if (gateMat.current) gateMat.current.color.setScalar(1)
    const gm = gateMesh.current
    if (gm) {
      for (let gi = 0; gi < data.gateS.length; gi++) {
        const dist = Math.abs(data.gateS[gi] - playerS)
        const prox = Math.max(0, 1 - dist / 500)
        // T149: dimmer idle, harder beat pop
        const lit = 0.28 + b * 3.8 * prox * prox + gateFlash.current * 2.8 * prox // T166
        waveColor.copy(data.gateColors[gi]).multiplyScalar(lit)
        gm.setColorAt(gi, waveColor)
      }
      if (gm.instanceColor) gm.instanceColor.needsUpdate = true
    }
  })

  return (
    <group>
      <Instanced matrices={data.pylonMatrices}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color="#0c0f1c"
          metalness={0.7}
          roughness={0.5}
          emissive={track.theme.glow}
          emissiveIntensity={0.06}
        />
      </Instanced>
      <Instanced matrices={data.glowMatrices} colors={data.glowColors}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial ref={glowMat} color="#ffffff" toneMapped={false} />
      </Instanced>
      <Instanced matrices={data.archMatrices} colors={data.archColors}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial ref={archMat} color="#ffffff" toneMapped={false} />
      </Instanced>
      <Instanced matrices={data.tunnelMatrices} colors={data.tunnelColors}>
        <torusGeometry args={[14, 0.6, 6, 24]} />
        <meshStandardMaterial ref={tunnelMat} color="#0a0d18" emissive={track.theme.glow} emissiveIntensity={0.35} metalness={0.7} roughness={0.4} />
      </Instanced>
      {/* T121/T140/T166: matte frame + LEGS to the deck — one structure,
          faint emissive tint so the silhouette reads in the dark */}
      <Instanced matrices={data.gateMatrices}>
        <boxGeometry args={[1.006, 1.5, 1.5]} />
        <meshStandardMaterial color="#0a0d16" metalness={0.15} roughness={0.85} emissive={track.theme.glow} emissiveIntensity={0.045} />
      </Instanced>
      <Instanced matrices={data.gateLegMatrices}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#0a0d16" metalness={0.15} roughness={0.85} emissive={track.theme.glow} emissiveIntensity={0.045} />
      </Instanced>
      <Instanced matrices={data.gateMatrices} colors={data.gateColors} meshRef={gateMesh}>
        <boxGeometry args={[0.99, 0.55, 0.55]} />
        <meshBasicMaterial ref={gateMat} color="#ffffff" toneMapped={false} />
      </Instanced>
      <Instanced matrices={data.chevronMatrices} colors={data.chevronColors}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial ref={chevronMat} color="#ffffff" toneMapped={false} />
      </Instanced>
      {/* R9f: biome layer — geometry + material keyed by mood */}
      <Instanced matrices={data.biomeMatrices} colors={data.biome === 'cavern' ? data.biomeColors : undefined}>
        {data.biome === 'city' ? (
          <boxGeometry args={[1, 1, 1]} />
        ) : data.biome === 'desert' ? (
          <coneGeometry args={[0.6, 1, 5]} />
        ) : (
          <octahedronGeometry args={[1, 0]} />
        )}
        {data.biome === 'cavern' ? (
          <meshStandardMaterial
            ref={biomeMat}
            color="#10142a"
            metalness={0.3}
            roughness={0.15}
            emissive="#ffffff"
            emissiveIntensity={0.4}
            flatShading
          />
        ) : (
          <meshStandardMaterial
            ref={biomeMat}
            color={data.biome === 'city' ? '#090c18' : '#120e16'}
            metalness={data.biome === 'city' ? 0.6 : 0.1}
            roughness={data.biome === 'city' ? 0.45 : 0.9}
            emissive={track.theme.glow}
            emissiveIntensity={data.biome === 'city' ? 0.08 : 0.02}
            flatShading
          />
        )}
      </Instanced>
      {/* T155: capture gates @ twist-zone entries — matte housing + double
          bright channel; thread it LOW or eat the reset */}
      <Instanced matrices={data.entryMatrices}>
        <torusGeometry args={[10, 0.8, 6, 36]} />
        <meshStandardMaterial color="#0a0d16" metalness={0.15} roughness={0.85} emissive={track.theme.glow} emissiveIntensity={0.045} />
      </Instanced>
      <Instanced matrices={data.entryMatrices} colors={data.entryColors}>
        <torusGeometry args={[10, 0.3, 8, 48]} />
        <meshBasicMaterial ref={entryMat} color="#ffffff" toneMapped={false} />
      </Instanced>
      {/* T121/T140: matte ring housing (zero glow), slim lit channel inside */}
      <Instanced matrices={data.ringMatrices}>
        <torusGeometry args={[11, 0.65, 6, 36]} />
        <meshStandardMaterial color="#0a0d16" metalness={0.15} roughness={0.85} emissive={track.theme.glow} emissiveIntensity={0.045} />
      </Instanced>
      <Instanced matrices={data.ringMatrices} colors={data.ringColors}>
        <torusGeometry args={[11, 0.22, 8, 48]} />
        <meshBasicMaterial
          ref={ringMat}
          color="#ffffff"
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </Instanced>
    </group>
  )
}

const waveColor = new THREE.Color()

function Instanced({
  matrices,
  colors,
  children,
  meshRef,
}: {
  matrices: THREE.Matrix4[]
  colors?: THREE.Color[]
  children: React.ReactNode
  meshRef?: React.MutableRefObject<THREE.InstancedMesh | null>
}) {
  const count = matrices.length
  return (
    <instancedMesh
      ref={(mesh) => {
        if (meshRef) meshRef.current = mesh
        if (mesh) {
          for (let i = 0; i < count; i++) mesh.setMatrixAt(i, matrices[i])
          if (colors) for (let i = 0; i < Math.min(count, colors.length); i++) mesh.setColorAt(i, colors[i])
          mesh.instanceMatrix.needsUpdate = true
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
          mesh.frustumCulled = false
        }
      }}
      args={[undefined, undefined, Math.max(1, count)]}
    >
      {children}
    </instancedMesh>
  )
}
