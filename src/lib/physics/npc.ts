/**
 * NPC racers (T20). Deterministic (V15): specs seeded from track.seed,
 * stepped at the same fixed dt as the player. No Math.random (V8).
 */
import { mulberry32, rngRange } from '../prng'
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
      accent: ACCENTS[i],
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
  // staggered grid start behind the line
  return { s: -6 - index * 7, d: (index % 2 === 0 ? -1 : 1) * 2.5, v: 0, time: 0, finished: false }
}

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
  const targetV = track.avgSpeed * spec.pace * cornerFactor
  state.v += (targetV - state.v) * Math.min(1, dt * 0.9)

  const halfW = track.width / 2 - 1.6
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
