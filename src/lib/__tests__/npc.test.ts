import { describe, expect, it } from 'vitest'
import { generateTrack } from '../track/generate'
import { sampleTrack } from '../track/sample'
import { initialNpc, makeNpcs, racePosition, resolveCollisions, stepNpc, type NpcState } from '../physics/npc'
import { computeLean } from '../physics/ship'
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

const track = generateTrack(features())
const frames = sampleTrack(track, 3)

describe('NPC racers (T20, V13, V15)', () => {
  it('V15: specs and full sim runs are deterministic', () => {
    const specsA = makeNpcs(track)
    const specsB = makeNpcs(track)
    expect(specsA).toEqual(specsB)

    const run = () => {
      const states = specsA.map((_, i) => initialNpc(i))
      for (let step = 0; step < 10000; step++) {
        for (let i = 0; i < states.length; i++) stepNpc(states[i], specsA[i], track, frames)
      }
      return states
    }
    expect(run()).toEqual(run())
  })

  it('NPCs stay within walls and finish eventually', () => {
    const specs = makeNpcs(track)
    const states = specs.map((_, i) => initialNpc(i))
    const halfW = track.width / 2
    const maxSteps = 120 * 240 // 4 sim-minutes
    for (let step = 0; step < maxSteps; step++) {
      for (let i = 0; i < states.length; i++) {
        stepNpc(states[i], specs[i], track, frames)
        expect(Math.abs(states[i].d)).toBeLessThanOrEqual(halfW)
      }
    }
    expect(states.every((s) => s.finished)).toBe(true)
  })

  it('V13: racePosition counts racers strictly ahead', () => {
    const mk = (s: number): NpcState => ({ s, d: 0, v: 0, time: 0, finished: false })
    expect(racePosition(100, [mk(50), mk(99.9), mk(101), mk(500)])).toBe(3)
    expect(racePosition(600, [mk(50), mk(99.9), mk(101), mk(500)])).toBe(1)
    expect(racePosition(0, [mk(1), mk(2), mk(3)])).toBe(4)
    expect(racePosition(100, [mk(100)])).toBe(1) // ties don't count as ahead
  })

  it('faster pace specs run ahead of slower ones on open road', () => {
    const specs = makeNpcs(track)
    const states = specs.map(() => ({ s: 0, d: 0, v: 0, time: 0, finished: false }))
    for (let step = 0; step < 120 * 30; step++) {
      for (let i = 0; i < states.length; i++) stepNpc(states[i], specs[i], track, frames)
    }
    // spec[0] has the highest base pace — expect it in front
    const maxS = Math.max(...states.map((s) => s.s))
    expect(states[0].s).toBe(maxS)
  })
})

describe('computeLean (V18, amends V14)', () => {
  it('steering right banks right (positive)', () => {
    expect(computeLean(0.5, 100)).toBeGreaterThan(0)
  })
  it('B6: no steer → no lean, at any speed', () => {
    expect(computeLean(0, 50)).toBe(0)
    expect(computeLean(0, 300)).toBe(0)
  })
  it('left steer banks left (negative)', () => {
    expect(computeLean(-0.5, 100)).toBeLessThan(0)
  })
})

describe('collisions (T32, V17)', () => {
  const makeRacers = () => [
    { s: 100, d: 0, v: 200 },
    { s: 103, d: 1.2, v: 120 },
    { s: 50, d: 0, v: 80 }, // far away, untouched
  ]

  it('deterministic, no energy creation, walls respected', () => {
    const a = makeRacers()
    const b = makeRacers()
    const ia = resolveCollisions(a, track)
    const ib = resolveCollisions(b, track)
    expect(a).toEqual(b)
    expect(ia).toBe(ib)
    expect(ia).toBeGreaterThan(0) // racers 0 and 1 overlap → player impact

    const sumBefore = makeRacers().reduce((x, r) => x + r.v, 0)
    const sumAfter = a.reduce((x, r) => x + r.v, 0)
    expect(sumAfter).toBeLessThanOrEqual(sumBefore + 1e-9)

    const limit = track.width / 2 - 1.5
    for (const r of a) expect(Math.abs(r.d)).toBeLessThanOrEqual(limit + 1e-9)
    // distant racer untouched
    expect(a[2]).toEqual(makeRacers()[2])
  })

  it('faster ship slows, slower ship speeds up (energy transfer)', () => {
    const racers = [
      { s: 100, d: 0, v: 200 },
      { s: 102, d: 0.5, v: 100 },
    ]
    resolveCollisions(racers, track)
    expect(racers[0].v).toBeLessThan(200)
    expect(racers[1].v).toBeGreaterThan(100)
  })
})
