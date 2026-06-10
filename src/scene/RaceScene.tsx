import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { useGame } from '../game/store'
import { telemetry } from '../game/telemetry'
import { attachKeyboard, onGameKey, readShipInput, resetInput } from '../game/input'
import {
  computeLean,
  initialShip,
  stepShip,
  PHYSICS_DT,
  type ShipInput,
  type StepEvents,
} from '../lib/physics/ship'
import { accumulateSteps } from '../lib/physics/loop'
import { sampleTrack, poseAt, curvatureAt, type FramePose, type TrackFrames } from '../lib/track/sample'
import {
  initialNpc,
  makeNpcs,
  racePosition,
  resolveCollisions,
  stepNpc,
  type NpcSpec,
  type NpcState,
} from '../lib/physics/npc'
import { playSong, type SongHandle } from '../lib/audio/playback'
import { Track } from './Track'
import { Scenery } from './Scenery'
import { GridFloor, Ridges, WarpStreaks } from './Environment'
import { ShipMesh } from './ShipMesh'
import { ExhaustTrails } from './Exhaust'
import type { TrackData } from '../lib/track/generate'

const tmpMatrix = new THREE.Matrix4()
const tmpEye = new THREE.Vector3(0, 0, 0)
const tmpDir = new THREE.Vector3()
const tmpUp = new THREE.Vector3()
const skyTint = new THREE.Color()
const skyTarget = new THREE.Color()
const fogTarget = new THREE.Color()

const HOVER_HEIGHT = 0.9

interface ShakeState {
  trauma: number
}

