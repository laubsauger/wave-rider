import { describe, expect, it } from 'vitest'
import { analyzeAudio } from '../audio/analyze'

const SR = 44100

/**
 * Synthetic song: 30s, kick clicks at given bpm, quiet first half /
 * loud bright second half so sectioning has a real boundary.
 * Deterministic — no Math.random.
 */
function synthSong(bpm: number, seconds = 30): Float32Array {
  const n = SR * seconds
  const pcm = new Float32Array(n)
  const beatInterval = (60 / bpm) * SR

  // tonal bed: low sine first half, brighter saw-ish mix second half
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const half = i < n / 2
    const amp = half ? 0.08 : 0.3
    let v = Math.sin(2 * Math.PI * 110 * t) * amp
    if (!half) {
      v += Math.sin(2 * Math.PI * 880 * t) * 0.15 + Math.sin(2 * Math.PI * 1760 * t) * 0.08
    }
    pcm[i] = v
  }

  // kicks: exponentially decaying bursts on the beat
  for (let b = 0; b * beatInterval < n; b++) {
    const start = Math.round(b * beatInterval)
    for (let i = 0; i < 2000 && start + i < n; i++) {
      pcm[start + i] += Math.sin(2 * Math.PI * 60 * (i / SR)) * Math.exp(-i / 300) * 0.9
    }
  }
  return pcm
}

describe('analyzeAudio (T2: C5 determinism, feature quality)', () => {
  it('is deterministic: same PCM → deep-equal features (V1 upstream)', () => {
    const pcm = synthSong(128)
    const a = analyzeAudio(pcm.slice(), SR)
    const b = analyzeAudio(pcm.slice(), SR)
    expect(a.bpm).toBe(b.bpm)
    expect(a.onsets).toEqual(b.onsets)
    expect(a.sections).toEqual(b.sections)
    expect(Array.from(a.energy)).toEqual(Array.from(b.energy))
    expect(a.mood).toBe(b.mood)
    expect(a.intensity).toBe(b.intensity)
  })

  it('recovers tempo of a click track within tolerance (or octave)', () => {
    const { bpm } = analyzeAudio(synthSong(120), SR)
    const candidates = [60, 120, 240]
    const ok = candidates.some((c) => Math.abs(bpm - c) <= 4)
    expect(ok, `bpm ${bpm} not near 60/120/240`).toBe(true)
  })

  it('detects onsets roughly at beat rate', () => {
    const f = analyzeAudio(synthSong(120), SR)
    // 30s @ 120bpm = 60 beats; flux peaks should catch most
    expect(f.onsets.length).toBeGreaterThan(30)
    expect(f.onsets.length).toBeLessThan(120)
  })

  it('splits quiet/loud halves into multiple sections with rising energy', () => {
    const f = analyzeAudio(synthSong(120), SR)
    expect(f.sections.length).toBeGreaterThanOrEqual(2)
    const first = f.sections[0]
    const last = f.sections[f.sections.length - 1]
    expect(last.energy).toBeGreaterThan(first.energy)
  })

  it('T24: finds the breakdown (quiet half) and the drop (loud slam)', () => {
    const f = analyzeAudio(synthSong(120), SR)
    const breakdowns = f.events.filter((e) => e.type === 'breakdown')
    const drops = f.events.filter((e) => e.type === 'drop')
    expect(breakdowns.length).toBeGreaterThanOrEqual(1)
    expect(breakdowns[0].start).toBeLessThan(8)
    expect(drops.length).toBeGreaterThanOrEqual(1)
    // halves switch at 15s — the drop should land near it
    expect(drops.some((d) => d.start > 13 && d.start < 20)).toBe(true)
  })

  it('throws on too-short input instead of guessing', () => {
    expect(() => analyzeAudio(new Float32Array(1000), SR)).toThrow()
  })
})
