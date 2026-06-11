/**
 * NPC racers (T20). Deterministic (V15): specs seeded from track.seed,
 * stepped at the same fixed dt as the player. No Math.random (V8).
 *
 * Physics unification: NPCs no longer have their own movement model — they
 * are a steering/throttle CONTROLLER on top of the player's stepShip. Same
 * vmax, accel, drag, drift, walls, boost pads, energy. Skill differences are
 * driving differences: line quality, braking margin, wobble — never a
 * different rulebook.
 */
import { mulberry32, rngRange } from '../prng'
import { contrastShift } from '../accent'
import type { TrackData } from '../track/generate'
import { curvatureAt, type TrackFrames } from '../track/sample'
import {
  PHYSICS_DT,
  initialShip,
  maxCarveCurvature,
  stepShip,
  type ShipInput,
  type ShipState,
  type StepEvents,
} from './ship'

export interface NpcSpec {
  name: string
  accent: string
  /** target pace as multiple of track design speed */
  pace: number
  /** preferred lane -1..1 */
  lanePref: number
  wobbleFreq: number
  wobbleAmp: number
  /** 0..1 — how little corners slow them down */
  cornerSkill: number
  phase: number
  /** T145: grid row (0 front) — staggers the launch */
  gridRow: number
  /** T145: grid lateral start — formation held early */
  gridD: number
}

/** an NPC IS a ship — full player state, no parallel model */
export type NpcState = ShipState

const NAMES = ['VEKTOR', 'NYX-7', 'KAIROS', 'BLUR', 'SABLE'] as const
const ACCENTS = ['#ff5533', '#ffd23d', '#7bff8a', '#b07bff', '#ff7bd5'] as const
// T145 → T159/T164: fractions of design pace (V2 rework: design pace = a
// skilled rider's pace). VEKTOR runs ~93% of a perfect ride — you BEAT him
// with boost discipline and clean lines, not by default.
const BASE_PACE = [0.93, 0.87, 0.82, 0.76, 0.72] as const

export function makeNpcs(track: TrackData, count = 5): NpcSpec[] {
  const rng = mulberry32((track.seed ^ 0x4e9c11) >>> 0)
  const n = Math.min(count, NAMES.length)
  const specs: NpcSpec[] = []
  for (let i = 0; i < n; i++) {
    specs.push({
      name: NAMES[i],
      // T116: an NPC wearing the world's color disappears — hue-shift it
      accent: contrastShift(ACCENTS[i], track.theme.edge),
      pace: BASE_PACE[i] + rngRange(rng, -0.03, 0.03),
      lanePref: rngRange(rng, -0.7, 0.7),
      wobbleFreq: rngRange(rng, 0.25, 0.7),
      wobbleAmp: rngRange(rng, 0.5, 2),
      // T145/T159/T168: top two are guaranteed corner pros
      cornerSkill: Math.max(rngRange(rng, 0.65, 0.95), i === 0 ? 0.92 : i === 1 ? 0.85 : 0),
      phase: rngRange(rng, 0, Math.PI * 2),
      gridRow: Math.floor(i / 2),
      gridD: i % 2 === 0 ? -5 : 5,
    })
  }
  return specs
}

export function initialNpc(index: number): NpcState {
  // T46/T55: 2-column grid, 14m rows, ±5m cols — fully clear of HIT_DS/DD
  const row = Math.floor(index / 2)
  const col = index % 2
  const ship = initialShip()
  ship.s = -14 - row * 14
  ship.d = col === 0 ? -5 : 5
  return ship
}

/** npc accent colors, exported for the HUD minimap (T48) */
export const NPC_ACCENTS = ACCENTS

// module-level scratch — stepNpc is single-threaded and deterministic (V15)
const npcInput: ShipInput = { steer: 0, thrust: 0, brakeLeft: false, brakeRight: false }
const npcEvents: StepEvents = {
  wallHit: false,
  wallImpact: 0,
  boostFired: false,
  finished: false,
  takeoff: false,
  landed: false,
  landImpact: 0,
  respawned: false,
  exploded: false,
}

