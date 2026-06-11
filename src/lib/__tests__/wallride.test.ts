import { describe, it, expect } from 'vitest'
import { generateTrack } from '../track/generate'
import { sampleTrack } from '../track/sample'
import { initialShip, stepShip, type StepEvents } from '../physics/ship'
import type { AudioFeatures } from '../audio/analyze'
describe('wallrides (T92/T165, B32)', () => {
it('banks apply: 60° standard, ~84° vertical variant; ship rides clean', () => {
  const duration = 180
  const frameInterval = 1024 / 44100
  const onsets: number[] = []
  for (let t = 0.5; t < duration; t += 0.5) onsets.push(t)
  const f: AudioFeatures = {
    duration, sampleRate: 44100, bpm: 128,
    energy: new Float32Array(Math.floor(duration / frameInterval)).fill(0.7),
    centroid: new Float32Array(Math.floor(duration / frameInterval)).fill(0.5),
    frameInterval, onsets,
    sections: [
      { start: 0, end: 60, energy: 0.75, brightness: 0.5 },
      { start: 60, end: 120, energy: 0.4, brightness: 0.4 },
      { start: 120, end: 180, energy: 0.8, brightness: 0.6 },
    ],
    mood: 'energetic', intensity: 0.7, events: [],
  }
  const track = generateTrack(f)
  const frames = sampleTrack(track, 3)
  // find a wallride where upY dips below cos(1.3) ≈ 0.27 → vertical variant
  let vwall: { start: number; end: number } | null = null
  const rides: string[] = []
  for (const seg of track.segments) {
    if (seg.type !== 'wallride') continue
    let minNy = 1
    for (let i = Math.ceil(seg.start / frames.ds); i < seg.end / frames.ds; i++) {
      minNy = Math.min(minNy, Math.abs(frames.normals[i * 3 + 1]))
    }
    rides.push((seg.start | 0) + ':ny' + minNy.toFixed(2))
    if (minNy < 0.27) vwall = seg
  }
  console.log('wallrides:', rides.join(' '))
  expect(vwall).not.toBeNull()
  console.log('vertical wallride @', vwall!.start | 0, '-', vwall!.end | 0)
  // ride it
  const ship = initialShip()
  const ev: StepEvents = { wallHit: false, wallImpact: 0, boostFired: false, finished: false, takeoff: false, landed: false, landImpact: 0, respawned: false, exploded: false }
  ship.s = Math.max(0, vwall!.start - 150)
  ship.v = track.avgSpeed
  let prevS = ship.s
  while (ship.s < vwall!.end + 60 && ship.time < 60) {
    stepShip(ship, { steer: 0, thrust: 1, brakeLeft: false, brakeRight: false }, track, frames, ev)
    expect(Number.isFinite(ship.d)).toBe(true)
    expect(ship.falling).toBe(false)
    expect(ship.s).toBeGreaterThanOrEqual(prevS)
    prevS = ship.s
  }
  expect(prevS).toBeGreaterThan(vwall!.end)
  console.log('rode the wall clean')
})
})
