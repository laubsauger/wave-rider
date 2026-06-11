import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { attribute, exp, float, fract, smoothstep, uniform, uv } from 'three/tsl'
import type { TrackData } from '../lib/track/generate'
import { curvatureAt, poseAt, type FramePose, type TrackFrames } from '../lib/track/sample'
import { buildBoostPads, buildMedian, buildRail, buildRoad, buildWall, type RibbonGeometry } from '../lib/track/mesh'
import { makeNpcs } from '../lib/physics/npc'
import { pickShipAccent } from '../lib/accent'

/** T90: boost pad = three stacked chevrons pointing down-track, lying flat */
function chevronPadGeometry(): THREE.ExtrudeGeometry {
  const shapes: THREE.Shape[] = []
  for (let c = 0; c < 3; c++) {
    const y0 = c * 2.1 - 2.1 // arrows point -y → -z after rotation
    const sh = new THREE.Shape()
    sh.moveTo(-1.9, y0 + 1.1)
    sh.lineTo(0, y0 - 0.4)
    sh.lineTo(1.9, y0 + 1.1)
    sh.lineTo(1.9, y0 + 2.0)
    sh.lineTo(0, y0 + 0.5)
    sh.lineTo(-1.9, y0 + 2.0)
    sh.closePath()
    shapes.push(sh)
  }
  const g = new THREE.ExtrudeGeometry(shapes, { depth: 0.1, bevelEnabled: false })
  g.rotateX(-Math.PI / 2)
  g.rotateY(Math.PI) // tips face down-track (pad local -Z = travel)
  g.scale(1.55, 1, 1.85) // pads read at speed — physics catch zone is wider anyway
  return g
}
import { telemetry } from '../game/telemetry'

const stripeTarget = new THREE.Color()

interface ExtraAttr {
  name: string
  array: Float32Array
  /** floats per VERTEX (2 verts per sample) */
  itemSize: number
}

/**
 * T173: split a full-track ribbon into ~220-sample chunks (≈0.7-1.3km).
 * A whole-track mesh has ONE bounding sphere — frustum culling never drops
 * it and the GPU draws the entire course every frame. Chunks cull properly,
 * and TrackChunks additionally hides ones beyond the fog wall.
 */
function toChunkedGeometries(r: RibbonGeometry, extras: ExtraAttr[] = []): THREE.BufferGeometry[] {
  const totalSamples = r.uvs.length / 4 // 2 verts × 2 uv floats per sample
  const CHUNK = 220
  const out: THREE.BufferGeometry[] = []
  for (let s0 = 0; s0 < totalSamples - 1; s0 += CHUNK) {
    const s1 = Math.min(totalSamples - 1, s0 + CHUNK) // overlap 1 sample — no seam
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(r.positions.slice(s0 * 6, (s1 + 1) * 6), 3))
    g.setAttribute('normal', new THREE.BufferAttribute(r.normals.slice(s0 * 6, (s1 + 1) * 6), 3))
    g.setAttribute('uv', new THREE.BufferAttribute(r.uvs.slice(s0 * 4, (s1 + 1) * 4), 2))
    for (const ex of extras) {
      g.setAttribute(
        ex.name,
        new THREE.BufferAttribute(ex.array.slice(s0 * 2 * ex.itemSize, (s1 + 1) * 2 * ex.itemSize), ex.itemSize),
      )
    }
    const n = s1 - s0
    const idx = new Uint32Array(n * 6)
    for (let i = 0; i < n; i++) {
      const a = i * 2
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6)
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.computeBoundingSphere()
    out.push(g)
  }
  return out
}

/** chunk meshes + per-frame fog-distance culling */
function TrackChunks({
  chunks,
  material,
  fogFar,
  receiveShadow = false,
}: {
  chunks: THREE.BufferGeometry[]
  material: THREE.Material
  fogFar: number
  receiveShadow?: boolean
}) {
  const refs = useRef<(THREE.Mesh | null)[]>([])
  useFrame(({ camera }) => {
    let drawn = 0
    for (let i = 0; i < chunks.length; i++) {
      const m = refs.current[i]
      const bs = chunks[i].boundingSphere
      if (!m || !bs) continue
      const reach = fogFar + bs.radius
      m.visible = bs.center.distanceToSquared(camera.position) < reach * reach
      if (m.visible) drawn++
    }
    // T173: visible-chunk telemetry — proves whether fog culling actually
    // drops work and whether chunk size is in a sane band (PerfHud `ck`)
    telemetry.chunksDrawn += drawn
  })
  return (
    <>
      {chunks.map((g, i) => (
        <mesh key={i} ref={(m) => void (refs.current[i] = m)} geometry={g} material={material} receiveShadow={receiveShadow} />
      ))}
    </>
  )
}

