import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { useGame } from '../game/store'
import { telemetry } from '../game/telemetry'
import { attachKeyboard, onGameKey, readShipInput, resetInput } from '../game/input'
import {
  computeLean,
  initialShip,
  shipVmax,
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
import { beep, goChord } from '../lib/audio/sfx'
import { createGhostRecorder, serializeGhost } from '../lib/network/ghost'
import { saveBestGhost, saveRun } from '../lib/records'
import { network, type NetworkMessage, type OpponentState } from '../lib/network/p2p'
import { Track } from './Track'
import { Scenery } from './Scenery'
import { Aurora, GridFloor, Ridges, SceneEnvironment, WarpStreaks, WaveformHorizon } from './Environment'
import { ShipMesh } from './ShipMesh'
import { ExhaustTrails } from './Exhaust'
import { Sparks, type SparkSource } from './Sparks'
import { SponsorBoards } from './SponsorBoards'
import { NetworkShip } from './NetworkShip'
import type { TrackData } from '../lib/track/generate'
import { pickShipAccent } from '../lib/accent'
import { haptics } from '../lib/haptics'

function getOpponentColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255

  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0, l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break
      case g: h = (b - r) / d + 2; break
      case b: h = (r - g) / d + 4; break
    }
    h /= 6
  }

  h = (h + 0.5) % 1
  l = Math.max(0.6, l) 

  let r2, g2, b2
  if (s === 0) {
    r2 = g2 = b2 = l
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1/6) return p + (q - p) * 6 * t
      if (t < 1/2) return q
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r2 = hue2rgb(p, q, h + 1/3)
    g2 = hue2rgb(p, q, h)
    b2 = hue2rgb(p, q, h - 1/3)
  }

  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`
}

const tmpMatrix = new THREE.Matrix4()
const tmpEye = new THREE.Vector3(0, 0, 0)
const tmpDir = new THREE.Vector3()
const tmpUp = new THREE.Vector3()
const skyTint = new THREE.Color()
const oppPose = {} as FramePose
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
  const songId = useGame((s) => s.songId)
  const cameraMode = useGame((s) => s.cameraMode)
  const fxIntensity = useGame((s) => s.settings.fxIntensity)
  const toggleCamera = useGame((s) => s.toggleCamera)
  const finishRace = useGame((s) => s.finishRace)
  const isMultiplayer = useGame((s) => s.isMultiplayer)
  const isHost = useGame((s) => s.isHost)
  const ghostPlayback = useGame((s) => s.ghostPlayback)
  const setGhostData = useGame((s) => s.setGhostData)

  const frames = useMemo(
    () => sampleTrack(track, quality === 'low' ? 6 : quality === 'medium' ? 4 : 3),
    [track, quality],
  )
  // T116: player wears a contrast color, never the world's own
  const playerAccent = useMemo(() => pickShipAccent(track.theme.edge, track.theme.glow), [track.theme])
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
  const burstRef = useRef<THREE.Mesh>(null)
  /** T162: scene-wide brightness breathes with the song */
  const ambientRef = useRef<THREE.AmbientLight>(null)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera

  const npcSpecs = useMemo(() => makeNpcs(track), [track])
  const gl = useThree((s) => s.gl) as unknown as THREE.WebGPURenderer

  // T173: warm EVERY render pipeline while the countdown holds the grid —
  // lazy first-use compiles (explosion fireball, sparks, heat paths) were
  // the mid-race "drops to 30fps for a moment" hitches
  useEffect(() => {
    type Compilable = { compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera) => Promise<unknown> }
    void (gl as Compilable).compileAsync?.(scene, camera)?.catch(() => {})
  }, [gl, scene, camera])


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
    /** drop-event pointer — fires telemetry.dropPulse (world spectacle) */
    dropIdx: 0,
    /** T45: smoothed longitudinal accel → camera pull/fov surge */
    vPrev: 0,
    pull: 0,
    /** T52: per-racer collision impulse cooldowns, [0]=player */
    cooldowns: new Float32Array(6),
    /** T173: reused racers list — `[ship, ...npcs]` was a fresh array per 120Hz step */
    racers: [] as Parameters<typeof resolveCollisions>[0],
    /** T63: slow-filtered steer for camera pivots */
    camSteer: 0,
    /** T72: boost shockwave ring timer */
    burstT: 9,
    ghostRecorder: null as ReturnType<typeof createGhostRecorder> | null,
    opponent: null as OpponentState | null,
    ghostReplayPos: { s: 0, d: 0, v: 0, yaw: 0 },
    lastNetSend: 0,
    syncState: 'running' as 'waiting' | 'syncing' | 'running',
    syncStartTime: 0,
    /** T88: epoch ms when both sides agreed to launch; 0 = not yet */
    raceStartAt: 0,
    /** V30: first lobby_ready seen — bounds the wait for an RTT sample */
    firstReadyAt: 0,
    readySent: false,
    lastCountInt: 9,
    /** R9e: one-shot landing impact pulse — Sparks consumes + clears */
    landPulse: 0,
    /** T153: one-shot wall impact pulse — ember burst */
    wallPulse: 0,
    /** one-shot hull-explosion pulse — fireball + debris (Sparks consumes) */
    explodePulse: 0,
    /** T167: sonic boom armed when below 85% vmax, fires crossing 93% */
    sonicArmed: true,
    /** wall-grind haptic tick cadence */
    grindT: 0,
  })

  // T173: stable spark-source — the old inline `source={() => ({...})}`
  // built a fresh object + 3 closures EVERY frame; this mutates one object
  const sparkSource = useMemo(() => {
    const st: SparkSource = {
      onWall: false,
      braking: false,
      airborne: false,
      v: 0,
      d: 0,
      landPulse: 0,
      clearLand: () => void (sim.current.landPulse = 0),
      wallPulse: 0,
      clearWall: () => void (sim.current.wallPulse = 0),
      explodePulse: 0,
      clearExplode: () => void (sim.current.explodePulse = 0),
    }
    return () => {
      const s = sim.current
      st.onWall = s.ship.onWall
      st.braking = s.input.brakeLeft || s.input.brakeRight
      st.airborne = s.ship.airborne
      st.v = s.ship.v
      st.d = s.ship.d
      st.landPulse = s.landPulse
      st.wallPulse = s.wallPulse
      st.explodePulse = s.explodePulse
      return st
    }
  }, [])

  // T173: same treatment for the ghost feed (was a spread per frame)
  const ghostSource = useMemo(() => {
    const o = { s: 0, d: 0, v: 0, yaw: 0, finished: false }
    return () => {
      const g = sim.current.ghostReplayPos
      o.s = g.s
      o.d = g.d
      o.v = g.v
      o.yaw = g.yaw
      o.finished = sim.current.ship.finished
      return o
    }
  }, [])

  // input + camera toggle + song lifecycle
  useEffect(() => {
    resetInput()
    const detachKb = attachKeyboard()
    const detachKeys = onGameKey((e) => {
      if (e === 'camera') toggleCamera()
    })
    const s = sim.current
    // B24: stale countdown from a previous race flashes GO before the sim
    // writes — reset to READY territory on mount
    telemetry.countdown = 9
    s.npcs = isMultiplayer || ghostPlayback ? [] : npcSpecs.map((_, i) => initialNpc(i))

    if (isMultiplayer) {
      s.syncState = 'waiting'
      telemetry.syncState = 'waiting'
      s.ship.d = isHost ? -5 : 5
      s.opponent = { s: 0, d: isHost ? 5 : -5, v: 0, yaw: 0, finished: false }
    } else {
      s.syncState = 'running'
      telemetry.syncState = 'ready'
    }

    // T35: song starts at GO, not on mount — see countdown in the frame loop
    s.started = true

    // T183: recorder also runs DURING ghost races — beat your ghost and the
    // record updates. B39: stable songId, never the display title.
    if (!isMultiplayer) {
      s.ghostRecorder = createGhostRecorder(songId ?? songTitle)
    }
    
    let handleMsg: ((msg: NetworkMessage) => void) | null = null

    if (isMultiplayer) {
      handleMsg = (msg: NetworkMessage) => {
        if (msg.type === 'state_update') {
          sim.current.opponent = msg.state
        } else if (msg.type === 'status') {
          telemetry.oppStatus = msg.text
        } else if (msg.type === 'lobby_ready') {
          // T88: host arbitrates the start once the joiner's scene is live.
          // V30: launch delay carries the measured rtt/2 — the old fixed
          // 400ms guess started the joiner visibly early on fast links.
          if (isHost && sim.current.raceStartAt === 0) {
            if (sim.current.firstReadyAt === 0) sim.current.firstReadyAt = Date.now()
            // wait (max 2s) for one ping roundtrip — lobby_ready repeats at
            // 300ms, so this just defers arbitration one beat
            if (!Number.isFinite(network.rtt) && Date.now() - sim.current.firstReadyAt < 2000) {
              network.send({ type: 'ping', t: Date.now() })
            } else {
              const half = Number.isFinite(network.rtt) ? Math.min(600, network.rtt / 2) : 400
              sim.current.raceStartAt = Date.now() + 1500
              network.send({ type: 'race_start', startTime: 1500 - half })
            }
          }
        } else if (msg.type === 'race_start') {
          if (!isHost && sim.current.raceStartAt === 0) {
            sim.current.raceStartAt = Date.now() + (msg.startTime > 0 ? msg.startTime : 1100)
          }
        } else if (msg.type === 'race_finish') {
          useGame.getState().setOpponentFinish(msg.timeMs)
        }
      }
      network.onMessage = handleMsg
    }

    // B20: heartbeat must survive occluded tabs — useFrame stops when the
    // tab is backgrounded (e.g. joiner still decoding the song), which
    // deadlocked both sides at WAITING. setInterval keeps firing (~1Hz min).
    let hb: ReturnType<typeof setInterval> | null = null
    if (isMultiplayer) {
      hb = setInterval(() => {
        const ship = sim.current.ship
        network.send({
          type: 'state_update',
          state: { s: ship.s, d: ship.d, v: ship.v, yaw: ship.yaw, finished: ship.finished },
        })
        // T88: announce scene-ready until launch is agreed; V30: hosts probe
        // RTT alongside so the race_start delay can compensate for latency
        if (sim.current.raceStartAt === 0) {
          network.send({ type: 'lobby_ready' })
          if (isHost) network.send({ type: 'ping', t: Date.now() })
        }
      }, 300)
    }

    return () => {
      detachKb()
      detachKeys()
      if (hb) clearInterval(hb)
      s.song?.stop()
      s.song = null
      if (isMultiplayer && handleMsg && network.onMessage === handleMsg) {
        network.onMessage = () => {}
      }
    }
  }, [songBuffer, toggleCamera, isMultiplayer, ghostPlayback])

  // B34: pose writers run at default priority 0; trails/sparks read at 0.5
  useFrame((_, rawDt) => {
    // B29: occluded tab suspends rAF — the next frame arrives with a giant
    // dt that would skip the countdown and fast-forward the sim in one burst
    const dt = Math.min(rawDt, 0.1)
    const s = sim.current
    if (!s.started || paused) return

    let isWaiting = false
    if (isMultiplayer) {
      // T88: locked until the agreed launch moment
      isWaiting = s.raceStartAt === 0 || Date.now() < s.raceStartAt
      telemetry.syncState = isWaiting ? 'waiting' : 'ready'
    }

    // T35 countdown: hold the grid, fire the song at GO
    if (!isWaiting && s.countdown > -1) {
      const prev = s.countdown
      s.countdown -= dt
      telemetry.countdown = s.countdown
      // T89: digit beeps + GO chord
      const ci = Math.ceil(s.countdown)
      if (ci !== s.lastCountInt && ci > 0 && ci <= 3) {
        s.lastCountInt = ci
        beep(550, 0.14, 0.22)
        if (fxIntensity > 0) haptics.countTick()
      }
      if (prev > 0 && s.countdown <= 0) {
        goChord()
        if (fxIntensity > 0) haptics.go()
        if (songBuffer && !s.song) s.song = playSong(songBuffer)
      }
    }
    // T113/T119: the MUSIC is the engine — idles at half volume, swells with
    // throttle, and hits FULL by ~250 kph under power (⊥ vmax-relative
    // starvation; vmax is rarely touched)
    if (s.song) {
      const vNorm = Math.min(1, s.ship.v / 70) // 70 m/s ≈ 252 kph
      s.song.setIntensity(s.input.thrust * 0.55 + vNorm * 0.45 + (s.ship.boost > 0 ? 0.15 : 0))
    }

    readShipInput(s.input)
    const steps = (isWaiting || s.countdown > 0) ? 0 : accumulateSteps(s.accumulator, dt)
    let wallEvent = 0
    let boostEvent = false
    let finishedEvent = false
    let landEvent = 0
    let explodedEvent = false
    // T173: refill the persistent racers array in place (no per-step alloc);
    // membership can't change mid-frame
    const racers = s.racers
    racers.length = s.npcs.length + 1
    racers[0] = s.ship
    for (let ni = 0; ni < s.npcs.length; ni++) racers[ni + 1] = s.npcs[ni]
    for (let i = 0; i < steps; i++) {
      stepShip(s.ship, s.input, track, frames, s.events)
      if (s.events.exploded) explodedEvent = true
      // V29: NPCs see the player's arc position — mid/back field rubber-bands
      for (let ni = 0; ni < s.npcs.length; ni++) stepNpc(s.npcs[ni], npcSpecs[ni], track, frames, s.ship.s)
      // T32/T52: bump resolution — impulse once per contact, cooldown-gated
      for (let ci = 0; ci < s.cooldowns.length; ci++) {
        s.cooldowns[ci] = Math.max(0, s.cooldowns[ci] - PHYSICS_DT)
      }
      // hull damage from racer contact happens INSIDE resolveCollisions now —
      // scaled by closing speed, both parties, fatal at ramming speed
      const bump = resolveCollisions(racers, track, s.cooldowns)
      if (bump > 0) wallEvent = Math.max(wallEvent, bump * 0.6)
      // T79: wreck-level slam → shockwave ring + max trauma
      if (bump >= 35 && burstRef.current && shipGroup.current) {
        s.burstT = 0
        burstRef.current.position.copy(shipGroup.current.position)
        burstRef.current.quaternion.copy(shipGroup.current.quaternion)
        s.shake.trauma = 1
      }
      if (s.events.wallHit) wallEvent = Math.max(wallEvent, s.events.wallImpact)
      if (s.events.boostFired) boostEvent = true
      if (s.events.landed) landEvent = Math.max(landEvent, s.events.landImpact)
      if (s.events.respawned) wallEvent = Math.max(wallEvent, 30)
      if (s.events.finished) finishedEvent = true
    }

    // shake trauma (V10: scaled by fxIntensity at application time)
    if (wallEvent > 0) s.shake.trauma = Math.min(1, s.shake.trauma + 0.25 + wallEvent * 0.02)
    if (boostEvent) s.shake.trauma = Math.min(1, s.shake.trauma + 0.18)
    // T167: SONIC BOOM — punching through 93% of vmax pops a shockwave,
    // flash, boom + buzz; re-arms once you fall back under 85%
    // B33: threshold vs UNBOOSTED vmax fired a boom on every pad — blip spam.
    // Boom marks touching the ABSOLUTE ceiling (boosted vmax).
    const vmaxNow = shipVmax(track.avgSpeed, true)
    if (!s.sonicArmed && s.ship.v < vmaxNow * 0.78) s.sonicArmed = true
    if (s.sonicArmed && s.ship.v >= vmaxNow * 0.87) { // T170: top of a real chain
      s.sonicArmed = false
      if (burstRef.current && shipGroup.current) {
        s.burstT = 0
        burstRef.current.position.copy(shipGroup.current.position)
        burstRef.current.quaternion.copy(shipGroup.current.quaternion)
      }
      telemetry.boostFlash = Math.max(telemetry.boostFlash, 0.9)
      s.shake.trauma = Math.min(1, s.shake.trauma + 0.3)
      // T169: boom is VISUAL — shockwave + flash + shake + buzz, no sfx
      if (fxIntensity > 0) haptics.boost()
    }

    // hull explosion: full wreck treatment — shockwave ring, max trauma,
    // a thick ember burst (T153 channel, cranked), buzz. The ship halts in
    // the wreck pause (ship.wrecked) so all of this is actually WATCHABLE.
    if (explodedEvent) {
      wallEvent = Math.max(wallEvent, 40)
      if (burstRef.current && shipGroup.current) {
        s.burstT = 0
        burstRef.current.position.copy(shipGroup.current.position)
        burstRef.current.quaternion.copy(shipGroup.current.quaternion)
      }
      s.explodePulse = 1
      s.shake.trauma = 1
      telemetry.hullFlash = 1
      // full-screen accent flash — the boom reads even at the screen edge
      telemetry.boostFlash = Math.max(telemetry.boostFlash, 1)
    }
    // T152: haptics on touch devices — fx-gated like every feedback channel
    if (fxIntensity > 0) {
      if (wallEvent >= 35) haptics.wreck()
      else if (wallEvent > 0) haptics.wall(wallEvent)
      else if (boostEvent) haptics.boost()
      else if (landEvent > 3) haptics.land(landEvent)
      // sustained grind = ticking rumble, not one buzz then silence
      if (s.ship.onWall && s.ship.v > 30) {
        s.grindT -= dt
        if (s.grindT <= 0) {
          haptics.grind()
          s.grindT = 0.15
        }
      } else {
        s.grindT = 0
      }
    }
    // T153: ember burst feed
    if (wallEvent > 0) s.wallPulse = wallEvent
    if (landEvent > 0) {
      s.shake.trauma = Math.min(1, s.shake.trauma + Math.min(0.45, landEvent * 0.012))
      s.landPulse = landEvent // R9e: dust burst
    }
    s.shake.trauma = Math.max(0, s.shake.trauma - dt * 1.6)

    // T45: accel feel — camera pulls back under thrust, snaps in on scrub
    const ship = s.ship
    if (steps > 0) {
      const accel = (ship.v - s.vPrev) / (steps * PHYSICS_DT)
      s.vPrev = ship.v
      const target = Math.max(-0.6, Math.min(1.2, accel * 0.022))
      s.pull += (target - s.pull) * Math.min(1, dt * 4)
    }
    // T63: camera pivots only on strong/slow steering — cubic response kills
    // taps, speed scale calms it at pace, slow filter smooths the rest
    const sIn = ship.steerSmooth
    const speedCalm = 0.45 + 0.55 * (1 - Math.min(1, ship.v / 220))
    // T143: slower filter — micro-corrections never reach the camera
    s.camSteer += (sIn * sIn * sIn * speedCalm - s.camSteer) * Math.min(1, dt * 1.5)

    // ship world transform — air height rides on top of hover (V16)
    poseAt(frames, ship.s, ship.d, HOVER_HEIGHT + ship.air, s.pose)
    const g = shipGroup.current
    if (g) {
      // T109: first person = no hull in the way; wrecked = hull is GONE
      g.visible = cameraMode !== 'cockpit' && ship.wrecked <= 0
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
      // T143: roll low-passed harder — leans into real corners, ignores twitches
      s.roll += (targetRoll - s.roll) * Math.min(1, dt * 5)
      // airborne: nose follows vertical velocity
      const targetPitch = ship.airborne ? Math.max(-0.32, Math.min(0.4, -ship.vy * 0.012)) : 0
      s.airPitch += (targetPitch - s.airPitch) * Math.min(1, dt * 6)
      // T51/T56: nose-in carve — yaw NEGATED after the π model flip (B15)
      g.rotateY(Math.PI - ship.yaw * 1.2)
      g.rotateZ(-s.roll)
      g.rotateX(s.airPitch)
      // T72: fire the shockwave ring where the pad was caught
      if (boostEvent && burstRef.current) {
        s.burstT = 0
        burstRef.current.position.copy(g.position)
        burstRef.current.quaternion.copy(g.quaternion)
      }
    }

    if (s.ghostRecorder) s.ghostRecorder.record(ship)
    if (isMultiplayer && Date.now() >= s.lastNetSend + 100) {
      s.lastNetSend = Date.now()
      network.send({ type: 'state_update', state: { s: ship.s, d: ship.d, v: ship.v, yaw: ship.yaw, finished: ship.finished } })
    }

    if (ghostPlayback) {
      const framesData = ghostPlayback.frames
      const targetTime = ship.time
      const idx = Math.floor(targetTime * 10) * 4
      if (idx >= 0 && idx < framesData.length - 4) {
        // Interpolate
        const frac = (targetTime * 10) % 1
        s.ghostReplayPos.s = framesData[idx] + (framesData[idx+4] - framesData[idx]) * frac
        s.ghostReplayPos.d = framesData[idx+1] + (framesData[idx+5] - framesData[idx+1]) * frac
        s.ghostReplayPos.v = framesData[idx+2] + (framesData[idx+6] - framesData[idx+2]) * frac
        s.ghostReplayPos.yaw = framesData[idx+3] + (framesData[idx+7] - framesData[idx+3]) * frac
      }
    }

    updateCamera(camera, s, cameraMode, fxIntensity, dt)

    // telemetry for HUD
    const songTime = s.song ? s.song.time() : ship.time
    // T72: expanding shockwave ring
    const bm = burstRef.current
    if (bm) {
      s.burstT = Math.min(2, s.burstT + dt * 2.2)
      const bt = s.burstT
      bm.visible = bt < 1
      if (bt < 1) {
        bm.scale.setScalar(1 + bt * 18)
        ;(bm.material as THREE.MeshBasicMaterial).opacity = (1 - bt) * 0.7 * fxIntensity
      }
    }

    telemetry.speed = ship.v
    telemetry.progress = ship.s / track.length
    telemetry.timeMs = ship.time * 1000
    telemetry.boost = ship.boost
    telemetry.hull = ship.energy
    telemetry.thrust = s.input.thrust + (ship.boost > 0 ? 0.35 : 0)
    if (wallEvent > 0) telemetry.hullFlash = 1
    else telemetry.hullFlash = Math.max(0, telemetry.hullFlash - dt * 2.5)
    telemetry.songTime = songTime
    const fi = Math.min(features.energy.length - 1, Math.floor(songTime / features.frameInterval))
    telemetry.energy = features.energy[fi] ?? 0
    telemetry.centroid = features.centroid[fi] ?? 0
    telemetry.wallFlash = wallEvent > 0 ? 1 : Math.max(0, telemetry.wallFlash - dt * 3)
    telemetry.boostFlash = boostEvent ? 1 : Math.max(0, telemetry.boostFlash - dt * 3.5)
    // B19: MP position plumbing — rank against the live opponent, not npcs
    if (isMultiplayer && s.opponent) {
      telemetry.position = s.opponent.s > ship.s ? 2 : 1
      telemetry.racers = 2
    } else if (ghostPlayback) {
      telemetry.position = s.ghostReplayPos.s > ship.s ? 2 : 1
      telemetry.racers = 2
    } else {
      telemetry.position = racePosition(ship.s, s.npcs)
      telemetry.racers = s.npcs.length + 1
    }
    telemetry.racersXZ[0] = s.pose.px
    telemetry.racersXZ[1] = s.pose.py
    telemetry.racersXZ[2] = s.pose.pz
    if ((isMultiplayer && s.opponent) || ghostPlayback) {
      const o = isMultiplayer ? s.opponent! : s.ghostReplayPos
      poseAt(frames, o.s, o.d, HOVER_HEIGHT, oppPose)
      telemetry.racersXZ[3] = oppPose.px
      telemetry.racersXZ[4] = oppPose.py
      telemetry.racersXZ[5] = oppPose.pz
    }

    // T39: onset beat spikes — sharp 1→0 pulses on detected hits
    let beat = Math.max(0, telemetry.beat - dt * 5)
    while (s.onsetIdx < features.onsets.length && features.onsets[s.onsetIdx] <= songTime) {
      s.onsetIdx++
      beat = 1
    }
    telemetry.beat = beat
    // low-end proxy: loud + dark spectrum = bass pressure (floor swell)
    const bassRaw = telemetry.energy * (1 - telemetry.centroid)
    telemetry.bass += (bassRaw - telemetry.bass) * Math.min(1, dt * 6)
    // drop events → world-scale pulse (fog blows open, nebulae bloom, …)
    telemetry.dropPulse = Math.max(0, telemetry.dropPulse - dt * 0.6)
    const evts = features.events
    while (s.dropIdx < evts.length && evts[s.dropIdx].start <= songTime) {
      if (evts[s.dropIdx].type === 'drop') telemetry.dropPulse = 1
      s.dropIdx++
    }
    // fog BREATHING: quiet sections close the room in, drops blow it open.
    // Max stays at the culling cutoff (3/fogDensity) so hidden ≡ culled.
    if (scene.fog instanceof THREE.Fog) {
      const baseFar = 3 / track.theme.fogDensity
      const secEFog = track.sectionEnergies[telemetry.sectionIndex] ?? 0.5
      const farTarget = baseFar * Math.min(1, 0.55 + secEFog * 0.35 + telemetry.dropPulse * 0.35)
      scene.fog.far += (farTarget - scene.fog.far) * Math.min(1, dt * 0.8)
    }

    // T39: current section under the player → palette drift
    const segs = track.segments
    while (s.segIdx < segs.length - 1 && ship.s >= segs[s.segIdx].end) s.segIdx++
    telemetry.sectionIndex = segs[s.segIdx]?.sectionIndex ?? 0

    // T162: the WHOLE scene breathes — ambient + env reflections ride the
    // section energy and the live energy², so quiet passages genuinely dim
    const secEnergy = track.sectionEnergies[telemetry.sectionIndex] ?? 0.5
    const eSq = telemetry.energy * telemetry.energy
    // T166: quiet passages get ACTUALLY dark — but the GRID stays lit until
    // GO (song silent pre-launch → floors would black out the start)
    const preGo = telemetry.countdown > -1 ? Math.min(1, Math.max(0, telemetry.countdown + 1)) : 0
    if (ambientRef.current) {
      ambientRef.current.intensity = Math.max(preGo * 0.32, 0.04 + secEnergy * 0.24 + eSq * 0.55 * track.theme.pulse)
    }
    scene.environmentIntensity = Math.max(preGo * 0.4, 0.1 + secEnergy * 0.32 + eSq * 0.42)

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

    // T70: song over → race over, rank by distance
    const songDone = s.countdown <= 0 && ship.time > track.duration + 2 && !ship.finished
    if (finishedEvent || songDone) {
      s.started = false
      s.song?.stop(1.5)

      const timeMs = ship.time * 1000
      const place =
        isMultiplayer && s.opponent
          ? s.opponent.s > ship.s && !ship.finished
            ? 2
            : s.opponent.finished && ship.finished
              ? 2
              : 1
          : racePosition(ship.s - 0.001, s.npcs)

      if (s.ghostRecorder) {
        const ghost = s.ghostRecorder.finish()
        ghost.songTitle = songTitle
        ghost.timeMs = timeMs
        setGhostData(ghost)
        // T183/V28: FINISHED runs land on the local leaderboard; the fastest
        // one keeps its ghost. DNFs (song ran out) record nothing.
        if (finishedEvent) {
          const { newBest } = saveRun(songId ?? songTitle, track.seed, songTitle, {
            timeMs,
            topSpeed: ship.topSpeed,
            place,
            date: Date.now(),
          })
          if (newBest) {
            void serializeGhost(ghost)
              .then((str) => saveBestGhost(songId ?? songTitle, track.seed, timeMs, str))
              .catch(() => {})
          }
        }
      }
      if (isMultiplayer) {
        network.send({ type: 'race_finish', timeMs })
      }

      finishRace({
        timeMs,
        topSpeed: ship.topSpeed,
        boostsHit: ship.boostsHit,
        wallHits: ship.wallHits,
        songTitle,
        place,
        totalRacers: isMultiplayer ? 2 : (ghostPlayback ? 2 : s.npcs.length + 1),
      })
    }
  })

  return (
    <group>
      <color attach="background" args={[track.theme.sky]} />
      <fog attach="fog" args={[track.theme.fog, 60, 3 / track.theme.fogDensity]} />
      <ambientLight ref={ambientRef} intensity={0.3} color={track.theme.glow} />
      {/* R9d: env reflections on hulls — skip on low tier (C7) */}
      {quality !== 'low' && <SceneEnvironment track={track} />}
      <ShadowRig shipRef={shipGroup} enabled={quality === 'high'} />
      <Track track={track} frames={frames} />
      {/* T122: floating sponsor displays around the start straight */}
      <SponsorBoards track={track} frames={frames} />
      <Scenery track={track} frames={frames} />
      <GridFloor track={track} frames={frames} />
      <Ridges track={track} frames={frames} />
      {/* T124: the skyline is the song */}
      <WaveformHorizon
        track={track}
        energyCurve={features.energy}
        frameInterval={features.frameInterval}
        bars={quality === 'low' ? 48 : 96}
      />
      {/* aurora curtain: section color + energy, surges on drops */}
      {quality !== 'low' && <Aurora track={track} />}
      {/* T111: subtle warp streaks at the top end */}
      <WarpStreaks shipRef={shipGroup} track={track} speed={() => sim.current.ship.v} fxIntensity={fxIntensity} />
      <group ref={shipGroup}>
        <ShipMesh
          accent={isMultiplayer && !isHost ? getOpponentColor(playerAccent) : playerAccent}
          power={() =>
            sim.current.ship.wrecked > 0
              ? 0
              : sim.current.input.thrust * 0.3 +
                Math.min(1, sim.current.ship.v / shipVmax(track.avgSpeed, false)) * 0.65 +
                (sim.current.ship.boost > 0 ? 0.35 : 0)
          }
        />
      </group>
      <mesh ref={burstRef} visible={false}>
        <torusGeometry args={[1.4, 0.1, 8, 36]} />
        <meshBasicMaterial
          color={track.theme.glow}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <ExhaustTrails
        shipRef={shipGroup}
        offsets={[
          [-0.3, 0.22, 1.62],
          [0.3, 0.22, 1.62],
        ]}
        color={isMultiplayer && !isHost ? getOpponentColor(playerAccent) : playerAccent}
        // continuous accel read: glow tracks SPEED, not the 3-state throttle —
        // the plume visibly builds the entire 0→vmax climb
        intensity={() =>
          sim.current.ship.wrecked > 0
            ? 0
            : sim.current.input.thrust * 0.3 +
              Math.min(1, sim.current.ship.v / shipVmax(track.avgSpeed, false)) * 0.65 +
              (sim.current.ship.boost > 0 ? 0.35 : 0)
        }
        speed={() => sim.current.ship.v}
        // T173: ribbon resolution per tier — CPU per-point work scales linearly
        points={quality === 'high' ? 48 : quality === 'medium' ? 36 : 28}
      />
      {/* R9e: grind/airbrake sparks + landing dust */}
      <Sparks shipRef={shipGroup} accent={track.theme.glow} fxIntensity={fxIntensity} source={sparkSource} />
      {!(isMultiplayer || !!ghostPlayback) && (
        <NpcShips
          specs={npcSpecs}
          simRef={sim}
          frames={frames}
          avgSpeed={track.avgSpeed}
          fogFar={3 / track.theme.fogDensity}
          trailPoints={quality === 'high' ? 30 : 18}
        />
      )}
      {/* B19: mounted unconditionally — reads live state per frame */}
      {isMultiplayer && (
        <NetworkShip
          source={() => sim.current.opponent}
          frames={frames}
          accent={isHost ? getOpponentColor(playerAccent) : playerAccent}
        />
      )}
      {ghostPlayback && (
        <NetworkShip source={ghostSource} frames={frames} accent="#2ff3ff" isGhost />
      )}
      <Starfield color={track.theme.glow} count={quality === 'low' ? 400 : 1500} />
    </group>
  )
}

const camTarget = new THREE.Vector3()
const camPos = new THREE.Vector3()
const camUp = new THREE.Vector3()
const camFwd = new THREE.Vector3()
/** smoothed look-at OFFSET (ship-relative) — raw target jumped with every
 * tangent/steer change and yanked the view. NOTE: must smooth the offset,
 * not the absolute point — absolute smoothing lags by v/rate (≈40m @ 280m/s)
 * which put the target BEHIND the camera: view flipped backwards + thrashed */
const camLookOff = new THREE.Vector3()
const camLookPoint = new THREE.Vector3()
let camLookPrimed = false

function updateCamera(
  camera: THREE.PerspectiveCamera,
  s: {
    ship: ReturnType<typeof initialShip>
    pose: FramePose
    shake: ShakeState
    roll: number
    pull: number
    camSteer: number
    countdown: number
  },
  mode: 'chase' | 'cockpit',
  fxIntensity: number,
  dt: number,
) {
  const { ship, pose } = s
  const speedNorm = Math.min(1, ship.v / 430)

  if (mode === 'chase') {
    // intro dolly: READY holds a wide shot from behind/above the player so
    // the whole grid ahead is in frame, then the camera glides down into the
    // racing position as the digits run — locked in by GO
    const introRaw = Math.min(1, Math.max(0, (s.countdown - 0.4) / 2.6))
    const intro = introRaw * introRaw * (3 - 2 * introRaw)
    // trail into the corner: camera swings opposite the steer (T36/T63);
    // pulls back under acceleration (T45). At speed the cam creeps slightly
    // CLOSER to offset the FOV stretch — the ship stops receding into the
    // distance at the top end.
    const swing = -s.camSteer * 2.4 * (1 - intro)
    const back = 8 + s.pull * 2.0 - speedNorm * 1.1 + intro * 17
    const lift = 2.9 + intro * 5.5
    camPos.set(
      pose.px - pose.tx * back + pose.nx * lift + pose.bx * swing,
      pose.py - pose.ty * back + pose.ny * lift + pose.by * swing,
      pose.pz - pose.tz * back + pose.nz * lift + pose.bz * swing,
    )
    // gentler chase (9 → 6) + looser tether (3.2 → 4.4): direction changes
    // sway instead of yank
    camera.position.lerp(camPos, 1 - Math.exp(-dt * 6))
    // hard tether: cam may lag for feel but never lose the ship at speed (B4)
    const lag = camera.position.distanceTo(camPos)
    if (lag > 4.4) camera.position.lerp(camPos, 1 - 4.4 / lag)
    // T51/T63: look INTO the corner — damped, not twitchy. During the intro
    // the camera looks over the FIELD ahead instead of the near road.
    const lookIn = s.camSteer * 6 * (1 - intro)
    const lookAhead = 12 + intro * 38
    camTarget.set(
      pose.px + pose.tx * lookAhead + pose.bx * lookIn,
      pose.py + pose.ty * lookAhead + pose.by * lookIn,
      pose.pz + pose.tz * lookAhead + pose.bz * lookIn,
    )
  } else {
    // T69 → T109: cockpit cam sits AT the canopy front, ahead of the hull
    // (the hull itself is hidden in cockpit mode — see ship visible toggle).
    // Lifted 0.55 → 0.85: eye level, not chin-on-asphalt.
    camPos.set(pose.px + pose.tx * 1.1 + pose.nx * 0.85, pose.py + pose.ty * 1.1 + pose.ny * 0.85, pose.pz + pose.tz * 1.1 + pose.nz * 0.85)
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
  camUp.applyAxisAngle(camFwd, -s.roll * (mode === 'cockpit' ? 0.9 : 0.55))
  camera.up.copy(camUp)
  // look target low-passed in SHIP-RELATIVE space — rotation eases through
  // direction changes while the point itself rides along with the ship
  camLookPoint.set(camTarget.x - pose.px, camTarget.y - pose.py, camTarget.z - pose.pz)
  if (!camLookPrimed || mode === 'cockpit') {
    camLookOff.copy(camLookPoint)
    camLookPrimed = true
  } else {
    camLookOff.lerp(camLookPoint, 1 - Math.exp(-dt * 7))
  }
  camLookPoint.set(pose.px + camLookOff.x, pose.py + camLookOff.y, pose.pz + camLookOff.z)
  camera.lookAt(camLookPoint)

  // speed FOV: subtle always, boost kick scaled by fx — gain trimmed (31→23,
  // pull 7→5): the old stretch shoved the ship too far up the screen at pace
  const targetFov = 62 + speedNorm * 23 + (ship.boost > 0 ? 9 * fxIntensity : 0) + s.pull * 5
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
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
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
  avgSpeed,
  fogFar,
  trailPoints = 30,
}: {
  specs: NpcSpec[]
  simRef: React.RefObject<{ npcs: NpcState[] }>
  frames: TrackFrames
  avgSpeed: number
  /** beyond this distance the fog has fully eaten the ship — skip the draw */
  fogFar: number
  /** T173: exhaust ribbon resolution per quality tier */
  trailPoints?: number
}) {
  const refs = useRef<(THREE.Group | null)[]>([])
  const pose = useRef({} as FramePose)
  // stable per-NPC ref objects so ExhaustTrails can follow each ship (T37)
  const groupRefs = useMemo(
    () => specs.map(() => ({ current: null as THREE.Group | null })),
    [specs],
  )

  useFrame(({ camera }) => {
    const npcs = simRef.current.npcs
    for (let i = 0; i < specs.length; i++) {
      const g = refs.current[i]
      const st = npcs[i]
      if (!g || !st) continue
      poseAt(frames, st.s, st.d, HOVER_HEIGHT, pose.current)
      const p = pose.current
      // wrecked NPCs vanish for the pause; ships beyond the fog wall are
      // invisible anyway — skip their draw entirely (T173)
      const dx = p.px - camera.position.x
      const dy = p.py - camera.position.y
      const dz = p.pz - camera.position.z
      g.visible = st.wrecked <= 0 && dx * dx + dy * dy + dz * dz < fogFar * fogFar
      g.position.set(p.px, p.py, p.pz)
      telemetry.racersXZ[(i + 1) * 3] = p.px
      telemetry.racersXZ[(i + 1) * 3 + 1] = p.py
      telemetry.racersXZ[(i + 1) * 3 + 2] = p.pz
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
          // T150: NPCs read as FULL throttle — power tracks their actual pace
          if (!st || st.finished || st.v <= 1) return 0
          return Math.min(1.1, 0.5 + st.v / (avgSpeed * 0.64))
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
                [-0.3, 0.22, 1.62],
                [0.3, 0.22, 1.62],
              ]}
              color={spec.accent}
              intensity={npcPower}
              speed={() => simRef.current.npcs[i]?.v ?? 0}
              points={trailPoints}
            />
          </group>
        )
      })}
    </>
  )
}

/** T99: sky v2 — de-banded stars (two depths, twinkle) + nebula glow discs */
function Starfield({ color, count = 1500 }: { color: string; count?: number }) {
  const nearMat = useRef<THREE.PointsMaterial>(null)
  const groupRef = useRef<THREE.Group>(null)
  const geos = useMemo(() => {
    const make = (n: number, seedMul: number, rMin: number, rSpan: number) => {
      const pos = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        // integer hash scatter — golden angle alone left visible dot-rows
        const h1 = ((i * 2654435761) >>> 0) / 4294967296
        const h2 = (((i + seedMul) * 40503) >>> 0 % 65536) / 65536
        const a = h1 * Math.PI * 2
        const r = rMin + h2 * rSpan
        pos[i * 3] = Math.cos(a) * r
        pos[i * 3 + 1] = (((i * 7919 + seedMul * 31) % 2000) / 2000 - 0.35) * 1100
        pos[i * 3 + 2] = Math.sin(a) * r
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      return g
    }
    return { far: make(Math.floor(count * 0.7), 7, 1200, 900), near: make(Math.floor(count * 0.3), 131, 700, 400) }
  }, [count])

  useFrame(({ camera }) => {
    // highs make the near layer shimmer; drops flare the whole field
    if (nearMat.current) nearMat.current.opacity = 0.45 + telemetry.centroid * 0.5 + telemetry.dropPulse * 0.45
    // sky dome FOLLOWS the camera: tracks run kilometers from the origin —
    // fixed-world stars drifted out of the (now tighter) far plane and the
    // late-race sky went empty. Also what lets camera.far sit at 2800.
    groupRef.current?.position.copy(camera.position)
  })

  return (
    <group ref={groupRef}>
      <points geometry={geos.far}>
        <pointsMaterial color="#9fb4d8" size={1.4} sizeAttenuation={false} transparent opacity={0.5} />
      </points>
      <points geometry={geos.near}>
        <pointsMaterial ref={nearMat} color={color} size={2.6} sizeAttenuation={false} transparent opacity={0.6} />
      </points>
      <Nebulae color={color} />
    </group>
  )
}

/** T99: three huge soft glow discs — depth + color wash behind everything */
function Nebulae({ color }: { color: string }) {
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const meshes = useRef<(THREE.Mesh | null)[]>([])
  const SPOTS: { pos: [number, number, number]; r: number; o: number }[] = [
    { pos: [1400, 250, -900], r: 700, o: 0.07 },
    { pos: [-1100, 80, 1200], r: 550, o: 0.05 },
    { pos: [300, 500, 1600], r: 800, o: 0.06 },
  ]
  useFrame(() => {
    const e = telemetry.energy
    // drop spectacle: nebulae BLOOM — opacity surge + visible swell
    const drop = telemetry.dropPulse
    mats.current.forEach((m, i) => {
      if (m) m.opacity = SPOTS[i].o * (0.6 + e * 0.8) * (1 + drop * 2.4)
    })
    meshes.current.forEach((m) => {
      if (m) m.scale.setScalar(1 + drop * 0.55)
    })
  })
  return (
    <>
      {SPOTS.map((sp, i) => (
        <mesh
          key={i}
          ref={(m) => void (meshes.current[i] = m)}
          position={sp.pos}
          onUpdate={(m) => m.lookAt(0, 0, 0)}
        >
          <circleGeometry args={[sp.r, 24]} />
          <meshBasicMaterial
            ref={(m) => void (mats.current[i] = m)}
            color={i === 1 ? '#7b5cff' : color}
            transparent
            opacity={sp.o}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </>
  )
}
