import { describe, expect, it } from 'vitest'
import { resolveSongSource } from '../network/lobbySong'
import { BUNDLED_SONGS } from '../audio/bundled'
import { BUILTIN_SONGS } from '../audio/builtin'
import type { UserSong } from '../../game/store'

const userSong: UserSong = {
  id: 'my-upload',
  title: 'MY UPLOAD',
  bpm: 120,
  durationLabel: '3:00',
  waveform: [],
  bytes: new ArrayBuffer(4),
}

describe('lobby song resolution (T182, V27/B38)', () => {
  it('resolves every bundled song by id', () => {
    for (const s of BUNDLED_SONGS) {
      const src = resolveSongSource(s.id, [])
      expect(src).toEqual({ kind: 'bundled', song: s })
    }
  })

  it('resolves synth debug songs by id', () => {
    for (const s of BUILTIN_SONGS) {
      expect(resolveSongSource(s.id, [])).toEqual({ kind: 'synth', spec: s })
    }
  })

  it('resolves user uploads by id', () => {
    expect(resolveSongSource('my-upload', [userSong])).toEqual({ kind: 'custom', song: userSong })
  })

  it('B38: display titles are NOT keys — composed title resolves to nothing', () => {
    expect(resolveSongSource('M.S.O. — NITS', [userSong])).toBeNull()
    expect(resolveSongSource(null, [userSong])).toBeNull()
  })
})