/**
 * Surface-pattern attributes, 2 verts per frame sample. The deck stripes are
 * SIGNAGE now, not wallpaper:
 *  - aSlant: signed diagonal lean following the curvature ~130m AHEAD — the
 *    slashes tilt into the upcoming turn before you reach it
 *  - aPhase: accumulated stripe phase with per-segment frequency folded in
 *    (chicane/jump ahead → rapid ticks, speedway → long panels). Phase
 *    accumulates so frequency changes never jump the pattern.
 *  - aVis: glides run a clean silent deck — no stripes at all
 */
function roadPatternAttrs(track: TrackData, frames: TrackFrames) {
  const n = frames.count
  const phase = new Float32Array(n * 2)
  const slant = new Float32Array(n * 2)
  const vis = new Float32Array(n * 2)
  const ahead = Math.max(1, Math.round(130 / frames.ds))
  let segIdx = 0
  let ph = 0
  let sm = 0
  for (let i = 0; i < n; i++) {
    const sAhead = (i + ahead) * frames.ds
    while (segIdx < track.segments.length - 1 && sAhead >= track.segments[segIdx].end) segIdx++
    const seg = track.segments[segIdx]
    const freq =
      seg.type === 'chicane' ? 2.4 : seg.type === 'jump' ? 3.2 : seg.type === 'speedway' ? 0.55 : 1
    const k = curvatureAt(frames, Math.min(n - 1, i + ahead))
    const target = Math.max(-1, Math.min(1, k / 0.005)) * 1.1
    sm += (target - sm) * 0.08
    ph += (freq * frames.ds) / 20
    phase[i * 2] = phase[i * 2 + 1] = ph
    slant[i * 2] = slant[i * 2 + 1] = sm
    vis[i * 2] = vis[i * 2 + 1] = seg.type === 'glide' ? 0 : 1
  }
  return { phase, slant, vis }
}

/** per-frame-sample section accent, V19 — drives rail vertex colors */
function railSectionColors(track: TrackData, frames: TrackFrames): Float32Array {
  const arr = new Float32Array(frames.count * 2 * 3)
  const c = new THREE.Color()
  let segIdx = 0
  for (let i = 0; i < frames.count; i++) {
    const s = i * frames.ds
    while (segIdx < track.segments.length - 1 && s >= track.segments[segIdx].end) segIdx++
    c.set(track.sectionPalettes[track.segments[segIdx].sectionIndex] ?? track.theme.edge)
    arr.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6)
  }
  return arr
}

