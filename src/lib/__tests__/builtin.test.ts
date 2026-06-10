import { describe, expect, it } from 'vitest'
import { BUILTIN_SONGS, renderSong, SR } from '../audio/builtin'
import { analyzeAudio } from '../audio/analyze'
import { generateTrack } from '../track/generate'

describe('built-in songs (T12)', () => {
  it('render deterministically (V1 end to end)', () => {
    const spec = BUILTIN_SONGS[0]
    const short = { ...spec, seconds: 20 }
    const a = renderSong(short)
    const b = renderSong(short)
    expect(a).toEqual(b)
  })

  it('V11: analyzed bpm within 8% of spec bpm for every builtin song', () => {
    for (const spec of BUILTIN_SONGS) {
      const pcm = renderSong({ ...spec, seconds: 40 })
      const { bpm } = analyzeAudio(pcm, SR)
      const ratio = bpm / spec.bpm
      expect(ratio, `${spec.title}: analyzed ${bpm} vs spec ${spec.bpm}`).toBeGreaterThanOrEqual(0.92)
      expect(ratio, `${spec.title}: analyzed ${bpm} vs spec ${spec.bpm}`).toBeLessThanOrEqual(1.08)
    }
  })

  it('every song renders, analyzes, and generates a valid track', () => {
    for (const spec of BUILTIN_SONGS) {
      const short = { ...spec, seconds: 30 } // keep test time sane
      const pcm = renderSong(short)
      expect(pcm.length).toBe(SR * 30)
      let peak = 0
      for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]))
      expect(peak).toBeGreaterThan(0.1)
      expect(peak).toBeLessThanOrEqual(1)

      const features = analyzeAudio(pcm, SR)
      const track = generateTrack(features)
      expect(track.length).toBeGreaterThan(0)
      expect(track.segments.length).toBeGreaterThan(0)
    }
  })
})
