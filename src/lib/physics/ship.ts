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
  /** ramped steer input (B7) — what yaw actually follows */
  steerSmooth: number
  /** airborne over a crest (V16) */
  airborne: boolean
  /** vertical velocity while airborne, m/s */
  vy: number
  /** extra height above hover while airborne, m */
  air: number
  /** T65: gripped lateral velocity state — slides converge, not snap */
  latVel: number
  /** T78: fell off a rail-less ridge — plunging until respawn */
  falling: boolean
}

export interface StepEvents {
  wallHit: boolean
  /** impact speed when hitting wall, for shake/sfx scaling */
  wallImpact: number
  boostFired: boolean
  finished: boolean
  takeoff: boolean
  landed: boolean
  /** T78: fell off and got reset to centerline */
  respawned: boolean
  /** vertical speed at touchdown */
  landImpact: number
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
    steerSmooth: 0,
    airborne: false,
    vy: 0,
    air: 0,
    latVel: 0,
    falling: false,
  }
}

const SHIP_HALF_WIDTH = 1.0
const BOOST_LEN = 14
const BOOST_HALF_WIDTH = 2.2
/** arcade gravity, m/s² — heavier than earth so jumps stay snappy */
const GRAVITY = 34

/** road slope dy/ds at sample i */
function slopeAt(frames: TrackFrames, i: number): number {
  const j = Math.min(frames.count - 2, Math.max(0, i))
  return (frames.positions[(j + 1) * 3 + 1] - frames.positions[j * 3 + 1]) / frames.ds
}

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
  events.takeoff = false
  events.landed = false
  events.landImpact = 0
  events.respawned = false

  if (state.finished) return
  const dt = PHYSICS_DT

  const vmax = track.avgSpeed * 1.45 + (state.boost > 0 ? 60 : 0)
  // B8: slower spool — accel tapers hard as v climbs, top speed is earned
  const accel = track.avgSpeed * 0.34
  const braking = (input.brakeLeft ? 1 : 0) + (input.brakeRight ? 1 : 0)

  // longitudinal
  const vRatio = Math.min(1, state.v / vmax)
  let a = input.thrust * accel * (1 - Math.pow(vRatio, 1.4))
  // B14: engine braking — off throttle the field drag bites hard
  a -= state.v * (0.05 + (1 - input.thrust) * 0.28)
  a -= braking * state.v * 0.35 // airbrake scrub
  if (state.boost > 0) a += 90
  state.v = Math.max(0, state.v + a * dt)
  state.boost = Math.max(0, state.boost - dt)

  // B7: steer input ramps — attack slower than release, so a tap nudges
  // instead of slamming
  const steerAssist =
    (input.brakeLeft && !input.brakeRight ? -0.6 : 0) + (input.brakeRight && !input.brakeLeft ? 0.6 : 0)
  const steerTarget = clamp(input.steer + steerAssist, -1.2, 1.2)
  const attacking = Math.abs(steerTarget) > Math.abs(state.steerSmooth)
  const rate = attacking ? 3.2 : 8
  state.steerSmooth += clamp(steerTarget - state.steerSmooth, -rate * dt, rate * dt)

  const grip = 1 / (1 + state.v / 220)
  const airGrip = state.airborne ? 0.4 : 1
  const targetYaw = state.steerSmooth * 0.45 * (0.6 + grip) * airGrip
  state.yaw += (targetYaw - state.yaw) * Math.min(1, dt * 10)

  // lateral motion in track space: own steering ± curvature drift
  const i = Math.round(state.s / frames.ds)
  const k = curvatureAt(frames, i)
  // T47/B12: outward drift is half the true centripetal demand k·v² —
  // thrust alone can NOT ride a curve, you steer or you grind.
  // T56 carve assist: steering WITH the curve cuts drift 35% — you feel
  // the ship hook around the corner.
  const carveAlign = Math.max(0, Math.min(1, state.steerSmooth * Math.sign(k)))
  // T65: banked track grips — frame tilt (upY < 1) cuts outward drift
  const upYHere = frames.normals[Math.min(frames.count - 1, Math.max(0, i)) * 3 + 1]
  const bankGrip = Math.max(0.3, 1 - (1 - Math.min(1, Math.abs(upYHere))) * 3)
  const drift = k * state.v * state.v * 0.38 * (1 - 0.35 * carveAlign) * bankGrip
  // T65 traction: lateral velocity converges toward demand at a grip rate —
  // the ship slides then bites. Airbrakes add bite.
  const tractionRate = 5 + braking * 6 + carveAlign * 2
  const latTarget = (Math.sin(state.yaw) * state.v - drift) * airGrip
  state.latVel += (latTarget - state.latVel) * Math.min(1, tractionRate * dt)
  const lateralV = state.latVel
  state.d += lateralV * dt

  // T78: off the edge of a rail-less ridge → plunge, then respawn
  const hasWall = frames.walls[Math.min(frames.count - 1, Math.max(0, i))] > 0.5
  const limitHere = (track.width * frames.widths[Math.min(frames.count - 1, Math.max(0, i))]) / 2 - SHIP_HALF_WIDTH
  if (state.falling) {
    state.vy -= GRAVITY * dt
    state.air += state.vy * dt
    state.s += state.v * dt * 0.6
    state.time += dt
    if (state.air < -14) {
      state.falling = false
      state.air = 0
      state.vy = 0
      state.d = 0
      state.v *= 0.4
      events.respawned = true
    }
    return
  }
  if (!hasWall && Math.abs(state.d) > limitHere + 1.2 && !state.airborne) {
    state.falling = true
    state.vy = -2
    return
  }

  // V16 airtime: when the road falls away faster than gravity pulls, fly
  const slopeHere = slopeAt(frames, i)
  // T60: inside corkscrew twists (track-up tilted off world-up) airtime is
  // disabled — the field holds you to the deck
  const upY = frames.normals[Math.min(frames.count - 1, Math.max(0, i)) * 3 + 1]
  if (state.airborne && upY < 0.45) {
    state.airborne = false
    state.air = 0
    state.vy = 0
  }
  if (!state.airborne) {
    const slopeAhead = slopeAt(frames, i + 2)
    const requiredDvy = state.v * (slopeAhead - slopeHere)
    if (requiredDvy < -GRAVITY * dt * 3 && state.v > 30 && upY > 0.45) {
      state.airborne = true
      state.vy = state.v * slopeHere
      state.air = 0
      events.takeoff = true
    }
  } else {
    state.vy -= GRAVITY * dt
    state.air += (state.vy - state.v * slopeHere) * dt
    if (state.air <= 0) {
      events.landed = true
      events.landImpact = Math.max(0, state.v * slopeHere - state.vy)
      state.air = 0
      state.vy = 0
      state.airborne = false
    }
  }

  // walls: hard impact penalty on contact, friction while grinding.
  // T77: limit follows the local width; T78: no clamp where walls are absent
  const limit = limitHere
  if (hasWall && Math.abs(state.d) > limit) {
    const impact = Math.abs(lateralV)
    state.d = clamp(state.d, -limit, limit)
    if (!state.onWall) {
      // harsher than v1: walls must hurt
      state.v *= Math.max(0.72, 1 - impact * 0.02)
      state.yaw *= 0.35
      events.wallHit = true
      events.wallImpact = impact
      state.wallHits++
      state.onWall = true
    } else {
      state.v = Math.max(0, state.v - state.v * 0.5 * dt)
    }
  } else if (state.onWall && Math.abs(state.d) < limit - 1.2) {
    // wide release band: brushing along the wall is one impact + grind,
    // not a machine-gun of impact penalties
    state.onWall = false
  }

  // boost pads — fire each pad once as the ship crosses it in its lane
  // (not while airborne; you have to be on the deck to catch the field)
  for (let bi = state.lastBoostIdx + 1; bi < track.boosts.length; bi++) {
    const pad = track.boosts[bi]
    if (pad.s > state.s + BOOST_LEN) break
    if (state.s >= pad.s - BOOST_LEN && state.s <= pad.s + BOOST_LEN) {
      const padD = pad.lane * (track.width / 2 - 1.5)
      if (!state.airborne && Math.abs(state.d - padD) <= BOOST_HALF_WIDTH + SHIP_HALF_WIDTH) {
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
 * V18 lean convention (amends V14, fixes B6): lean comes from USER STEER
 * only — positive steer (right) banks right. Track curvature does not
 * auto-lean the ship. Renderers own any sign flip their model orientation
 * needs (B5).
 */
export function computeLean(steer: number, v: number): number {
  // T51: roll is the garnish — the nose-in yaw carries the carve
  return clamp(steer * (0.42 + Math.min(0.22, v / 800)), -0.6, 0.6)
}
