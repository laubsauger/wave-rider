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
  /** T156: retro brake — hard decel; airborne adds downward sink */
  retro?: boolean
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
  /** seconds the current steer direction has been held — progressive lock */
  steerHeld: number
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
  /** T115: arc position where the fall began — respawn sets back from here */
  fallS: number
  /** hull integrity 0..1 — wall hits and bumps drain it; 0 = explode+reset */
  energy: number
  /** seconds since last damage — regen starts after a grace window */
  damageT: number
  /** wreck pause: seconds until respawn — the explosion gets its moment */
  wrecked: number
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
  /** energy hit zero — hull blew, respawn follows */
  exploded: boolean
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
    steerHeld: 0,
    airborne: false,
    vy: 0,
    air: 0,
    latVel: 0,
    falling: false,
    fallS: 0,
    energy: 1,
    damageT: 99,
    wrecked: 0,
  }
}

/** wreck pause before any reset — long enough to SEE what happened */
const WRECK_PAUSE = 1.3

/** begin the death sequence: halt where it happened, explosion plays, the
 * respawn (40m behind `anchorS`, centered, fresh hull) lands after the pause */
function startWreck(state: ShipState, anchorS: number, events: StepEvents): void {
  state.wrecked = WRECK_PAUSE
  state.fallS = anchorS
  state.v = 0
  state.falling = false
  events.exploded = true
}

/** apply hull damage — resets the regen grace window. Scene code uses this
 * for racer-bump impacts; stepShip uses it for walls internally. */
export function drainEnergy(state: ShipState, amount: number): void {
  state.energy = Math.max(0, state.energy - amount)
  state.damageT = 0
}

const SHIP_HALF_WIDTH = 1.0
const BOOST_LEN = 14
// forgiving catch: slicing a pad edge counts — full-center precision isn't
// the skill being tested, line choice is
const BOOST_HALF_WIDTH = 2.9
/** arcade gravity, m/s² — heavier than earth so jumps stay snappy */
const GRAVITY = 34

/** top speed for a track's design pace — single source for sim, fx, tests (V12).
 * V2 rework: avgSpeed IS the skilled ride pace now (2.2× the old reference),
 * so the ceiling fraction re-anchors 3.0 → 1.36 — identical absolute speeds.
 * T169: HYPERSPEED ceiling — ~2000-2600 kph at the top of a boost chain. */
export function shipVmax(avgSpeed: number, boosted: boolean): number {
  return avgSpeed * 1.36 + (boosted ? 100 : 0)
}

/**
 * Max curvature (rad/m) the ship can hold at speed v with a committed carve —
 * the inverse of the drift model in stepShip (yaw authority vs outward drift,
 * carve assist applied). Track gen budgets corner sharpness against THIS so
 * curves demand real sustained steering at pace instead of flattening into
 * wobbles (the old fixed lateral-accel target undershot by 2-3×).
 */
export function maxCarveCurvature(v: number): number {
  const grip = 1 / (1 + v / 150)
  const yawMax = 0.42 * (0.5 + grip)
  const latCap = Math.sin(yawMax) * v
  // mirrors the drift model in stepShip exactly (coeff + carve trim)
  const driftPerK = v * Math.min(v, 320) * driftCoeff(v) * (1 - 0.2)
  return latCap / Math.max(1, driftPerK)
}

/** outward-drift coefficient — softens with speed so hyperspeed corners pull
 * over seconds, not yank the ship across the road in half of one */
