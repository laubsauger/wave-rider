/**
 * NPC racers (T20). Deterministic (V15): specs seeded from track.seed,
 * stepped at the same fixed dt as the player. No Math.random (V8).
 */
import { mulberry32, rngRange } from '../prng'
import { contrastShift } from '../accent'
import type { TrackData } from '../track/generate'
import { curvatureAt, type TrackFrames } from '../track/sample'
import { PHYSICS_DT } from './ship'

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
}

export interface NpcState {
  s: number
  d: number
  v: number
  time: number
  finished: boolean
}

const NAMES = ['VEKTOR', 'NYX-7', 'KAIROS', 'BLUR', 'SABLE'] as const
const ACCENTS = ['#ff5533', '#ffd23d', '#7bff8a', '#b07bff', '#ff7bd5'] as const
const BASE_PACE = [1.32, 1.24, 1.17, 1.1, 1.02] as const

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
      cornerSkill: rngRange(rng, 0.35, 0.95),
      phase: rngRange(rng, 0, Math.PI * 2),
    })
  }
  return specs
}

export function initialNpc(index: number): NpcState {
  // T46/T55: 2-column grid, 14m rows, ±5m cols — fully clear of HIT_DS/DD
  const row = Math.floor(index / 2)
  const col = index % 2
  return { s: -14 - row * 14, d: col === 0 ? -5 : 5, v: 0, time: 0, finished: false }
}

/** npc accent colors, exported for the HUD minimap (T48) */
export const NPC_ACCENTS = ACCENTS

export function stepNpc(
  state: NpcState,
  spec: NpcSpec,
  track: TrackData,
  frames: TrackFrames,
): void {
  if (state.finished) return
  const dt = PHYSICS_DT

  const i = Math.max(0, Math.round(state.s / frames.ds))
  const k = Math.abs(curvatureAt(frames, i))
  // corners scare the unskilled
  const cornerFactor = Math.max(0.45, 1 - k * state.v * 0.35 * (1 - spec.cornerSkill))
  // T135: staggered launch — the field spools up over the first seconds
  // instead of slamming through the player off the line
  const launch = Math.min(1, 0.2 + state.time / 5)
  const targetV = track.avgSpeed * spec.pace * cornerFactor * launch
  state.v += (targetV - state.v) * Math.min(1, dt * 0.9)

  const halfW = (track.width * frames.widths[Math.min(frames.count - 1, Math.max(0, i))]) / 2 - 1.6
  const targetD =
    spec.lanePref * halfW * 0.55 + Math.sin(state.time * spec.wobbleFreq * Math.PI * 2 + spec.phase) * spec.wobbleAmp
  state.d += (targetD - state.d) * Math.min(1, dt * 1.6)
  state.d = Math.min(halfW, Math.max(-halfW, state.d))

  state.s += state.v * dt
  state.time += dt
  if (state.s >= track.length) {
    state.s = track.length
    state.finished = true
  }
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

      // gradual separation every step — no teleporting (B13); T112 gentler
      const dir = a.d !== b.d ? Math.sign(a.d - b.d) : a.s >= b.s ? 1 : -1
      a.d = clamp(a.d + dir * 0.17, -limit, limit)
      b.d = clamp(b.d - dir * 0.17, -limit, limit)
      if (Math.abs(a.s - b.s) < 2.5) {
        if (a.s >= b.s) a.s += 0.3
        else b.s += 0.3
      }
    }
  }
  return playerImpact
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}
