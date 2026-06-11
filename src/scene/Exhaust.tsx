import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { attribute, color, float, mix, sin, smoothstep, sub, uniform } from 'three/tsl'

const POINTS = 48 // longer history → the trail reads from a distance at pace

interface TrailProps {
  /** ref to the ship group; engine offsets are in its local space */
  shipRef: React.RefObject<THREE.Group | null>
  offsets: [number, number, number][]
  color: string
  /** 0..1+ thrust/boost intensity, read per frame */
  intensity: () => number
  /** ship speed m/s, read per frame — drives the hyperspeed escalation */
  speed?: () => number
}

/**
 * Exhaust v2 (T30): camera-facing ribbon with a TSL gradient — white-hot
 * core fading to accent at the edges, alpha falls off along the trail,
 * subtle flicker bands. Geometry rebuilt per frame from a position ring
 * buffer; the look lives in the shader, not vertex colors.
 */
export function ExhaustTrails({ shipRef, offsets, color: accent, intensity, speed }: TrailProps) {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([])
  const uPower = useMemo(() => uniform(0), [])
  const uTime = useMemo(() => uniform(0), [])
  /** 0..1 over ~250→2000 kph — the whole escalation rides this */
  const uVel = useMemo(() => uniform(0), [])

  const material = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const u = attribute('uv').x // 0..1 across the ribbon
    const v = attribute('uv').y // 0..1 along the trail (age)
    const cross = sub(1, sub(u, 0.5).abs().mul(2)) // 1 center → 0 edges
    // T101: hot core is NARROW and fades with age — accent owns the trail,
    // white only kisses the first meters (was blooming everything to white)
    const core = smoothstep(0.78, 0.99, cross).mul(sub(1, v).pow(2))
    // T127/T141: the head IS the flame — but the ACCENT owns it; white only
    // kisses the core so the player color reads through
    const flameHead = sub(1, v).pow(8).mul(uPower.mul(0.5))
    // hyperspeed escalation: an OVERDRIVEN accent filament ignites down the
    // center and reaches further along the trail as uVel climbs — the plume
    // saturates IN the player color instead of blowing out to white
    const filament = smoothstep(float(0.92).sub(uVel.mul(0.18)), 1.0, cross)
      .mul(sub(1, v).pow(float(3).sub(uVel.mul(1.6))))
      .mul(uVel)
    m.colorNode = mix(color(new THREE.Color(accent)), color(new THREE.Color('#ffffff')), core.mul(0.5).add(flameHead).min(0.8))
      .add(color(new THREE.Color(accent)).mul(filament.mul(2.6)))
      .mul(float(1.05).add(uPower.mul(0.4)).add(flameHead.mul(0.45)).add(uVel.mul(0.5)))
    // T141: flicker calmed — texture, not strobe; agitates a touch with speed
    const flicker = sin(v.mul(26).sub(uTime.mul(34).add(uVel.mul(18)))).mul(float(0.06).add(uVel.mul(0.05))).add(0.94)
    // T141: soft leading edge — the ribbon blooms out of the nozzle instead
    // of starting as a razor cut
    const headEase = smoothstep(0.0, 0.045, v).mul(0.45).add(0.55)
    m.opacityNode = cross
      .pow(1.6)
      // tail persists longer at speed — the trail READS as longer fire
      .mul(sub(1, v).pow(float(2.6).sub(uVel.mul(1.35))))
      .mul(uPower.min(1.5).add(uVel.mul(0.3)))
      .mul(flicker)
      .mul(headEase)
    return m
  }, [accent, uPower, uTime, uVel])

  const trails = useMemo(
    () =>
      offsets.map(() => {
        const uvs = new Float32Array(POINTS * 2 * 2)
        for (let i = 0; i < POINTS; i++) {
          const v = i / (POINTS - 1)
          uvs.set([0, v, 1, v], i * 4)
        }
        const idx = new Uint16Array((POINTS - 1) * 6)
        for (let i = 0; i < POINTS - 1; i++) {
          const a = i * 2
          idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6)
        }
        return {
          history: new Float32Array(POINTS * 3),
          filled: 0,
          positions: new Float32Array(POINTS * 2 * 3),
          uvs,
          indices: idx,
          // T50: fixed-rate emission state — no frame-paced stutter
          acc: 0,
          lastX: 0,
          lastY: 0,
          lastZ: 0,
          primed: false,
        }
      }),
    [offsets],
  )

  const tmp = useMemo(
    () => ({
      p: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      toCam: new THREE.Vector3(),
      side: new THREE.Vector3(),
    }),
    [],
  )

  const EMIT_DT = 1 / 90

  // B34: priority 0.5 — pose writers run at default 0;
  // reading the ship transform BEFORE it updates left the trail head one
  // frame behind: a v·dt gap, 10m+ at hyperspeed.
  useFrame(({ camera, clock }, dt) => {
    const ship = shipRef.current
    if (!ship) return
    const power = intensity()
    uPower.value += (power - uPower.value) * 0.25
    uTime.value = clock.elapsedTime
    // smooth speed-normalized escalation: continuous from 0 — no dead zone,
    // every kph gained reads on the plume (sqrt-ish curve lifts the low end)
    const kph = (speed?.() ?? 0) * 3.6
    const velN = Math.pow(Math.min(1, Math.max(0, kph / 2000)), 0.8)
    uVel.value += (velN - uVel.value) * 0.06

    trails.forEach((trail, ti) => {
      const mesh = meshRefs.current[ti]
      if (!mesh) return

      tmp.p.set(...offsets[ti])
      ship.localToWorld(tmp.p)
      if (!trail.primed) {
        trail.lastX = tmp.p.x
        trail.lastY = tmp.p.y
        trail.lastZ = tmp.p.z
        trail.primed = true
      }

      // T50: emit at a fixed 90Hz, interpolating along this frame's motion —
      // history spacing stays even regardless of frame pacing
      trail.acc += Math.min(0.1, dt)
      let emits = Math.floor(trail.acc / EMIT_DT)
      if (emits > 0) {
        trail.acc -= emits * EMIT_DT
        emits = Math.min(emits, POINTS)
        for (let e = 1; e <= emits; e++) {
          const f = e / emits
          trail.history.copyWithin(3, 0, (POINTS - 1) * 3)
          trail.history[0] = trail.lastX + (tmp.p.x - trail.lastX) * f
          trail.history[1] = trail.lastY + (tmp.p.y - trail.lastY) * f
          trail.history[2] = trail.lastZ + (tmp.p.z - trail.lastZ) * f
          if (trail.filled < POINTS) trail.filled++
        }
        trail.lastX = tmp.p.x
        trail.lastY = tmp.p.y
        trail.lastZ = tmp.p.z
      } else {
        // keep the head glued to the engine between emits
        trail.history[0] = tmp.p.x
        trail.history[1] = tmp.p.y
        trail.history[2] = tmp.p.z
      }

      const n = trail.filled
      for (let i = 0; i < POINTS; i++) {
        const j = Math.max(0, Math.min(i, n - 1))
        const x = trail.history[j * 3]
        const y = trail.history[j * 3 + 1]
        const z = trail.history[j * 3 + 2]
        const k = Math.max(0, Math.min(j + 1, n - 1))
        tmp.dir.set(trail.history[k * 3] - x, trail.history[k * 3 + 1] - y, trail.history[k * 3 + 2] - z)
        tmp.toCam.set(camera.position.x - x, camera.position.y - y, camera.position.z - z)
        tmp.side.crossVectors(tmp.dir, tmp.toCam)
        const len = tmp.side.length()
        if (len > 1e-6) tmp.side.divideScalar(len)
        else tmp.side.set(0, 1, 0)

        const age = i / POINTS
        // T127/T141: mach-diamond read — bulge right at the nozzle exit,
        // pinch, then the long taper down the trail. Plume GROWS with speed.
        const bulge = 1 + Math.exp(-i * 0.85) * 0.55
        const w = 0.22 * (1 - age * 0.72) * (0.3 + Math.min(1.5, power) * 0.65) * bulge * (1 + uVel.value * 0.85)
        trail.positions.set(
          [x + tmp.side.x * w, y + tmp.side.y * w, z + tmp.side.z * w, x - tmp.side.x * w, y - tmp.side.y * w, z - tmp.side.z * w],
          i * 6,
        )
      }

      const geo = mesh.geometry
      geo.attributes.position.array.set(trail.positions)
      geo.attributes.position.needsUpdate = true
      // B18: frustumCulled=false → no bounding sphere needed; computing it on
      // degenerate first-frame quads spammed NaN warnings
    })
  }, 0.5)

  return (
    <>
      {trails.map((trail, i) => (
        <mesh key={i} ref={(m) => void (meshRefs.current[i] = m)} frustumCulled={false} material={material}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[trail.positions, 3]} />
            <bufferAttribute attach="attributes-uv" args={[trail.uvs, 2]} />
            <bufferAttribute attach="index" args={[trail.indices, 1]} />
          </bufferGeometry>
        </mesh>
      ))}
    </>
  )
}