export function RaceScene({
  track,
  paused = false,
  quality = 'high',
}: {
  track: TrackData
  paused?: boolean
  quality?: 'low' | 'medium' | 'high'
}) {
  const features = useGame((s) => s.features)!
  const songBuffer = useGame((s) => s.songBuffer)
  const songTitle = useGame((s) => s.songTitle)
  const cameraMode = useGame((s) => s.cameraMode)
  const fxIntensity = useGame((s) => s.settings.fxIntensity)
  const toggleCamera = useGame((s) => s.toggleCamera)
  const finishRace = useGame((s) => s.finishRace)

  const frames = useMemo(
    () => sampleTrack(track, quality === 'low' ? 6 : quality === 'medium' ? 4 : 3),
    [track, quality],
  )
  const scene = useThree((s) => s.scene)
  const skyColors = useMemo(
    () => ({
      base: new THREE.Color(track.theme.sky),
      flash: new THREE.Color(track.theme.sky).lerp(new THREE.Color(track.theme.glow), 0.32),
      themeSky: new THREE.Color(track.theme.sky),
      themeFog: new THREE.Color(track.theme.fog),
    }),
    [track.theme],
  )
  const shipGroup = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera

  const npcSpecs = useMemo(() => makeNpcs(track), [track])

  const sim = useRef({
    npcs: [] as NpcState[],
    ship: initialShip(),
    input: { steer: 0, thrust: 0, brakeLeft: false, brakeRight: false } as ShipInput,
    events: { wallHit: false, wallImpact: 0, boostFired: false, finished: false } as StepEvents,
    accumulator: { acc: 0 },
    pose: {} as FramePose,
    shake: { trauma: 0 } as ShakeState,
    song: null as SongHandle | null,
    started: false,
    roll: 0,
    airPitch: 0,
    /** T35: 3-2-1-GO; sim + music locked until ≤ 0 */
    countdown: 3.8,
    /** T39: pointers walked monotonically per frame */
    onsetIdx: 0,
    segIdx: 0,
    /** T45: smoothed longitudinal accel → camera pull/fov surge */
    vPrev: 0,
    pull: 0,
  })

  // input + camera toggle + song lifecycle
  useEffect(() => {
    resetInput()
    const detachKb = attachKeyboard()
    const detachKeys = onGameKey((e) => {
      if (e === 'camera') toggleCamera()
    })
    const s = sim.current
    s.npcs = npcSpecs.map((_, i) => initialNpc(i))
    // T35: song starts at GO, not on mount — see countdown in the frame loop
    s.started = true
    return () => {
      detachKb()
      detachKeys()
      s.song?.stop()
      s.song = null
    }
  }, [songBuffer, toggleCamera])

  useFrame((_, dt) => {
    const s = sim.current
    if (!s.started || paused) return

    // T35 countdown: hold the grid, fire the song at GO
    if (s.countdown > -1) {
      const prev = s.countdown
      s.countdown -= dt
      telemetry.countdown = s.countdown
      if (prev > 0 && s.countdown <= 0 && songBuffer && !s.song) {
        s.song = playSong(songBuffer)
      }
    }

    readShipInput(s.input)
    const steps = s.countdown > 0 ? 0 : accumulateSteps(s.accumulator, dt)
    let wallEvent = 0
    let boostEvent = false
    let finishedEvent = false
    let landEvent = 0
    for (let i = 0; i < steps; i++) {
      stepShip(s.ship, s.input, track, frames, s.events)
      for (let ni = 0; ni < s.npcs.length; ni++) stepNpc(s.npcs[ni], npcSpecs[ni], track, frames)
      // T32: bump resolution — player + all NPCs in one deterministic pass
      const bump = resolveCollisions([s.ship, ...s.npcs], track)
      if (bump > 0) wallEvent = Math.max(wallEvent, bump * 0.6)
      if (s.events.wallHit) wallEvent = Math.max(wallEvent, s.events.wallImpact)
      if (s.events.boostFired) boostEvent = true
      if (s.events.landed) landEvent = Math.max(landEvent, s.events.landImpact)
      if (s.events.finished) finishedEvent = true
    }

    // shake trauma (V10: scaled by fxIntensity at application time)
    if (wallEvent > 0) s.shake.trauma = Math.min(1, s.shake.trauma + 0.25 + wallEvent * 0.02)
    if (boostEvent) s.shake.trauma = Math.min(1, s.shake.trauma + 0.18)
    if (landEvent > 0) s.shake.trauma = Math.min(1, s.shake.trauma + Math.min(0.45, landEvent * 0.012))
    s.shake.trauma = Math.max(0, s.shake.trauma - dt * 1.6)

    // T45: accel feel — camera pulls back under thrust, snaps in on scrub
    const ship = s.ship
    if (steps > 0) {
      const accel = (ship.v - s.vPrev) / (steps * PHYSICS_DT)
      s.vPrev = ship.v
      const target = Math.max(-0.6, Math.min(1.2, accel * 0.022))
      s.pull += (target - s.pull) * Math.min(1, dt * 4)
    }

    // ship world transform — air height rides on top of hover (V16)
    poseAt(frames, ship.s, ship.d, HOVER_HEIGHT + ship.air, s.pose)
    const g = shipGroup.current
    if (g) {
      const bobAmp = 1 + ship.v / 350
      const bob = (Math.sin(ship.time * 7) * 0.05 + Math.sin(ship.time * 13.7) * 0.02) * bobAmp
      g.position.set(
        s.pose.px + s.pose.nx * bob,
        s.pose.py + s.pose.ny * bob,
        s.pose.pz + s.pose.nz * bob,
      )
      tmpDir.set(-s.pose.tx, -s.pose.ty, -s.pose.tz)
      tmpUp.set(s.pose.nx, s.pose.ny, s.pose.nz)
      tmpMatrix.lookAt(tmpEye, tmpDir, tmpUp)
      g.quaternion.setFromRotationMatrix(tmpMatrix)
      // V18: bank from USER STEER only (B6). +right lean; after the
      // rotateY(π) model flip below, +Z roll renders as LEFT dip, so negate (B5).
      const targetRoll = computeLean(ship.steerSmooth, ship.v)
      s.roll += (targetRoll - s.roll) * Math.min(1, dt * 8)
      // airborne: nose follows vertical velocity
      const targetPitch = ship.airborne ? Math.max(-0.32, Math.min(0.4, -ship.vy * 0.012)) : 0
      s.airPitch += (targetPitch - s.airPitch) * Math.min(1, dt * 6)
      g.rotateY(ship.yaw * 1.0 + Math.PI)
      g.rotateZ(-s.roll)
      g.rotateX(s.airPitch)
    }

    updateCamera(camera, s, cameraMode, fxIntensity, dt)

    // telemetry for HUD
    const songTime = s.song ? s.song.time() : ship.time
    telemetry.speed = ship.v
    telemetry.progress = ship.s / track.length
    telemetry.timeMs = ship.time * 1000
    telemetry.boost = ship.boost
    telemetry.songTime = songTime
    const fi = Math.min(features.energy.length - 1, Math.floor(songTime / features.frameInterval))
    telemetry.energy = features.energy[fi] ?? 0
    telemetry.wallFlash = wallEvent > 0 ? 1 : Math.max(0, telemetry.wallFlash - dt * 3)
    telemetry.boostFlash = boostEvent ? 1 : Math.max(0, telemetry.boostFlash - dt * 3.5)
    telemetry.position = racePosition(ship.s, s.npcs)
    telemetry.racers = s.npcs.length + 1
    telemetry.racersXZ[0] = s.pose.px
    telemetry.racersXZ[1] = s.pose.pz

    // T39: onset beat spikes — sharp 1→0 pulses on detected hits
    let beat = Math.max(0, telemetry.beat - dt * 5)
    while (s.onsetIdx < features.onsets.length && features.onsets[s.onsetIdx] <= songTime) {
      s.onsetIdx++
      beat = 1
    }
    telemetry.beat = beat

    // T39: current section under the player → palette drift
    const segs = track.segments
    while (s.segIdx < segs.length - 1 && ship.s >= segs[s.segIdx].end) s.segIdx++
    telemetry.sectionIndex = segs[s.segIdx]?.sectionIndex ?? 0

    // T21/T39: sky breathes with the music AND drifts toward the section tint
    const palette = track.sectionPalettes[telemetry.sectionIndex]
    if (palette) {
      skyTint.set(palette)
      skyColors.base.lerp(skyTarget.copy(skyColors.themeSky).lerp(skyTint, 0.18), dt * 0.5)
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.color.lerp(fogTarget.copy(skyColors.themeFog).lerp(skyTint, 0.22), dt * 0.5)
      }
    }
    if (scene.background instanceof THREE.Color) {
      scene.background.lerpColors(skyColors.base, skyColors.flash, telemetry.energy * track.theme.pulse)
    }

    if (finishedEvent) {
      s.started = false
      s.song?.stop(1.5)
      finishRace({
        timeMs: ship.time * 1000,
        topSpeed: ship.topSpeed,
        boostsHit: ship.boostsHit,
        wallHits: ship.wallHits,
        songTitle,
        place: racePosition(ship.s - 0.001, s.npcs),
        totalRacers: s.npcs.length + 1,
      })
    }
  })

  return (
    <group>
      <color attach="background" args={[track.theme.sky]} />
      <fog attach="fog" args={[track.theme.fog, 60, 3 / track.theme.fogDensity]} />
      <ambientLight intensity={0.3} color={track.theme.glow} />
      <ShadowRig shipRef={shipGroup} enabled={quality === 'high'} />
      <Track track={track} frames={frames} />
      <Scenery track={track} frames={frames} />
      <GridFloor track={track} />
      <Ridges track={track} frames={frames} />
      <WarpStreaks shipRef={shipGroup} track={track} speed={() => sim.current.ship.v} fxIntensity={fxIntensity} />
      <group ref={shipGroup}>
        <ShipMesh
          accent={track.theme.edge}
          power={() => sim.current.input.thrust * 0.7 + (sim.current.ship.boost > 0 ? 0.9 : 0)}
        />
      </group>
      <ExhaustTrails
        shipRef={shipGroup}
        offsets={[
          [-0.58, -0.04, 1.5],
          [0.58, -0.04, 1.5],
        ]}
        color={track.theme.edge}
        intensity={() =>
          sim.current.input.thrust * 0.6 +
          (sim.current.ship.boost > 0 ? 0.8 : 0) +
          Math.min(0.35, sim.current.ship.v / 700)
        }
      />
      <NpcShips specs={npcSpecs} simRef={sim} frames={frames} />
      <Starfield color={track.theme.glow} count={quality === 'low' ? 400 : 1500} />
    </group>
  )
}

