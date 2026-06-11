import { describe, expect, it } from 'vitest'
import { generateTrack } from '../track/generate'
import { sampleTrack } from '../track/sample'
import { initialShip, shipVmax, stepShip, PHYSICS_DT, type ShipInput, type StepEvents } from '../physics/ship'
import { accumulateSteps } from '../physics/loop'
import type { AudioFeatures } from '../audio/analyze'

function features(duration = 60): AudioFeatures {
  const frameInterval = 1024 / 44100
  const frames = Math.floor(duration / frameInterval)
  return {
    duration,
    sampleRate: 44100,
    bpm: 120,
    energy: new Float32Array(frames).fill(0.6),
    centroid: new Float32Array(frames).fill(0.5),
    frameInterval,
    onsets: Array.from({ length: 100 }, (_, i) => i * 0.6),
    sections: [
      { start: 0, end: 30, energy: 0.7, brightness: 0.5 },
      { start: 30, end: 60, energy: 0.3, brightness: 0.3 },
    ],
    mood: 'energetic',
    intensity: 0.6,
    events: [],
  }
}

const noEvents = (): StepEvents => ({
  wallHit: false,
  wallImpact: 0,
  boostFired: false,
  finished: false,
  takeoff: false,
  landed: false,
  landImpact: 0,
  respawned: false,
})

function scriptedInput(step: number): ShipInput {
  return {
    steer: Math.sin(step / 60) * 0.8,
    thrust: 1,
    brakeLeft: step % 400 < 30,
    brakeRight: false,
  }
}

