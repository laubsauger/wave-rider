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
  const gateMesh = useRef<THREE.InstancedMesh | null>(null)

  // T173: shared geometry/material OBJECTS (not JSX) — bucketed culling
  // renders several meshes per category, all reusing one material so the
  // music-pulse writes below hit every bucket at once
  const geoms = useMemo(
    () => ({
      box: new THREE.BoxGeometry(1, 1, 1),
      gateFrame: new THREE.BoxGeometry(1.006, 1.5, 1.5),
      gateBar: new THREE.BoxGeometry(0.99, 0.55, 0.55),
      tunnel: new THREE.TorusGeometry(14, 0.6, 6, 24),
      entryHouse: new THREE.TorusGeometry(10, 0.8, 6, 36),
      entryChan: new THREE.TorusGeometry(10, 0.3, 8, 48),
      ringHouse: new THREE.TorusGeometry(11, 0.65, 6, 36),
      ringChan: new THREE.TorusGeometry(11, 0.22, 8, 48),
      cone: new THREE.ConeGeometry(0.6, 1, 5),
      octa: new THREE.OctahedronGeometry(1, 0),
    }),
    [],
  )

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

    // B37: the course CROSSES its own footprint — an object placed clear of
    // its own segment can sit inside a DIFFERENT part of the track. Spatial
    // hash of the whole course; spawns that intersect any far corridor
    // section (horizontally near + vertically overlapping) are rejected.
    const CELL = 40
    const corridor = new Map<string, number[]>() // key → flat [x,y,z,s,...]
    for (let i = 0; i < frames.count; i += 5) {
      const x = frames.positions[i * 3]
      const key = `${Math.floor(x / CELL)}:${Math.floor(frames.positions[i * 3 + 2] / CELL)}`
      const arr = corridor.get(key) ?? []
      if (arr.length === 0) corridor.set(key, arr)
      arr.push(x, frames.positions[i * 3 + 1], frames.positions[i * 3 + 2], i * frames.ds)
    }
    const clearOfCourse = (x: number, z: number, yMin: number, yMax: number, r: number, ownS: number) => {
      const cx = Math.floor(x / CELL)
      const cz = Math.floor(z / CELL)
      const reach = r + 34 // object radius + generous road half-width
      const cells = Math.ceil(reach / CELL)
      for (let dx = -cells; dx <= cells; dx++) {
        for (let dz = -cells; dz <= cells; dz++) {
          const arr = corridor.get(`${cx + dx}:${cz + dz}`)
          if (!arr) continue
          for (let k = 0; k < arr.length; k += 4) {
            if (Math.abs(arr[k + 3] - ownS) < 150) continue // own neighborhood
            const sy = arr[k + 1]
            if (sy < yMin - 8 || sy > yMax + 8) continue
            const ddx = arr[k] - x
            const ddz = arr[k + 2] - z
            if (ddx * ddx + ddz * ddz < reach * reach) return false
          }
        }
      }
      return true
    }

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
        if (!clearOfCourse(pose.px, pose.pz, pose.py - 26, pose.py + h, 4, s)) continue
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
          if (!clearOfCourse(pose.px, pose.pz, pose.py - 30, pose.py + h, 16, s)) continue
          obj.position.set(pose.px, pose.py + h / 2 - 30, pose.pz)
          obj.rotation.set(0, rng() * Math.PI, 0)
          obj.scale.set(rngRange(rng, 6, 16), h, rngRange(rng, 6, 16))
        } else if (biome === 'desert') {
          // sparse monoliths far off the racing line
          const lateral = side * (lhw(s) + rngRange(rng, 60, 220))
          const h = rngRange(rng, 18, 64)
          poseAt(frames, s, lateral, 0, pose)
          if (!clearOfCourse(pose.px, pose.pz, pose.py - 32, pose.py + h, 38, s)) continue
          obj.position.set(pose.px, pose.py + h / 2 - 32, pose.pz)
          obj.rotation.set(0, rng() * Math.PI * 2, 0)
          obj.scale.set(rngRange(rng, 14, 38), h, rngRange(rng, 14, 38))
        } else {
          // crystal shards jutting at angles near the track
          const lateral = side * (lhw(s) + rngRange(rng, 18, 80))
          const r = rngRange(rng, 3, 11)
          poseAt(frames, s, lateral, rngRange(rng, -18, 14), pose)
          if (!clearOfCourse(pose.px, pose.pz, pose.py - r, pose.py + r, r, s)) continue
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

  const mats = useMemo(() => {
    const glow = new THREE.Color(track.theme.glow)
    const frame = new THREE.MeshStandardMaterial({
      color: '#0a0d16',
      metalness: 0.15,
      roughness: 0.85,
      emissive: glow,
      emissiveIntensity: 0.045,
    })
    const biome =
      data.biome === 'cavern'
        ? new THREE.MeshStandardMaterial({
            color: '#10142a',
            metalness: 0.3,
            roughness: 0.15,
            emissive: '#ffffff',
            emissiveIntensity: 0.4,
            flatShading: true,
          })
        : new THREE.MeshStandardMaterial({
            color: data.biome === 'city' ? '#090c18' : '#120e16',
            metalness: data.biome === 'city' ? 0.6 : 0.1,
            roughness: data.biome === 'city' ? 0.45 : 0.9,
            emissive: glow,
            emissiveIntensity: data.biome === 'city' ? 0.08 : 0.02,
            flatShading: true,
          })
    return {
      pylon: new THREE.MeshStandardMaterial({
        color: '#0c0f1c',
        metalness: 0.7,
        roughness: 0.5,
        emissive: glow,
        emissiveIntensity: 0.06,
      }),
      glow: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      arch: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      tunnel: new THREE.MeshStandardMaterial({
        color: '#0a0d18',
        emissive: glow,
        emissiveIntensity: 0.35,
        metalness: 0.7,
        roughness: 0.4,
      }),
      frame,
      gateBar: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      chevron: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      biome,
      entry: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      ring: new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    }
  }, [track.theme.glow, data.biome])

  const fogFar = 3 / track.theme.fogDensity

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
    mats.glow.color.setScalar(0.04 + secE * 0.2 + e * 3.4)
    mats.arch.color.setScalar(0.05 + secE * 0.26 + e * 3.2)
    mats.ring.opacity = 0.02 + secE * 0.06 + e * 0.8
    mats.tunnel.emissiveIntensity = 0.05 + secE * 0.12 + e * 1.5
    mats.chevron.color.setScalar(0.18 + c * 4.0)
    // R9f: crystal cavern breathes with the section energy
    if (data.biome === 'cavern') {
      mats.biome.emissiveIntensity = 0.06 + secE * 0.16 + e * 1.0
    }
    // T155: capture gates pulse on the beat — still the thing to aim for, so
    // a readable floor stays
    mats.entry.color.setScalar(0.6 + b * 3.0)

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
    mats.gateBar.color.setScalar(1)
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

  // T173: every category bucketed + fog-culled except the gate BARS — their
  // per-instance beat-wave colors index the flat instance order (gateMesh)
  return (
    <group>
      <Instanced matrices={data.pylonMatrices} geometry={geoms.box} material={mats.pylon} cullRange={fogFar} />
      <Instanced matrices={data.glowMatrices} colors={data.glowColors} geometry={geoms.box} material={mats.glow} cullRange={fogFar} />
      <Instanced matrices={data.archMatrices} colors={data.archColors} geometry={geoms.box} material={mats.arch} cullRange={fogFar} />
      <Instanced matrices={data.tunnelMatrices} colors={data.tunnelColors} geometry={geoms.tunnel} material={mats.tunnel} cullRange={fogFar} />
      {/* T121/T140/T166: matte frame + LEGS to the deck */}
      <Instanced matrices={data.gateMatrices} geometry={geoms.gateFrame} material={mats.frame} cullRange={fogFar} />
      <Instanced matrices={data.gateLegMatrices} geometry={geoms.box} material={mats.frame} cullRange={fogFar} />
      <Instanced matrices={data.gateMatrices} colors={data.gateColors} meshRef={gateMesh} geometry={geoms.gateBar} material={mats.gateBar} />
      <Instanced matrices={data.chevronMatrices} colors={data.chevronColors} geometry={geoms.box} material={mats.chevron} cullRange={fogFar} />
      {/* R9f: biome layer — geometry + material keyed by mood */}
      <Instanced
        matrices={data.biomeMatrices}
        colors={data.biome === 'cavern' ? data.biomeColors : undefined}
        geometry={data.biome === 'city' ? geoms.box : data.biome === 'desert' ? geoms.cone : geoms.octa}
        material={mats.biome}
        cullRange={fogFar}
      />
      {/* T155: capture gates @ twist-zone entries */}
      <Instanced matrices={data.entryMatrices} geometry={geoms.entryHouse} material={mats.frame} cullRange={fogFar} />
      <Instanced matrices={data.entryMatrices} colors={data.entryColors} geometry={geoms.entryChan} material={mats.entry} cullRange={fogFar} />
      {/* T121/T140: matte ring housing (zero glow), slim lit channel inside */}
      <Instanced matrices={data.ringMatrices} geometry={geoms.ringHouse} material={mats.frame} cullRange={fogFar} />
      <Instanced matrices={data.ringMatrices} colors={data.ringColors} geometry={geoms.ringChan} material={mats.ring} cullRange={fogFar} />
    </group>
  )
}

