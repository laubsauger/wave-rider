import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { attribute, float, fract, smoothstep, uniform, uv } from 'three/tsl'
import type { TrackData } from '../lib/track/generate'
import type { TrackFrames } from '../lib/track/sample'
import { buildBoostPads, buildRail, buildRoad, buildWall, type RibbonGeometry } from '../lib/track/mesh'
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

function toGeometry(r: RibbonGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(r.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(r.indices, 1))
  return g
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
    const railL = toGeometry(buildRail(track, frames, -1))
    const railR = toGeometry(buildRail(track, frames, 1))
    railL.setAttribute('color', new THREE.BufferAttribute(railColors, 3))
    railR.setAttribute('color', new THREE.BufferAttribute(railColors, 3))
    return {
      road: toGeometry(buildRoad(track, frames)),
      railL,
      railR,
      wallL: toGeometry(buildWall(track, frames, -1)),
      wallR: toGeometry(buildWall(track, frames, 1)),
      pads: buildBoostPads(track, frames),
    }
  }, [track, frames])

  // V19 rails: section-colored vertex attribute × music-pulsed intensity
  const uRail = useMemo(() => uniform(1.8), [])
  const railMaterial = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({ toneMapped: false })
    m.colorNode = attribute('color').mul(uRail)
    return m
  }, [uRail])

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
    const v = fract(uv().y)
    const stripe = smoothstep(0.93, 0.965, v).sub(smoothstep(0.965, 1.0, v))
    // faint neon edge lines where deck meets the rails
    const xDist = uv().x.sub(0.5).abs()
    const edgeLine = smoothstep(0.46, 0.495, xDist)
    m.emissiveNode = glow
      .mul(stripe.mul(uEnergy.mul(1.6).add(0.4)))
      .add(glow.mul(edgeLine.mul(uEnergy.mul(0.5).add(0.25))))
    return m
  }, [track.theme, uEnergy, uStripeCol, uOpacity])

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

  // audio-reactive pulse (T21/T39) — V10-safe: brightness only.
  // beat = sharp onset spikes layered on top of the energy floor.
  useFrame((_, dt) => {
    // T57: rails+stripes track ENERGY (loudness), pads flash on BEAT only
    const e = telemetry.energy * track.theme.pulse
    const b = telemetry.beat * track.theme.pulse
    // T98: base brightness follows the SECTION's energy — breakdowns dim the
    // whole world so drops have somewhere to go
    const secE = track.sectionEnergies[telemetry.sectionIndex] ?? 0.5
    uEnergy.value = e * (0.4 + secE * 0.8)
    uRail.value = 0.5 + secE * 1.1 + e * 2.4
    if (padMat.current) {
      const s = 1.8 + b * 3.2
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
      const seg = track.segments.find((sg) => padS >= sg.start && padS < sg.end)
      c.set(track.sectionPalettes[seg?.sectionIndex ?? 0] ?? track.theme.glow)
      colors.push(c.clone())
    })
    return { matrices, colors }
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
      g.computeVertexNormals()
      return g
    }
    const leadRoad = quad(-halfW, halfW, 0)
    const stripL = quad(-halfW - 0.6, -halfW, 0.22)
    const stripR = quad(halfW, halfW + 0.6, 0.22)

    // 3×2 grid-slot outlines behind the line
    const slots: { pos: THREE.Vector3; q: THREE.Quaternion }[] = []
    for (let i = 0; i < 6; i++) {
      const row = Math.floor(i / 2)
      const col = i % 2 === 0 ? -5 : 5
      slots.push({
        pos: p.clone().addScaledVector(t, -(row === 0 ? 0 : 14 * row)).addScaledVector(b, row === 0 && i < 2 ? 0 : col).addScaledVector(up, 0.06),
        q,
      })
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
      <mesh geometry={geo.road} material={roadMat} receiveShadow />
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
      {[geo.railL, geo.railR].map((g, i) => (
        <mesh key={i} geometry={g} material={railMaterial} />
      ))}
      {[geo.wallL, geo.wallR].map((g, i) => (
        <mesh key={i} geometry={g} material={wallMat} />
      ))}
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