const camTarget = new THREE.Vector3()
const camPos = new THREE.Vector3()
const camUp = new THREE.Vector3()
const camFwd = new THREE.Vector3()

function updateCamera(
  camera: THREE.PerspectiveCamera,
  s: {
    ship: ReturnType<typeof initialShip>
    pose: FramePose
    shake: ShakeState
    roll: number
    pull: number
  },
  mode: 'chase' | 'cockpit',
  fxIntensity: number,
  dt: number,
) {
  const { ship, pose } = s

  if (mode === 'chase') {
    // trail into the corner: camera swings opposite the steer (T36);
    // pulls back under acceleration (T45)
    const swing = -ship.steerSmooth * 2.2
    const back = 8 + s.pull * 2.4
    camPos.set(
      pose.px - pose.tx * back + pose.nx * 2.9 + pose.bx * swing,
      pose.py - pose.ty * back + pose.ny * 2.9 + pose.by * swing,
      pose.pz - pose.tz * back + pose.nz * 2.9 + pose.bz * swing,
    )
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 9))
    // hard tether: cam may lag for feel but never lose the ship at speed (B4)
    const lag = camera.position.distanceTo(camPos)
    if (lag > 3.2) camera.position.lerp(camPos, 1 - 3.2 / lag)
    camTarget.set(pose.px + pose.tx * 12, pose.py + pose.ty * 12, pose.pz + pose.tz * 12)
  } else {
    camPos.set(pose.px + pose.tx * 0.4 + pose.nx * 0.55, pose.py + pose.ty * 0.4 + pose.ny * 0.55, pose.pz + pose.tz * 0.4 + pose.nz * 0.55)
    camera.position.copy(camPos)
    camTarget.set(pose.px + pose.tx * 30, pose.py + pose.ty * 30, pose.pz + pose.tz * 30)
  }

  // screenshake: trauma² noise, fully off at fxIntensity 0 (V10)
  const shakeAmt = s.shake.trauma * s.shake.trauma * fxIntensity
  if (shakeAmt > 0.001) {
    const t = ship.time * 70
    camera.position.x += Math.sin(t * 1.1) * 0.12 * shakeAmt
    camera.position.y += Math.sin(t * 1.7 + 2) * 0.1 * shakeAmt
    camTarget.x += Math.sin(t * 1.3 + 4) * 0.3 * shakeAmt
  }
  // cameras roll with the ship — cockpit fully, chase partially (T16).
  // roll is +right-dip; rotating up around the forward axis by -roll matches
  // the ship's rendered bank.
  camUp.set(pose.nx, pose.ny, pose.nz)
  camFwd.set(pose.tx, pose.ty, pose.tz)
  camUp.applyAxisAngle(camFwd, -s.roll * (mode === 'cockpit' ? 0.9 : 0.4))
  camera.up.copy(camUp)
  camera.lookAt(camTarget)

  // speed FOV: subtle always, boost kick scaled by fx
  const speedNorm = Math.min(1, ship.v / 280)
  const targetFov = 62 + speedNorm * 18 + (ship.boost > 0 ? 6 * fxIntensity : 0) + s.pull * 7
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4)
  camera.updateProjectionMatrix()
}