const waveColor = new THREE.Color()

const BUCKET_SPAN = 700

/**
 * T173: instanced category, optionally split into ~700m world-grid buckets.
 * One whole-track InstancedMesh always shades every instance — buckets get
 * real bounds + per-frame fog-distance culling. Material/geometry are SHARED
 * objects so the music-pulse writes hit all buckets at once.
 */
function Instanced({
  matrices,
  colors,
  geometry,
  material,
  meshRef,
  cullRange,
}: {
  matrices: THREE.Matrix4[]
  colors?: THREE.Color[]
  geometry: THREE.BufferGeometry
  material: THREE.Material
  meshRef?: React.MutableRefObject<THREE.InstancedMesh | null>
  /** fog cut distance — omit (or pass meshRef) for one always-on mesh */
  cullRange?: number
}) {
  const buckets = useMemo(() => {
    if (!cullRange || meshRef || matrices.length === 0) return null
    const map = new Map<string, number[]>()
    const p = new THREE.Vector3()
    matrices.forEach((mt, i) => {
      p.setFromMatrixPosition(mt)
      const key = `${Math.floor(p.x / BUCKET_SPAN)}:${Math.floor(p.z / BUCKET_SPAN)}`
      const arr = map.get(key)
      if (arr) arr.push(i)
      else map.set(key, [i])
    })
    return [...map.values()].map((idx) => {
      const center = new THREE.Vector3()
      const q = new THREE.Vector3()
      for (const i of idx) center.add(q.setFromMatrixPosition(matrices[i]))
      center.divideScalar(idx.length)
      let radius = 0
      for (const i of idx) radius = Math.max(radius, q.setFromMatrixPosition(matrices[i]).distanceTo(center))
      return { idx, center, radius: radius + 90 }
    })
  }, [matrices, cullRange, meshRef])

  const refs = useRef<(THREE.InstancedMesh | null)[]>([])
  useFrame(({ camera }) => {
    if (!buckets || !cullRange) return
    for (let b = 0; b < buckets.length; b++) {
      const mesh = refs.current[b]
      if (!mesh) continue
      const reach = cullRange + buckets[b].radius
      mesh.visible = buckets[b].center.distanceToSquared(camera.position) < reach * reach
    }
  })

  const fill = (mesh: THREE.InstancedMesh | null, idx: number[] | null) => {
    if (!mesh) return
    const n = idx ? idx.length : matrices.length
    for (let i = 0; i < n; i++) {
      const src = idx ? idx[i] : i
      mesh.setMatrixAt(i, matrices[src])
      if (colors && colors[src]) mesh.setColorAt(i, colors[src])
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.frustumCulled = false
  }

  if (!buckets) {
    return (
      <instancedMesh
        ref={(mesh) => {
          if (meshRef) meshRef.current = mesh
          fill(mesh, null)
        }}
        args={[geometry, material, Math.max(1, matrices.length)]}
      />
    )
  }
  return (
    <>
      {buckets.map((b, bi) => (
        <instancedMesh
          key={bi}
          ref={(mesh) => {
            refs.current[bi] = mesh
            fill(mesh, b.idx)
          }}
          args={[geometry, material, Math.max(1, b.idx.length)]}
        />
      ))}
    </>
  )
}