describe('ship physics (T5, V5)', () => {
  const track = generateTrack(features())
  const frames = sampleTrack(track, 3)

  it('V5: identical input sequence → bit-identical state', () => {
    const a = initialShip()
    const b = initialShip()
    const ev = noEvents()
    for (let i = 0; i < 5000; i++) {
      stepShip(a, scriptedInput(i), track, frames, ev)
    }
    for (let i = 0; i < 5000; i++) {
      stepShip(b, scriptedInput(i), track, frames, ev)
    }
    expect(a).toEqual(b)
  })

  it('V5: accumulator yields same step count regardless of frame chunking', () => {
    // 2.5 simulated seconds delivered as 60fps vs ragged chunks
    const even = { acc: 0 }
    const ragged = { acc: 0 }
    let stepsEven = 0
    let stepsRagged = 0
    for (let i = 0; i < 150; i++) stepsEven += accumulateSteps(even, 1 / 60)
    const chunks = [0.013, 0.021, 0.008, 0.033, 0.025]
    let t = 0
    let ci = 0
    while (t < 2.5 - 1e-9) {
      const dt = Math.min(chunks[ci++ % chunks.length], 2.5 - t)
      t += dt
      stepsRagged += accumulateSteps(ragged, dt)
    }
    // both consumed exactly 2.5s of sim time → equal whole steps (±1 for residue)
    expect(Math.abs(stepsEven - stepsRagged)).toBeLessThanOrEqual(1)
  })

  it('ship stays inside walls forever', () => {
    const ship = initialShip()
    const ev = noEvents()
    for (let i = 0; i < 20000; i++) {
      stepShip(ship, { steer: 1, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
      // T77: walls follow the LOCAL width (speedway 1.6×, wallride 1.15×…).
      // +0.5m transition tolerance (clamp uses the pre-advance sample).
      // T78: rail-less ridges have NO walls — there the edge margin is the
      // falloff threshold (+1.2m) before the ship plunges instead.
      // T131: while plunging off a ridge the ship is legitimately outside
      // the road — walls only bind grounded ships
      if (ship.falling) continue
      const fi = Math.min(frames.count - 1, Math.max(0, Math.round(ship.s / frames.ds)))
      const limit = (track.width * frames.widths[fi]) / 2
      const margin = frames.walls[fi] > 0.5 ? 0.5 : 1.8
      expect(Math.abs(ship.d)).toBeLessThanOrEqual(limit + margin)
    }
  })

  it('reaches finish and stops (V2 runtime side)', () => {
    const ship = initialShip()
    const ev = noEvents()
    const maxSteps = Math.ceil((track.duration * 4) / PHYSICS_DT)
    let finishedAt = -1
    for (let i = 0; i < maxSteps; i++) {
      stepShip(ship, { steer: 0, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
      if (ev.finished) {
        finishedAt = ship.time
        break
      }
    }
    expect(finishedAt).toBeGreaterThan(0)
    expect(ship.finished).toBe(true)
    expect(ship.s).toBe(track.length)
    // post-finish steps are no-ops
    const frozen = { ...ship }
    stepShip(ship, { steer: 1, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
    expect(ship).toEqual(frozen)
  })

  it('V12: speed never exceeds 1.1 × boosted vmax, even chaining pads', () => {
    const ship = initialShip()
    const ev = noEvents()
    const cap = shipVmax(track.avgSpeed, true) * 1.1
    const maxSteps = Math.ceil((track.duration * 4) / PHYSICS_DT)
    for (let i = 0; i < maxSteps && !ship.finished; i++) {
      stepShip(ship, { steer: 0, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
      expect(ship.v).toBeLessThanOrEqual(cap)
    }
  })

  it('boost pads fire at most once each', () => {
    const ship = initialShip()
    const ev = noEvents()
    let fired = 0
    const maxSteps = Math.ceil((track.duration * 4) / PHYSICS_DT)
    for (let i = 0; i < maxSteps && !ship.finished; i++) {
      stepShip(ship, { steer: 0, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
      if (ev.boostFired) fired++
    }
    expect(fired).toBe(ship.boostsHit)
    expect(fired).toBeLessThanOrEqual(track.boosts.length)
  })
})

describe('airtime (T26, V16)', () => {
  const dropFeatures = (): AudioFeatures => ({
    ...features(60),
    events: [{ type: 'drop', start: 20, end: 21, strength: 1 }],
  })

  it('drop event → crest → ship gains airtime ≥ 0.25s and lands clean', () => {
    const track = generateTrack(dropFeatures())
    expect(track.segments.some((sg) => sg.type === 'jump')).toBe(true)

    const frames = sampleTrack(track, 3)
    const ship = initialShip()
    const ev = noEvents()
    let airSteps = 0
    let tookOff = false
    let landed = false
    const maxSteps = Math.ceil((track.duration * 4) / PHYSICS_DT)
    for (let i = 0; i < maxSteps && !ship.finished; i++) {
      stepShip(ship, { steer: 0, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
      if (ev.takeoff) tookOff = true
      if (ship.airborne) airSteps++
      if (ev.landed) landed = true
      expect(ship.air).toBeGreaterThanOrEqual(0)
    }
    expect(tookOff).toBe(true)
    expect(landed).toBe(true)
    expect(airSteps * PHYSICS_DT).toBeGreaterThanOrEqual(0.25)
    expect(ship.finished).toBe(true)
  })
})

describe('vertical loops (R9b/T104)', () => {
  // hot, onset-dense everywhere → loops spawn (see frames.test.ts)
  const loopFeatures = (): AudioFeatures => ({
    ...features(180),
    bpm: 128,
    intensity: 0.7,
    onsets: Array.from({ length: 359 }, (_, i) => 0.5 + i * 0.5),
    sections: [
      { start: 0, end: 60, energy: 0.75, brightness: 0.5 },
      { start: 60, end: 120, energy: 0.4, brightness: 0.4 },
      { start: 120, end: 180, energy: 0.8, brightness: 0.6 },
    ],
  })

  it('T155: airborne HIGH into a loop → crash-reset 30m before the zone', () => {
    const track = generateTrack(loopFeatures())
    const loop = track.segments.find((sg) => sg.type === 'loop')!
    const frames = sampleTrack(track, 3)
    const ship = initialShip()
    const ev = noEvents()
    // fake a high flight crossing into the twist zone
    ship.s = loop.start + 110
    ship.v = track.avgSpeed
    ship.airborne = true
    ship.air = 8
    ship.vy = 0
    stepShip(ship, { steer: 0, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
    expect(ev.respawned).toBe(true)
    expect(ship.s).toBeLessThanOrEqual(loop.start - 30 + 1e-6)
    expect(ship.airborne).toBe(false)
  })

  it('T155: airborne LOW into a loop → soft capture, air bleeds (no teleport)', () => {
    const track = generateTrack(loopFeatures())
    const loop = track.segments.find((sg) => sg.type === 'loop')!
    const frames = sampleTrack(track, 3)
    const ship = initialShip()
    const ev = noEvents()
    ship.s = loop.start + 110
    ship.v = track.avgSpeed
    ship.airborne = true
    ship.air = 2.5
    ship.vy = 0
    stepShip(ship, { steer: 0, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
    expect(ev.respawned).toBe(false)
    expect(ship.airborne).toBe(false)
    expect(ship.air).toBeGreaterThan(0) // NOT snapped to deck
    expect(ship.air).toBeLessThan(2.5) // but bleeding down
    // a few more steps → settled
    for (let k = 0; k < 60; k++) {
      stepShip(ship, { steer: 0, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
    }
    expect(ship.air).toBeLessThan(0.05)
  })

  it('ship rides a full loop: no fall, no NaN, V12 cap holds', () => {
    const track = generateTrack(loopFeatures())
    const loop = track.segments.find((sg) => sg.type === 'loop')
    expect(loop).toBeDefined()

    const frames = sampleTrack(track, 3)
    const ship = initialShip()
    const ev = noEvents()
    // drop in just before the loop at design pace
    ship.s = Math.max(0, loop!.start - 200)
    ship.v = track.avgSpeed
    const cap = shipVmax(track.avgSpeed, true) * 1.1
    const maxSteps = Math.ceil(120 / PHYSICS_DT)
    let prevS = ship.s
    for (let i = 0; i < maxSteps && !ship.finished; i++) {
      stepShip(ship, { steer: 0, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
      if (ship.s > loop!.end + 100) break
      expect(Number.isFinite(ship.s)).toBe(true)
      expect(Number.isFinite(ship.d)).toBe(true)
      expect(Number.isFinite(ship.v)).toBe(true)
      expect(ship.v).toBeLessThanOrEqual(cap)
      expect(ship.falling).toBe(false) // loop has walls — the field holds you
      expect(ship.s).toBeGreaterThanOrEqual(prevS)
      prevS = ship.s
    }
    expect(prevS).toBeGreaterThan(loop!.end) // made it through, no stall
  })
})

describe('retro brake (T156)', () => {
  const track = generateTrack(features())
  const frames = sampleTrack(track, 3)

  const run = (input: Partial<ShipInput>, prep = 600, steps = 120) => {
    const ship = initialShip()
    const ev = noEvents()
    for (let i = 0; i < prep; i++) {
      stepShip(ship, { steer: 0, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
    }
    const v0 = ship.v
    for (let i = 0; i < steps; i++) {
      stepShip(ship, { steer: 0, thrust: 0, brakeLeft: false, brakeRight: false, ...input }, track, frames, ev)
    }
    return { v0, ship }
  }

  it('decelerates much harder than coasting', () => {
    const coast = run({})
    const retro = run({ retro: true })
    expect(retro.ship.v).toBeLessThan(coast.ship.v * 0.8)
  })

  it('airborne retro sinks faster (slower AND lower)', () => {
    const fly = (retro: boolean) => {
      const ship = initialShip()
      const ev = noEvents()
      ship.s = 500
      ship.v = track.avgSpeed
      ship.airborne = true
      ship.air = 10
      ship.vy = 0
      for (let i = 0; i < 30 && ship.airborne; i++) {
        stepShip(ship, { steer: 0, thrust: 0, brakeLeft: false, brakeRight: false, retro }, track, frames, ev)
      }
      return ship
    }
    const free = fly(false)
    const sunk = fly(true)
    expect(sunk.air).toBeLessThan(free.air)
    expect(sunk.v).toBeLessThan(free.v)
  })
})

describe('steer ramp (T27, B7)', () => {
  const track = generateTrack(features())
  const frames = sampleTrack(track, 3)

  it('full steer input takes time to reach full authority', () => {
    const ship = initialShip()
    const ev = noEvents()
    // get moving first
    for (let i = 0; i < 600; i++) {
      stepShip(ship, { steer: 0, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
    }
    // one 60Hz-frame worth of full steer (2 physics steps) — barely moves
    stepShip(ship, { steer: 1, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
    stepShip(ship, { steer: 1, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
    expect(Math.abs(ship.steerSmooth)).toBeLessThan(0.1)
    // half a second of holding → meaningful authority
    for (let i = 0; i < 58; i++) {
      stepShip(ship, { steer: 1, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
    }
    expect(ship.steerSmooth).toBeGreaterThan(0.8)
  })
})

describe('track sampling (T4)', () => {
  const track = generateTrack(features())
  const frames = sampleTrack(track, 3)

  it('produces finite frames covering full length', () => {
    expect(frames.length).toBeGreaterThan(track.length * 0.5)
    for (let i = 0; i < frames.count * 3; i++) {
      expect(Number.isFinite(frames.positions[i])).toBe(true)
      expect(Number.isFinite(frames.tangents[i])).toBe(true)
      expect(Number.isFinite(frames.normals[i])).toBe(true)
      expect(Number.isFinite(frames.binormals[i])).toBe(true)
    }
  })

  it('frames are orthonormal within tolerance', () => {
    for (let i = 0; i < frames.count; i += 50) {
      const dot =
        frames.tangents[i * 3] * frames.normals[i * 3] +
        frames.tangents[i * 3 + 1] * frames.normals[i * 3 + 1] +
        frames.tangents[i * 3 + 2] * frames.normals[i * 3 + 2]
      expect(Math.abs(dot)).toBeLessThan(0.01)
    }
  })
})
