import { describe, expect, it } from 'vitest'
import { generateTrack } from '../track/generate'
import { sampleTrack } from '../track/sample'
import { initialShip, stepShip, PHYSICS_DT, type ShipInput, type StepEvents } from '../physics/ship'
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
    onsets: [],
    sections: [{ start: 0, end: duration, energy: 0.7, brightness: 0.5 }],
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
  exploded: false,
})

/** seconds of full-hold until steerSmooth crosses `level` */
function riseTime(analog: boolean, level: number): number {
  const track = generateTrack(features())
  const frames = sampleTrack(track, 4)
  const ship = initialShip()
  const input: ShipInput = { steer: 1, thrust: 0, brakeLeft: false, brakeRight: false, analog }
  const ev = noEvents()
  for (let i = 0; i < 600; i++) {
    stepShip(ship, input, track, frames, ev)
    if (ship.steerSmooth >= level) return (i + 1) * PHYSICS_DT
  }
  return Infinity
}

describe('steer response (T187, B7)', () => {
  it('digital half-lock answers within 150ms (competition feel)', () => {
    const t = riseTime(false, 0.5)
    expect(t).toBeLessThan(0.15)
    // still progressive — not an instant slam (B7: taps nudge)
    expect(t).toBeGreaterThan(0.06)
  })

  it('digital full lock under 300ms', () => {
    expect(riseTime(false, 1)).toBeLessThan(0.3)
  })

  it('analog (touch/NPC) skips the tap-lock — half deflection under 80ms', () => {
    expect(riseTime(true, 0.5)).toBeLessThan(0.08)
  })
})
