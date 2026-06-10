import { afterEach, describe, expect, it } from 'vitest'
import { generateTrack, songTimeToS, sToSongTime } from '../track/generate'
import type { AudioFeatures } from '../audio/analyze'

function fakeFeatures(overrides: Partial<AudioFeatures> = {}): AudioFeatures {
  const duration = 180
  const frameInterval = 1024 / 44100
  const frames = Math.floor(duration / frameInterval)
  const onsets: number[] = []
  for (let t = 0.5; t < duration; t += 0.5) onsets.push(t)
  return {
    duration,
    sampleRate: 44100,
    bpm: 128,
    energy: new Float32Array(frames).fill(0.7),
    centroid: new Float32Array(frames).fill(0.5),
    frameInterval,
    onsets,
    sections: [
      { start: 0, end: 60, energy: 0.75, brightness: 0.5 },
      { start: 60, end: 120, energy: 0.4, brightness: 0.4 },
      { start: 120, end: 180, energy: 0.8, brightness: 0.6 },
    ],
    mood: 'energetic',
    intensity: 0.7,
    events: [],
    ...overrides,
  }
}

const realRandom = Math.random

afterEach(() => {
  Math.random = realRandom
})

describe('generateTrack (T3)', () => {
  it('V1: identical features → deep-equal TrackData', () => {
    const a = generateTrack(fakeFeatures())
    const b = generateTrack(fakeFeatures())
    expect(a).toEqual(b)
  })

  it('V8: never calls Math.random', () => {
    Math.random = () => {
      throw new Error('Math.random reached track gen path (V8 violation)')
    }
    expect(() => generateTrack(fakeFeatures())).not.toThrow()
  })

  it('V2: track length matches song duration at design speed', () => {
    const t = generateTrack(fakeFeatures())
    expect(t.length / t.avgSpeed).toBeCloseTo(t.duration, 5)
    // segments cover the whole length without gaps
    const covered = t.segments.reduce((acc, s) => acc + (s.end - s.start), 0)
    expect(covered).toBeCloseTo(t.length, 0)
  })

  it('V9: song-time ↔ track-position mapping round-trips within 250ms', () => {
    const t = generateTrack(fakeFeatures())
    for (const time of [0, 1, 45.5, 90, 179.9, 180]) {
      const s = songTimeToS(t, time)
      expect(Math.abs(sToSongTime(t, s) - time)).toBeLessThanOrEqual(0.25)
    }
  })

  it('V3: intense music → faster design speed than chill music', () => {
    const hot = generateTrack(fakeFeatures({ intensity: 0.9, bpm: 170, mood: 'aggressive' }))
    const cold = generateTrack(
      fakeFeatures({
        intensity: 0.15,
        bpm: 75,
        mood: 'chill',
        sections: [{ start: 0, end: 180, energy: 0.15, brightness: 0.2 }],
      }),
    )
    expect(hot.avgSpeed).toBeGreaterThan(cold.avgSpeed)
  })

  it('V3: onset-dense high-energy sections produce chicanes, calm tracks none', () => {
    const hot = generateTrack(fakeFeatures({ onsets: range(0.25, 180, 0.25) }))
    expect(hot.segments.some((s) => s.type === 'chicane')).toBe(true)

    const cold = generateTrack(
      fakeFeatures({
        intensity: 0.1,
        bpm: 70,
        mood: 'chill',
        onsets: range(2, 180, 4),
        sections: [{ start: 0, end: 180, energy: 0.15, brightness: 0.2 }],
      }),
    )
    expect(cold.segments.some((s) => s.type === 'chicane')).toBe(false)
  })

  it('V20: curvature speed-scaled — p95 lateral demand rideable at design speed', async () => {
    const { sampleTrack, curvatureAt } = await import('../track/sample')
    const t = generateTrack(fakeFeatures({ intensity: 0.9, bpm: 175 })) // fastest case
    const frames = sampleTrack(t, 3)
    const demands: number[] = []
    for (let i = 10; i < frames.count - 10; i += 3) {
      demands.push(Math.abs(curvatureAt(frames, i)) * t.avgSpeed * t.avgSpeed)
    }
    demands.sort((a, b) => a - b)
    const p95 = demands[Math.floor(demands.length * 0.95)]
    expect(p95).toBeLessThanOrEqual(90)
  })

  it('different songs → different tracks (seed sensitivity)', () => {
    const a = generateTrack(fakeFeatures())
    const b = generateTrack(fakeFeatures({ bpm: 128.1 }))
    expect(a.seed).not.toBe(b.seed)
  })

  it('boost pads stay within track bounds and respect spacing', () => {
    const t = generateTrack(fakeFeatures())
    expect(t.boosts.length).toBeGreaterThan(0)
    // T77: speedway boost rows pack tighter than the 180m base spacing —
    // assert sane bounds + sorted order instead
    for (let i = 0; i < t.boosts.length; i++) {
      expect(t.boosts[i].s).toBeGreaterThan(0)
      expect(t.boosts[i].s).toBeLessThan(t.length)
      if (i > 0) expect(t.boosts[i].s).toBeGreaterThanOrEqual(t.boosts[i - 1].s)
    }
  })
})

function range(start: number, end: number, step: number): number[] {
  const out: number[] = []
  for (let t = start; t < end; t += step) out.push(t)
  return out
}