/** shadow-casting key light that follows the ship (T31, high tier only) */
function ShadowRig({
  shipRef,
  enabled,
}: {
  shipRef: React.RefObject<THREE.Group | null>
  enabled: boolean
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null)
  const targetRef = useRef<THREE.Object3D>(null)

  useFrame(() => {
    const ship = shipRef.current
    const l = lightRef.current
    const t = targetRef.current
    if (!ship || !l || !t) return
    t.position.copy(ship.position)
    t.updateMatrixWorld()
    l.position.set(ship.position.x + 70, ship.position.y + 150, ship.position.z - 50)
    l.target = t
  })

  return (
    <>
      <directionalLight
        ref={lightRef}
        castShadow={enabled}
        intensity={1.7}
        color="#cfe0ff"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
        shadow-camera-near={10}
        shadow-camera-far={500}
        shadow-bias={-0.0004}
      />
      <object3D ref={targetRef} />
    </>
  )
}

function NpcShips({
  specs,
  simRef,
  frames,
}: {
  specs: NpcSpec[]
  simRef: React.RefObject<{ npcs: NpcState[] }>
  frames: TrackFrames
}) {
  const refs = useRef<(THREE.Group | null)[]>([])
  const pose = useRef({} as FramePose)
  // stable per-NPC ref objects so ExhaustTrails can follow each ship (T37)
  const groupRefs = useMemo(
    () => specs.map(() => ({ current: null as THREE.Group | null })),
    [specs],
  )

  useFrame(() => {
    const npcs = simRef.current.npcs
    for (let i = 0; i < specs.length; i++) {
      const g = refs.current[i]
      const st = npcs[i]
      if (!g || !st) continue
      poseAt(frames, Math.max(0, st.s), st.d, HOVER_HEIGHT, pose.current)
      const p = pose.current
      g.position.set(p.px, p.py, p.pz)
      telemetry.racersXZ[(i + 1) * 2] = p.px
      telemetry.racersXZ[(i + 1) * 2 + 1] = p.pz
      tmpDir.set(-p.tx, -p.ty, -p.tz)
      tmpUp.set(p.nx, p.ny, p.nz)
      tmpMatrix.lookAt(tmpEye, tmpDir, tmpUp)
      g.quaternion.setFromRotationMatrix(tmpMatrix)
      // NPCs steer to follow the track — lean derived from their cornering,
      // not computeLean (that's player-input-only per V18)
      const k = curvatureAt(frames, Math.max(0, Math.round(st.s / frames.ds)))
      const npcLean = Math.max(-0.6, Math.min(0.6, k * st.v * 0.35))
      g.rotateY(Math.PI)
      g.rotateZ(-npcLean)
    }
  })

  return (
    <>
      {specs.map((spec, i) => {
        const npcPower = () => {
          const st = simRef.current.npcs[i]
          return st && !st.finished && st.v > 1 ? 0.55 : 0
        }
        return (
          <group key={spec.name}>
            <group
              ref={(g) => {
                refs.current[i] = g
                groupRefs[i].current = g
              }}
            >
              <ShipMesh accent={spec.accent} power={npcPower} variant={(i % 3) as 0 | 1 | 2} />
            </group>
            {/* T37: every racer trails its own colors */}
            <ExhaustTrails
              shipRef={groupRefs[i]}
              offsets={[
                [-0.58, -0.04, 1.5],
                [0.58, -0.04, 1.5],
              ]}
              color={spec.accent}
              intensity={npcPower}
            />
          </group>
        )
      })}
    </>
  )
}

function Starfield({ color, count = 1500 }: { color: string; count?: number }) {
  const geo = useMemo(() => {
    const n = count
    const pos = new Float32Array(n * 3)
    // deterministic spiral scatter — not gameplay, but keep V8 hygiene anyway
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996
      const r = 800 + (i % 700)
      pos[i * 3] = Math.cos(a) * r
      pos[i * 3 + 1] = ((i * 37) % 900) - 200
      pos[i * 3 + 2] = Math.sin(a) * r
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return g
  }, [count])
  return (
    <points geometry={geo}>
      <pointsMaterial color={color} size={2.2} sizeAttenuation={false} transparent opacity={0.7} />
    </points>
  )
}
