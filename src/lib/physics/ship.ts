/**
 * Ship physics (T5). Track-space arcade model: state lives in (s, d) spline
 * coordinates so the ship can never fall off the world and walls are exact.
 * stepShip is a pure fixed-dt transition (V5, C9) — render code never calls
 * it with variable dt; use the accumulator in loop.ts.
 */
import type { TrackData } from '../track/generate'
import { curvatureAt, type TrackFrames } from '../track/sample'

export const PHYSICS_DT = 1 / 120

export interface ShipInput {
  /** -1..1 */
  steer: number
  /** 0..1 */
  thrust: number
  brakeLeft: boolean
  brakeRight: boolean
}

export interface ShipState {
  /** arc length along track, m */
  s: number
  /** lateral offset, m */
  d: number
  /** forward speed, m/s */
  v: number
  /** visual yaw offset from track tangent, rad */
  yaw: number
  /** seconds of boost remaining */
  boost: number
  /** elapsed race time, s */
  time: number
  finished: boolean
  topSpeed: number
  wallHits: number
  boostsHit: number
  /** index of last consumed boost pad, to fire each once */
  lastBoostIdx: number
  /** currently grinding a wall (impact fired) */
  onWall: boolean
}

export interface StepEvents {
  wallHit: boolean
  /** impact speed when hitting wall, for shake/sfx scaling */
  wallImpact: number
  boostFired: boolean
  finished: boolean
}

export function initialShip(): ShipState {
  return {
    s: 0,
    d: 0,
    v: 0,
    yaw: 0,
    boost: 0,
    time: 0,
    finished: false,
    topSpeed: 0,
    wallHits: 0,
    boostsHit: 0,
    lastBoostIdx: -1,
    onWall: false,
  }
}

const SHIP_HALF_WIDTH = 1.3
const BOOST_LEN = 14
const BOOST_HALF_WIDTH = 2.2

export function stepShip(
  state: ShipState,
  input: ShipInput,
  track: TrackData,
  frames: TrackFrames,
  events: StepEvents,
): void {
  events.wallHit = false
  events.wallImpact = 0
  events.boostFired = false
  events.finished = false

  if (state.finished) return
  const dt = PHYSICS_DT

  const vmax = track.avgSpeed * 1.45 + (state.boost > 0 ? 60 : 0)
  const accel = track.avgSpeed * 0.55
  const braking = (input.brakeLeft ? 1 : 0) + (input.brakeRight ? 1 : 0)

  // longitudinal
  let a = input.thrust * accel * Math.max(0, 1 - state.v / vmax)
  a -= state.v * 0.06 // base drag
  a -= braking * state.v * 0.35 // airbrake scrub
  if (state.boost > 0) a += 90
  state.v = Math.max(0, state.v + a * dt)
  state.boost = Math.max(0, state.boost - dt)

  // steering: airbrake on one side tightens that direction
  const steerAssist =
    (input.brakeLeft && !input.brakeRight ? -0.6 : 0) + (input.brakeRight && !input.brakeLeft ? 0.6 : 0)
  const steer = clamp(input.steer + steerAssist, -1.2, 1.2)
  const grip = 1 / (1 + state.v / 220)
  const targetYaw = steer * 0.45 * (0.6 + grip)
  state.yaw += (targetYaw - state.yaw) * Math.min(1, dt * 10)

  // lateral motion in track space: own steering ± curvature drift
  const i = Math.round(state.s / frames.ds)
  const k = curvatureAt(frames, i)
  const lateralV = Math.sin(state.yaw) * state.v - k * state.v * state.v * 0.0035
  state.d += lateralV * dt

  // walls: hard impact penalty only on first contact; grinding afterwards
  // costs light continuous friction, not a per-step multiplier (would zero
  // speed at 120Hz)
  const limit = track.width / 2 - SHIP_HALF_WIDTH
  if (Math.abs(state.d) > limit) {
    const impact = Math.abs(lateralV)
    state.d = clamp(state.d, -limit, limit)
    if (!state.onWall) {
      state.v *= Math.max(0.88, 1 - impact * 0.008)
      state.yaw *= 0.4
      events.wallHit = true
      events.wallImpact = impact
      state.wallHits++
      state.onWall = true
    } else {
      state.v = Math.max(0, state.v - state.v * 0.35 * dt)
    }
  } else if (state.onWall && Math.abs(state.d) < limit - 1.2) {
    // wide release band: brushing along the wall is one impact + grind,
    // not a machine-gun of impact penalties
    state.onWall = false
  }

  // boost pads — fire each pad once as the ship crosses it in its lane
  for (let bi = state.lastBoostIdx + 1; bi < track.boosts.length; bi++) {
    const pad = track.boosts[bi]
    if (pad.s > state.s + BOOST_LEN) break
    if (state.s >= pad.s - BOOST_LEN && state.s <= pad.s + BOOST_LEN) {
      const padD = pad.lane * (track.width / 2 - 1.5)
      if (Math.abs(state.d - padD) <= BOOST_HALF_WIDTH + SHIP_HALF_WIDTH) {
        state.boost = 1.1
        state.v += 25
        state.boostsHit++
        events.boostFired = true
      }
      state.lastBoostIdx = bi
    }
  }

  // V12 ceiling, applied after every speed source incl. pad impulses (B3):
  // soft pullback toward vmax, hard wall at 1.08× so the invariant holds
  if (state.v > vmax) {
    state.v += (vmax - state.v) * Math.min(1, dt * 2.5)
    state.v = Math.min(state.v, vmax * 1.08)
  }

  // advance
  state.s += Math.cos(state.yaw) * state.v * dt
  state.time += dt
  if (state.v > state.topSpeed) state.topSpeed = state.v

  if (state.s >= track.length) {
    state.s = track.length
    state.finished = true
    events.finished = true
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/**
 * V14 lean convention: POSITIVE result = bank into a RIGHT turn (right side
 * dips). Inputs: yaw > 0 = steering right, curvature k > 0 = track bends
 * right. Renderers own any sign flip their model orientation needs (B5).
 */
export function computeLean(yaw: number, k: number, v: number): number {
  return clamp(yaw * 1.5 + k * v * 0.5, -0.85, 0.85)
}
