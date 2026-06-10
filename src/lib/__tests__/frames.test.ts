import { describe, expect, it } from 'vitest'
import { generateTrack } from '../track/generate'
import { sampleTrack } from '../track/sample'
import type { AudioFeatures } from '../audio/analyze'

/**
 * R9b/T104: frame integrity through full vertical loops. The world-up
 * projection that built frames before T104 degenerates when the tangent
 * goes vertical; these tests pin the ups-interpolated frames: finite,
 * orthonormal, continuous, and actually inverted at loop apexes.
 */

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

describe('track frames (R9b/T104)', () => {
  const track = generateTrack(fakeFeatures())
  const frames = sampleTrack(track, 3)

  it('spawns at least one loop segment for hot, onset-dense music', () => {
    expect(track.segments.some((s) => s.type === 'loop')).toBe(true)
  })

  it('ups cover every control point', () => {
    expect(track.ups.length).toBe(track.points.length * 3)
  })

  it('every frame is finite and orthonormal', () => {
    for (let i = 0; i < frames.count; i++) {
      const tx = frames.tangents[i * 3]
      const ty = frames.tangents[i * 3 + 1]
      const tz = frames.tangents[i * 3 + 2]
      const nx = frames.normals[i * 3]
      const ny = frames.normals[i * 3 + 1]
      const nz = frames.normals[i * 3 + 2]
      for (const v of [tx, ty, tz, nx, ny, nz]) expect(Number.isFinite(v)).toBe(true)
      expect(Math.hypot(tx, ty, tz)).toBeCloseTo(1, 3)
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 3)
      expect(Math.abs(tx * nx + ty * ny + tz * nz)).toBeLessThan(1e-3)
    }
  })

  it('frames are continuous — no flips between adjacent samples', () => {
    for (let i = 1; i < frames.count; i++) {
      const dot =
        frames.normals[(i - 1) * 3] * frames.normals[i * 3] +
        frames.normals[(i - 1) * 3 + 1] * frames.normals[i * 3 + 1] +
        frames.normals[(i - 1) * 3 + 2] * frames.normals[i * 3 + 2]
      expect(dot).toBeGreaterThan(0.8)
    }
  })

  it('loop apex inverts track-up (ny < -0.5 somewhere inside a loop)', () => {
    const loop = track.segments.find((s) => s.type === 'loop')!
    let minNy = 1
    for (let i = 0; i < frames.count; i++) {
      const s = i * frames.ds
      if (s < loop.start || s > loop.end) continue
      minNy = Math.min(minNy, frames.normals[i * 3 + 1])
    }
    expect(minNy).toBeLessThan(-0.5)
  })

  it('V1: identical features → identical frames', () => {
    const again = sampleTrack(generateTrack(fakeFeatures()), 3)
    expect(again.positions).toEqual(frames.positions)
    expect(again.normals).toEqual(frames.normals)
  })

  it('non-loop tracks keep world-up frames (no behavior drift)', () => {
    const calm = generateTrack(
      fakeFeatures({
        intensity: 0.2,
        bpm: 80,
        mood: 'chill',
        onsets: [],
        sections: [{ start: 0, end: 180, energy: 0.2, brightness: 0.3 }],
      }),
    )
    expect(calm.segments.some((s) => s.type === 'loop')).toBe(false)
    const f = sampleTrack(calm, 3)
    for (let i = 0; i < f.count; i++) {
      expect(f.normals[i * 3 + 1]).toBeGreaterThan(0.9)
    }
  })
})
