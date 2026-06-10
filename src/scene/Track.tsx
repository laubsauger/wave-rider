import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { attribute, color, fract, smoothstep, uniform, uv } from 'three/tsl'
import type { TrackData } from '../lib/track/generate'
import type { TrackFrames } from '../lib/track/sample'
import { buildBoostPads, buildRail, buildRoad, buildWall, type RibbonGeometry } from '../lib/track/mesh'

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

  // T22: road surface = deep black + lateral glow stripes every 20m (speed
  // cue) + dashed center line. Stripe brightness rides the music (T21).
  const uEnergy = useMemo(() => uniform(0), [])
  // T39: stripe color drifts toward the current section palette at runtime
  const uStripeCol = useMemo(() => uniform(new THREE.Color(track.theme.glow)), [track.theme.glow])
  const roadMat = useMemo(() => {
    const m = new THREE.MeshStandardNodeMaterial({
      color: new THREE.Color(track.theme.road),
      metalness: 0.55,
      roughness: 0.38,
      side: THREE.DoubleSide, // T46: no see-through from below at launch
    })
    const glow = uStripeCol
    const edge = color(new THREE.Color(track.theme.edge))
    const v = fract(uv().y)
    const stripe = smoothstep(0.93, 0.965, v).sub(smoothstep(0.965, 1.0, v))
    const xDist = uv().x.sub(0.5).abs()
    const f3 = fract(uv().y.mul(3))
    const dashGate = smoothstep(0.02, 0.08, f3).mul(smoothstep(0.62, 0.55, f3))
    const dash = smoothstep(0.02, 0.011, xDist).mul(dashGate)
    m.emissiveNode = glow
      .mul(stripe.mul(uEnergy.mul(1.6).add(0.4)))
      .add(edge.mul(dash.mul(0.45)))
      .add(glow.mul(0.05))
    return m
  }, [track.theme, uEnergy])

  // audio-reactive pulse (T21/T39) — V10-safe: brightness only.
  // beat = sharp onset spikes layered on top of the energy floor.
  useFrame((_, dt) => {
    // T57: rails+stripes track ENERGY (loudness), pads flash on BEAT only
    const e = telemetry.energy * track.theme.pulse
    const b = telemetry.beat * track.theme.pulse
    uEnergy.value = e
    uRail.value = 1.5 + e * 3
    if (padMat.current) {
      const s = 1.8 + b * 3.2
      padMat.current.color.setRGB(s, s, s)
    }
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

  // T46: solid deck under the starting grid
  const deck = useMemo(() => {
    const p = new THREE.Vector3(frames.positions[0], frames.positions[1], frames.positions[2])
    const t = new THREE.Vector3(frames.tangents[0], frames.tangents[1], frames.tangents[2])
    const up = new THREE.Vector3(frames.normals[0], frames.normals[1], frames.normals[2])
    const pos = p.clone().addScaledVector(t, -70).addScaledVector(up, -1.42)
    const q = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(), t, up),
    )
    const col = new THREE.Vector3().crossVectors(t, up).normalize()
    return { pos, q, fwd: t.clone(), col }
  }, [frames])

  return (
    <group>
      <mesh geometry={geo.road} material={roadMat} receiveShadow />
      {/* T73: start apron — dark deck, no glow band */}
      <mesh position={deck.pos} quaternion={deck.q}>
        <boxGeometry args={[track.width + 10, 2.7, 240]} />
        <meshStandardMaterial color="#05070d" metalness={0.4} roughness={0.8} />
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
        <meshStandardMaterial color="#000" emissive={track.theme.edge} emissiveIntensity={2.6} toneMapped={false} />
      </mesh>
      {[geo.railL, geo.railR].map((g, i) => (
        <mesh key={i} geometry={g} material={railMaterial} />
      ))}
      {[geo.wallL, geo.wallR].map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshStandardMaterial
            color={track.theme.road}
            emissive={track.theme.glow}
            emissiveIntensity={0.15}
            transparent
            opacity={0.85}
            side={THREE.DoubleSide}
          />
        </mesh>
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