export function stepNpc(
  state: NpcState,
  spec: NpcSpec,
  track: TrackData,
  frames: TrackFrames,
): void {
  if (state.finished) return

  const i = Math.max(0, Math.round(state.s / frames.ds))
  const v = Math.max(20, state.v)
  // look ~1.1s down the road — braking and line decisions happen AHEAD
  const la = Math.round((v * 1.1) / frames.ds)
  const kAhead = curvatureAt(frames, Math.min(frames.count - 1, i + la))
  const kNow = curvatureAt(frames, i)
  const hw = (track.width * frames.widths[Math.min(frames.count - 1, i)]) / 2 - 2.4

  // ---- racing line: lane preference, pulled INSIDE upcoming corners by
  // skill, plus the personality wobble. Formation hold for the launch.
  const formation = Math.min(1, Math.max(0, (state.time - 2) / 4))
  const insidePull =
    Math.sign(kAhead) * Math.min(1, Math.abs(kAhead) / 0.004) * hw * 0.45 * spec.cornerSkill
  const raceD =
    spec.lanePref * hw * 0.4 +
    insidePull +
    Math.sin(state.time * spec.wobbleFreq * Math.PI * 2 + spec.phase) * spec.wobbleAmp
  const targetD = Math.min(hw, Math.max(-hw, spec.gridD * (1 - formation) + raceD * formation))

  // ---- steering: feedforward counters the drift demand exactly like a
  // human holding a carve, PD on lane error cleans up the rest
  const grip = 1 / (1 + v / 150)
  const yawAuthority = 0.42 * (0.5 + grip)
  const driftDemand = (kNow * v * Math.min(v, 320) * 0.3) / (1 + v / 700)
  const ffYaw = Math.asin(Math.min(0.9, Math.max(-0.9, driftDemand / v)))
  const ff = Math.min(1.1, Math.max(-1.1, ffYaw / yawAuthority))
  const err = targetD - state.d
  const steer = Math.min(1, Math.max(-1, ff * (0.7 + 0.3 * spec.cornerSkill) + err * 0.05 - state.latVel * 0.018))

  // ---- speed management: same carve-authority math as track gen. Skilled
  // drivers commit closer to the limit; everyone airbrakes past it.
  const kMax = maxCarveCurvature(v) * (0.55 + 0.5 * spec.cornerSkill)
  const over = Math.abs(kAhead) > kMax
  const wayOver = Math.abs(kAhead) > kMax * 1.4

  // T159: rows leave WITH the GO, 0.12s ripple — same physics, just throttle
  const launched = state.time >= spec.gridRow * 0.12
  npcInput.steer = launched ? steer : 0
  // tiny pace spread via throttle ceiling (drag punishes partial throttle)
  npcInput.thrust = !launched ? 0 : over ? 0.3 : Math.min(1, 0.87 + spec.pace * 0.14)
  npcInput.brakeLeft = wayOver
  npcInput.brakeRight = wayOver

  // the ONE physics step — identical rulebook to the player (V12, V17, T161)
  stepShip(state, npcInput, track, frames, npcEvents)
}

/** V13: live race position — 1 + racers strictly ahead. */
export function racePosition(playerS: number, npcs: readonly NpcState[]): number {
  let ahead = 0
  for (const n of npcs) if (n.s > playerS) ahead++
  return 1 + ahead
}

/** minimal shared shape for collision resolution (player + NPCs) */
export interface Racer {
  s: number
  d: number
  v: number
  /** height above the deck while airborne — grounded racers omit it */
  air?: number
}

const HIT_DS = 5.5
const HIT_DD = 2.8
/** T112: vertical clearance — more than this apart in height = no contact */
const HIT_DH = 3

/**
 * T32/V17: pairwise bump resolution. Momentum-style speed exchange (sum of
 * speeds never increases), lateral shove apart, slight s de-overlap.
 * Deterministic — fixed iteration order, no randomness.
 * Returns total impact magnitude involving racers[0] (the player), for shake.
 */
export function resolveCollisions(
  racers: Racer[],
  track: TrackData,
  cooldowns?: Float32Array,
): number {
  const limit = track.width / 2 - 1.5
  let playerImpact = 0
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i]
      const b = racers[j]
      if (Math.abs(a.s - b.s) >= HIT_DS || Math.abs(a.d - b.d) >= HIT_DD) continue
      // T112: flying over someone is not a collision
      if (Math.abs((a.air ?? 0) - (b.air ?? 0)) >= HIT_DH) continue

      // B13: momentum impulse fires ONCE per contact — rear ship brakes,
      // front ship gets shunted forward. Cooldown stops the jerk loop.
      const onCooldown = cooldowns ? cooldowns[i] > 0 || cooldowns[j] > 0 : false
      if (!onCooldown) {
        const rear = a.s <= b.s ? a : b
        const front = rear === a ? b : a
        if (rear.v > front.v) {
          const dv = rear.v - front.v
          if (dv > 55) {
            // T79: high-velocity slam — both ships wreck hard
            rear.v *= 0.2
            front.v *= 0.7
            if (i === 0 || j === 0) playerImpact += 40
          } else {
            // T112: softened — bumps nudge, they don't yank (V17: sum of
            // speeds still never increases)
            rear.v = Math.max(0, rear.v - dv * 0.42)
            front.v += dv * 0.34
            if (i === 0 || j === 0) playerImpact += dv * 0.22 + 1.2
          }
        }
        if (cooldowns) {
          cooldowns[i] = 0.4
          cooldowns[j] = 0.4
        }
      }

      // gradual separation — T150: dt-scaled VELOCITIES, not per-step jumps.
      // 0.17m + 0.3m per 120Hz step was 20-36 m/s of invisible teleporting —
      // the "NPCs stuttering around" feel whenever ships ran close.
      const dir = a.d !== b.d ? Math.sign(a.d - b.d) : a.s >= b.s ? 1 : -1
      const sep = 3.2 * PHYSICS_DT
      a.d = clamp(a.d + dir * sep, -limit, limit)
      b.d = clamp(b.d - dir * sep, -limit, limit)
      if (Math.abs(a.s - b.s) < 2.5) {
        const push = 5 * PHYSICS_DT
        if (a.s >= b.s) a.s += push
        else b.s += push
      }
    }
  }
  return playerImpact
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}