export function Track({ track, frames }: { track: TrackData; frames: TrackFrames }) {
  const padMesh = useRef<THREE.InstancedMesh>(null)
  const padGeo = useMemo(() => chevronPadGeometry(), [])
  const padMat = useRef<THREE.MeshBasicMaterial>(null)

  const geo = useMemo(() => {
    const railColors = railSectionColors(track, frames)
    const colorAttr: ExtraAttr = { name: 'color', array: railColors, itemSize: 3 }
    const pat = roadPatternAttrs(track, frames)
    return {
      road: toChunkedGeometries(buildRoad(track, frames), [
        { name: 'aPhase', array: pat.phase, itemSize: 1 },
        { name: 'aSlant', array: pat.slant, itemSize: 1 },
        { name: 'aVis', array: pat.vis, itemSize: 1 },
      ]),
      railL: toChunkedGeometries(buildRail(track, frames, -1), [colorAttr]),
      railR: toChunkedGeometries(buildRail(track, frames, 1), [colorAttr]),
      wallL: toChunkedGeometries(buildWall(track, frames, -1)),
      wallR: toChunkedGeometries(buildWall(track, frames, 1)),
      median: toChunkedGeometries(buildMedian(frames)),
      pads: buildBoostPads(track, frames),
    }
  }, [track, frames])

  // split divider island — dark slab, theme-edge glow so the fork reads early
  const medianMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#0a0d18',
        metalness: 0.4,
        roughness: 0.5,
        emissive: new THREE.Color(track.theme.edge),
        emissiveIntensity: 0.55,
      }),
    [track.theme.edge],
  )

  const fogFar = 3 / track.theme.fogDensity

  // V19 rails: section-colored vertex attribute × music-pulsed intensity.
  // BEAT WAVE: every onset launches a bright front that races down the
  // rails away from the player (uv.y·20 = arc meters) — the music travels
  // THROUGH the world instead of blinking at it.
  const uRail = useMemo(() => uniform(1.8), [])
  const uWaveS = useMemo(() => uniform(-1e5), [])
  const uWaveAmp = useMemo(() => uniform(0), [])
  const railMaterial = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({ toneMapped: false })
    const dsArc = uv().y.mul(20).sub(uWaveS)
    const wave = exp(dsArc.mul(dsArc).div(-1500)).mul(uWaveAmp)
    m.colorNode = attribute('color').mul(uRail).add(attribute('color').mul(wave).mul(2.4))
    return m
  }, [uRail, uWaveS, uWaveAmp])

  // T105: glass deck — near-black reflective surface, slightly transparent
  // so the world reads below ("hyperspace racer on a glass plane"). Opacity
  // firms up with the section energy. ONE pattern: lateral speed stripes
  // (T22) — center dash, conduits, panel bump all OUT (user feedback).
  const uEnergy = useMemo(() => uniform(0), [])
  // T39: stripe color drifts toward the current section palette at runtime
  const uStripeCol = useMemo(() => uniform(new THREE.Color(track.theme.glow)), [track.theme.glow])
  // T105: glass opacity rides the section energy
  const uOpacity = useMemo(() => uniform(0.8), [])
  const roadMat = useMemo(() => {
    const m = new THREE.MeshPhysicalNodeMaterial({
      color: new THREE.Color('#040609'),
      metalness: 0.6,
      // B27: node materials w/o own envMap IGNORE material.envMapIntensity
      // (three MaterialProperties.js: scene.environmentIntensity wins) — the
      // glancing-angle env mirror ("green/red slab") must be killed via
      // roughness instead
      roughness: 0.34,
      side: THREE.DoubleSide, // T46: no see-through from below at launch
      transparent: true,
    })
    m.opacityNode = uOpacity
    const glow = uStripeCol
    // signage stripes: phase carries cadence, slant tilts them into the
    // turn ahead, vis silences glides. Slanted (turn) stripes run brighter.
    const w = uv().x.sub(0.5)
    const aSlant = attribute('aSlant')
    const v = fract(attribute('aPhase').add(aSlant.mul(w)))
    const stripe = smoothstep(0.93, 0.965, v)
      .sub(smoothstep(0.965, 1.0, v))
      .mul(attribute('aVis'))
      .mul(float(1).add(aSlant.abs().mul(0.5)))
    // faint neon edge lines where deck meets the rails
    const xDist = uv().x.sub(0.5).abs()
    const edgeLine = smoothstep(0.46, 0.495, xDist)
    const dsArc = uv().y.mul(20).sub(uWaveS)
    const wave = exp(dsArc.mul(dsArc).div(-1500)).mul(uWaveAmp)
    m.emissiveNode = glow
      .mul(stripe.mul(uEnergy.mul(1.6).add(0.4)))
      .add(glow.mul(edgeLine.mul(uEnergy.mul(0.5).add(0.25))))
      .add(glow.mul(wave).mul(0.4))
    return m
  }, [track.theme, uEnergy, uStripeCol, uOpacity, uWaveS, uWaveAmp])

  // T123: walls v2 — gradient glass, dense at the base fading clear at the
  // top, lit top edge riding the section palette, faint scanlines. uv.x is
  // wall height (0 base → 1 top), uv.y arc/20m (mesh.ts).
  const wallMat = useMemo(() => {
    const m = new THREE.MeshStandardNodeMaterial({
      color: new THREE.Color('#05070e'),
      metalness: 0.4,
      roughness: 0.55, // B27: env intensity ignored on node materials
      transparent: true,
      side: THREE.DoubleSide,
    })
    const h = uv().x
    m.opacityNode = float(0.8).mul(float(1).sub(h.mul(0.72)))
    const topEdge = smoothstep(0.82, 0.95, h).sub(smoothstep(0.97, 1.0, h))
    const band = fract(uv().y.mul(1.5))
    const scan = smoothstep(0.46, 0.5, band).mul(smoothstep(0.54, 0.5, band))
    m.emissiveNode = uStripeCol
      .mul(topEdge.mul(uEnergy.mul(1.4).add(0.55)))
      .add(uStripeCol.mul(scan.mul(uEnergy.mul(0.5).add(0.12))))
    return m
  }, [uStripeCol, uEnergy])

  /** beat-wave + pad-pop scratch */
  const fx = useRef({ waveS: -1e5, lastBeat: 0, lastWaveMs: -1e9 })
  const padObj = useMemo(() => new THREE.Object3D(), [])

  // audio-reactive pulse (T21/T39) — V10-safe: brightness only.
  // beat = sharp onset spikes layered on top of the energy floor.
  useFrame((_, dt) => {
    // T57: rails+stripes track ENERGY (loudness), pads flash on BEAT only.
    // T149: energy² + lower floors — songs idle around e≈0.6, so the linear
    // curves sat pegged near max. Square it: quiet is QUIET, drops still slam.
    const eRaw = telemetry.energy * track.theme.pulse
    const e = eRaw * eRaw
    const b = telemetry.beat * track.theme.pulse
    // T98: base brightness follows the SECTION's energy — breakdowns dim the
    // whole world so drops have somewhere to go
    const secE = track.sectionEnergies[telemetry.sectionIndex] ?? 0.5
    uEnergy.value = e * (0.25 + secE * 0.85)
    // drops crank the rails for their decay — section-scale punctuation
    uRail.value = 0.2 + secE * 0.85 + e * 3.0 + telemetry.dropPulse * 1.6 // T166

    // BEAT WAVE — sporadic punctuation, not a strobe: fires only on HEAVY
    // low-end hits, rate-limited to one wave per ~2s, and dimmer. The track
    // floor must never read as flashing.
    const playerArc = telemetry.progress * track.length
    if (
      b >= 0.99 &&
      fx.current.lastBeat < 0.5 &&
      telemetry.bass > 0.24 &&
      telemetry.timeMs - fx.current.lastWaveMs > 1900
    ) {
      fx.current.waveS = playerArc
      fx.current.lastWaveMs = telemetry.timeMs
      uWaveAmp.value = 0.16 + secE * 0.28
    }
    fx.current.lastBeat = b
    fx.current.waveS += dt * 560
    uWaveS.value = fx.current.waveS
    uWaveAmp.value = Math.max(0, uWaveAmp.value - dt * 0.45)

    // pad choreography: pads near the player POP on the beat (scale pulse)
    if (padMesh.current && padData.poses.length > 0) {
      let dirty = false
      for (let i = 0; i < padData.poses.length; i++) {
        const pd = padData.poses[i]
        const dist = Math.abs(pd.s - playerArc)
        if (dist > 420 && !pd.popped) continue
        const prox = Math.max(0, 1 - dist / 420)
        const scale = 1 + b * 0.45 * prox
        pd.popped = scale > 1.01
        padObj.position.copy(pd.pos)
        padObj.quaternion.copy(pd.quat)
        padObj.scale.setScalar(scale)
        padObj.updateMatrix()
        padMesh.current.setMatrixAt(i, padObj.matrix)
        dirty = true
      }
      if (dirty) padMesh.current.instanceMatrix.needsUpdate = true
    }
    if (padMat.current) {
      const s = 1.2 + b * 3.8
      padMat.current.color.setRGB(s, s, s)
    }
    const cd = telemetry.countdown
    const goFlash = cd <= 0 && cd > -1 ? 1 + cd : 0
    if (gantryMat.current) gantryMat.current.emissiveIntensity = 2.6 + goFlash * 12
    if (stripMat.current) stripMat.current.emissiveIntensity = 0.9 + goFlash * 9
    // T105/T118: glassier — firms up when the music pushes, thins in breakdowns
    uOpacity.value = 0.44 + secE * 0.26 + e * 0.12
    const sectionColor = track.sectionPalettes[telemetry.sectionIndex]
    if (sectionColor) {
      stripeTarget.set(sectionColor)
      ;(uStripeCol.value as THREE.Color).lerp(stripeTarget, Math.min(1, dt * 0.8))
    }
  })

  // pads: instanced, V19 section-colored via instanceColor
  const padData = useMemo(() => {
    const obj = new THREE.Object3D()
    const c = new THREE.Color()
    const matrices: THREE.Matrix4[] = []
    const colors: THREE.Color[] = []
    const poses: { pos: THREE.Vector3; quat: THREE.Quaternion; s: number; popped: boolean }[] = []
    geo.pads.forEach((p, i) => {
      obj.position.set(p.x, p.y, p.z)
      const m = new THREE.Matrix4().lookAt(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(p.tx, p.ty, p.tz),
        new THREE.Vector3(p.nx, p.ny, p.nz),
      )
      obj.quaternion.setFromRotationMatrix(m)
      obj.scale.set(1, 1, 1)
      obj.updateMatrix()
      matrices.push(obj.matrix.clone())
      const padS = track.boosts[i]?.s ?? 0
      poses.push({ pos: obj.position.clone(), quat: obj.quaternion.clone(), s: padS, popped: false })
      const seg = track.segments.find((sg) => padS >= sg.start && padS < sg.end)
      c.set(track.sectionPalettes[seg?.sectionIndex ?? 0] ?? track.theme.glow)
      colors.push(c.clone())
    })
    return { matrices, colors, poses }
  }, [geo.pads, track])

  // T46/T105: start zone — deck + a 280m lead-in road so the ribbon's cut
  // edge sits far behind the camera, plus grid-slot markings
  const deck = useMemo(() => {
    const p = new THREE.Vector3(frames.positions[0], frames.positions[1], frames.positions[2])
    const t = new THREE.Vector3(frames.tangents[0], frames.tangents[1], frames.tangents[2])
    const up = new THREE.Vector3(frames.normals[0], frames.normals[1], frames.normals[2])
    const b = new THREE.Vector3().crossVectors(t, up).normalize()
    const pos = p.clone().addScaledVector(t, -70).addScaledVector(up, -1.42)
    const q = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(), t, up),
    )

    // lead-in road surface: flat quad strip from s=0 back 280m
    const halfW = (track.width * (frames.widths[0] ?? 1)) / 2
    const p0 = p.clone().addScaledVector(up, -0.02)
    const p1 = p.clone().addScaledVector(t, -280).addScaledVector(up, -0.02)
    const quad = (wL: number, wR: number, lift: number) => {
      const g = new THREE.BufferGeometry()
      const a0 = p0.clone().addScaledVector(b, wL).addScaledVector(up, lift)
      const a1 = p0.clone().addScaledVector(b, wR).addScaledVector(up, lift)
      const a2 = p1.clone().addScaledVector(b, wL).addScaledVector(up, lift)
      const a3 = p1.clone().addScaledVector(b, wR).addScaledVector(up, lift)
      g.setAttribute(
        'position',
        new THREE.BufferAttribute(
          new Float32Array([...a0.toArray(), ...a1.toArray(), ...a2.toArray(), ...a1.toArray(), ...a3.toArray(), ...a2.toArray()]),
          3,
        ),
      )
      // uv.y continues the road's 20m stripe cadence backwards; uv.x spans
      // the width so the center dash lines up — lets us reuse roadMat
      const vEnd = -280 / 20
      g.setAttribute(
        'uv',
        new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, vEnd, 1, 0, 1, vEnd, 0, vEnd]), 2),
      )
      // pattern attrs so roadMat's signage shader binds on the lead-in too:
      // phase continues the cadence backwards, no slant, stripes visible
      g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array([0, 0, vEnd, 0, vEnd, vEnd]), 1))
      g.setAttribute('aSlant', new THREE.BufferAttribute(new Float32Array(6), 1))
      g.setAttribute('aVis', new THREE.BufferAttribute(new Float32Array(6).fill(1), 1))
      g.computeVertexNormals()
      return g
    }
    const leadRoad = quad(-halfW, halfW, 0)
    const stripL = quad(-halfW - 0.6, -halfW, 0.22)
    const stripR = quad(halfW, halfW + 0.6, 0.22)

    // grid-slot markers: player at the line (back of the grid), the field
    // staggered AHEAD on the real track — matches initialNpc()
    const slots: { pos: THREE.Vector3; q: THREE.Quaternion }[] = []
    const sp = {} as FramePose
    slots.push({ pos: p.clone().addScaledVector(up, 0.06), q })
    for (let i = 0; i < 5; i++) {
      const row = Math.floor(i / 2)
      const col = i % 2 === 0 ? -5 : 5
      poseAt(frames, 42 - row * 14, col, 0.06, sp)
      slots.push({ pos: new THREE.Vector3(sp.px, sp.py, sp.pz), q })
    }
    return { pos, q, fwd: t.clone(), col: b, leadRoad, stripL, stripR, slots }
  }, [frames, track.width])

  // T105: GO flash — gantry + lead-in strips flare as the countdown breaks
  const gantryMat = useRef<THREE.MeshStandardMaterial>(null)
  const stripMat = useRef<THREE.MeshStandardMaterial>(null)

  // T128: marker bar colors — player first, then the NPC field (V13 colors)
  const slotAccents = useMemo(
    () => [pickShipAccent(track.theme.edge, track.theme.glow), ...makeNpcs(track).map((n) => n.accent)],
    [track],
  )

  return (
    <group>
      <TrackChunks chunks={geo.road} material={roadMat} fogFar={fogFar} receiveShadow />
      {/* T73/T108/T126: start apron — matte near-black, slimmed flush with
          the road so it reads as deck continuation, not a foreign slab */}
      <mesh name="apron" position={deck.pos} quaternion={deck.q}>
        <boxGeometry args={[track.width + 1.6, 2.7, 240]} />
        <meshStandardMaterial color="#030409" metalness={0.1} roughness={0.95} envMapIntensity={0.05} />
      </mesh>
      {/* start gantry over the line */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[
            deck.pos.x + deck.col.x * side * (track.width / 2 + 3) - deck.fwd.x * 68,
            deck.pos.y + deck.col.y * side * (track.width / 2 + 3) + 7,
            deck.pos.z + deck.col.z * side * (track.width / 2 + 3) - deck.fwd.z * 68,
          ]}
          quaternion={deck.q}
        >
          <boxGeometry args={[1.4, 16, 1.4]} />
          <meshStandardMaterial color="#0c0f1c" emissive={track.theme.edge} emissiveIntensity={0.7} toneMapped={false} />
        </mesh>
      ))}
      <mesh
        position={[deck.pos.x - deck.fwd.x * 68, deck.pos.y + 14.2, deck.pos.z - deck.fwd.z * 68]}
        quaternion={deck.q}
      >
        <boxGeometry args={[track.width + 8, 1.6, 1.6]} />
        <meshStandardMaterial ref={gantryMat} color="#000" emissive={track.theme.edge} emissiveIntensity={2.6} toneMapped={false} />
      </mesh>
      {/* T105: lead-in road wears the SAME shader as the track — seamless */}
      <mesh geometry={deck.leadRoad} material={roadMat} />
      {[deck.stripL, deck.stripR].map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial
            ref={i === 0 ? stripMat : undefined}
            color="#000"
            emissive={track.theme.edge}
            emissiveIntensity={0.9}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {/* T128: grid markers v2 — slot pads gone; each racer gets a thin
          glowing bar in their accent color at the front of their slot */}
      {deck.slots.map((sl, i) => (
        <mesh
          key={i}
          position={[
            sl.pos.x + deck.fwd.x * 4.4,
            sl.pos.y + deck.fwd.y * 4.4 + 0.05,
            sl.pos.z + deck.fwd.z * 4.4,
          ]}
          quaternion={sl.q}
        >
          <boxGeometry args={[4, 0.08, 0.3]} />
          <meshBasicMaterial color={slotAccents[i] ?? track.theme.glow} toneMapped={false} />
        </mesh>
      ))}
      <TrackChunks chunks={geo.railL} material={railMaterial} fogFar={fogFar} />
      <TrackChunks chunks={geo.railR} material={railMaterial} fogFar={fogFar} />
      <TrackChunks chunks={geo.wallL} material={wallMat} fogFar={fogFar} />
      <TrackChunks chunks={geo.wallR} material={wallMat} fogFar={fogFar} />
      <TrackChunks chunks={geo.median} material={medianMat} fogFar={fogFar} />
      <instancedMesh
        ref={(mesh) => {
          padMesh.current = mesh
          if (mesh) {
            padData.matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
            padData.colors.forEach((c, i) => mesh.setColorAt(i, c))
            mesh.instanceMatrix.needsUpdate = true
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
            mesh.frustumCulled = false
          }
        }}
        args={[undefined, undefined, Math.max(1, padData.matrices.length)]}
        geometry={padGeo}
      >
        <meshBasicMaterial ref={padMat} color="#ffffff" toneMapped={false} side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  )
}