function driftCoeff(v: number): number {
  return 0.3 / (1 + v / 700)
}

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
  events.exploded = false

  if (state.finished) return
  const dt = PHYSICS_DT

  // wreck pause: ship is DEAD where it died — the explosion plays, the
  // player sees what happened, THEN the reset lands
  if (state.wrecked > 0) {
    state.wrecked -= dt
    state.time += dt
    if (state.wrecked <= 0) {
      state.wrecked = 0
      state.s = Math.max(0, state.fallS - 40)
      state.d = 0
      state.v = track.avgSpeed * 0.22
      state.yaw = 0
      state.latVel = 0
      state.airborne = false
      state.air = 0
      state.vy = 0
      // fresh hull after the reset — the malus is the pause + setback
      state.energy = 1
      state.damageT = 0
      events.respawned = true
    }
    return
  }

  // hull energy: regen after a 2s no-damage grace; empty hull = explosion
  // (the malus that makes wall-bashing a losing strategy)
  state.damageT += dt
  if (state.damageT > 2 && state.energy < 1) {
    state.energy = Math.min(1, state.energy + 0.09 * dt)
  }
  if (state.energy <= 0 && !state.falling) {
    startWreck(state, state.s, events)
    state.time += dt
    return
  }

  const vmax = shipVmax(track.avgSpeed, state.boost > 0)
  // B8: slower spool — accel tapers hard as v climbs, top speed is earned
  // (0.34 → 0.155: re-anchored to the 2.2× design pace, same absolute accel)
  const accel = track.avgSpeed * 0.155
  const braking = (input.brakeLeft ? 1 : 0) + (input.brakeRight ? 1 : 0)

  // longitudinal
  const vRatio = Math.min(1, state.v / vmax)
  let a = input.thrust * accel * (1 - Math.pow(vRatio, 1.4))
  // B14: engine braking — off throttle the field drag bites hard.
  // T170: quadratic air drag — no-boost cruise settles ~55% of vmax; the
  // ceiling is reachable ONLY through sustained boost chains (discipline).
  a -= state.v * (0.05 + (1 - input.thrust) * 0.28) + state.v * state.v * 0.0001
  a -= braking * state.v * 0.35 // airbrake scrub
  // T156: retro brake — reverse thrust, way harder than coasting
  const retro = input.retro ? 1 : 0
  a -= retro * (accel * 0.9 + state.v * 0.12)
  if (state.boost > 0) a += 85 // T170
  state.v = Math.max(0, state.v + a * dt)
  state.boost = Math.max(0, state.boost - dt)

  // B7: steer input ramps — attack slower than release, so a tap nudges
  // instead of slamming
  const steerAssist =
    (input.brakeLeft && !input.brakeRight ? -0.6 : 0) + (input.brakeRight && !input.brakeLeft ? 0.6 : 0)
  const steerTarget = clamp(input.steer + steerAssist, -1.2, 1.2)
  const attacking = Math.abs(steerTarget) > Math.abs(state.steerSmooth)
  // Progressive digital steering (keyboard-first, standard arcade solution):
  // the lock RAMPS while held — a tap is a fine nudge (~15% lock), a hold
  // builds to full over ~0.7s. Attack also softens slightly with speed.
  // Release stays quick so flick-corrections unwind without auto-pilot feel.
  if (Math.sign(input.steer) !== Math.sign(state.steerHeld) || input.steer === 0) {
    state.steerHeld = 0
  }
  state.steerHeld += Math.sign(input.steer) * dt
  const held = Math.abs(state.steerHeld)
  const speedSoft = 1 / (1 + state.v / 900)
  const attackRate = (1.8 + Math.min(1, held / 0.65) * 5.5) * (0.7 + 0.3 * speedSoft)
  const rate = attacking ? attackRate : 7
  state.steerSmooth += clamp(steerTarget - state.steerSmooth, -rate * dt, rate * dt)

  // T131: steering authority falls off with speed — no hairpin snaps at
  // 900 kph; low speed keeps the full nose-in carve
  const grip = 1 / (1 + state.v / 150)
  const airGrip = state.airborne ? 0.4 : 1
  const targetYaw = state.steerSmooth * 0.42 * (0.5 + grip) * airGrip
  // T143: yaw answers the stick faster — the ship obeys, the track resists less
  state.yaw += (targetYaw - state.yaw) * Math.min(1, dt * 12)

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
  // carve feel v2: drift coefficient softens with speed (timescale fix — the
  // sweeper pulls you outward over seconds, you ride between lines instead of
  // getting smashed wall-to-wall). Carve assist trimmed to 0.2: a trim, not
  // an autopilot — holding the line is the player's job.
  // T169: drift grows v² up to 320 m/s then linear
  const drift = k * state.v * Math.min(state.v, 320) * driftCoeff(state.v) * (1 - 0.2 * carveAlign) * bankGrip
  // T65 traction: lateral velocity converges toward demand at a grip rate —
  // slower base bite = floatier glide between lines; airbrakes still snap it
  const tractionRate = 3.5 + braking * 6 + carveAlign * 1.5
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
    // T131: momentum carries you off the edge — the plunge arcs forward,
    // the RESPAWN is what sets you back
    state.s += state.v * dt * 0.7
    state.v = Math.max(0, state.v - state.v * 0.4 * dt)
    state.time += dt
    if (state.air < -14) {
      // bottom of the plunge → BOOM down there, then the T115 setback
      // (startWreck keeps fallS — respawn lands behind the edge you missed)
      startWreck(state, state.fallS, events)
      state.vy = 0
    }
    return
  }
  if (!hasWall && Math.abs(state.d) > limitHere + 1.2 && !state.airborne) {
    state.falling = true
    state.fallS = state.s
    state.vy = -2
    return
  }

  // V16 airtime: when the road falls away faster than gravity pulls, fly
  const slopeHere = slopeAt(frames, i)
  // T60 → T155: entering a twist zone (loop/corkscrew — track-up tilted off
  // world-up) while airborne. Low = the field CAPTURES you, air bleeding off
  // smoothly. High = you miss the entry — slammed and reset before the zone.
  const upY = frames.normals[Math.min(frames.count - 1, Math.max(0, i)) * 3 + 1]
  if (state.airborne && upY < 0.45) {
    // T157: committed descent counts — diving steeply toward the deck
    // (vy < −6) gets captured up to 12m; only floating HIGH gets the reset
    const diving = state.vy < -6 && state.air < 12
    if (state.air > 6.5 && !diving) {
      // missed the capture window — slammed: explosion, then reset before
      // the twist zone (anchor +10 so the −40 setback lands at start −30)
      let anchorS = state.s
      for (const sg of track.segments) {
        if (state.s >= sg.start && state.s < sg.end) {
          anchorS = sg.start + 10
          break
        }
      }
      startWreck(state, anchorS, events)
      state.airborne = false
      return
    }
    state.airborne = false
    state.vy = 0
    // air kept — decays in the grounded branch below (no teleport snap)
  }
  // T155: soft capture — residual air rides down to the deck over ~0.3s
  if (!state.airborne && !state.falling && state.air > 0) {
    state.air = Math.max(0, state.air - state.air * Math.min(1, dt * 9) - dt * 1.5)
  }
  if (!state.airborne) {
    const slopeAhead = slopeAt(frames, i + 2)
    const dSlope = slopeAhead - slopeHere
    // T171: takeoff needs a REAL crest — at hyperspeed v amplifies any
    // undulation past the old gravity threshold, popping the ship airborne
    // constantly. Absolute slope-break gate keeps ordinary waves grounded.
    if (dSlope * state.v < -GRAVITY * dt * 3 && dSlope < -0.02 && state.v > 30 && upY > 0.45) {
      state.airborne = true
      state.vy = state.v * slopeHere
      state.air = 0
      events.takeoff = true
    }
  } else {
    // T156: retro while airborne pulls you DOWN — dump height to make a
    // capture gate or shorten a jump.
    // T171: downforce ∝ speed — hyperspeed hops get pressed back to deck
    const downforce = GRAVITY * (1 + state.v / 500)
    state.vy -= (downforce + retro * 30) * dt
    state.air += (state.vy - state.v * slopeHere) * dt
    // flying off the SIDE of a rail-less section = off course → plunge
    // (grounded ships fall at limit+1.2; airborne lateral was unbounded)
    if (!hasWall && Math.abs(state.d) > limitHere + 4) {
      state.falling = true
      state.fallS = state.s
      state.airborne = false
      return
    }
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
      // graded but REAL malus: shallow graze ~10-15%, square slam up to 38% —
      // walls are the price of a missed line, not a rumble strip
      state.v *= Math.max(0.62, 1 - impact * 0.02)
      state.yaw *= 0.5
      drainEnergy(state, 0.05 + impact * 0.004)
      events.wallHit = true
      events.wallImpact = impact
      state.wallHits++
      state.onWall = true
    } else {
      state.v = Math.max(0, state.v - state.v * 0.55 * dt)
      drainEnergy(state, 0.06 * dt) // grinding sands the hull down
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
        state.boost = 0.9 // T170: smaller punch — chains matter
        state.v += 15
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
