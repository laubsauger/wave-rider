import { beforeEach, describe, expect, it } from 'vitest'
import { loadRecents, recordRecent, sniffAudioExt, type RecentSong } from '../recents'

// node has no localStorage — minimal in-memory stand-in
const backing = new Map<string, string>()
beforeEach(() => {
  backing.clear()
  globalThis.localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage
})

const meta = (id: string): Omit<RecentSong, 'playedAt'> => ({
  id,
  title: id.toUpperCase(),
  bpm: 120,
  durationLabel: '3:00',
  waveform: [0.1, 0.5, 1],
})

describe('recents (T181, V26)', () => {
  it('records newest-first, dedupes by id, caps at 8', () => {
    for (let i = 0; i < 10; i++) recordRecent(meta(`song-${i}`))
    recordRecent(meta('song-5')) // replay bumps to top
    const r = loadRecents()
    expect(r.length).toBe(8)
    expect(r[0].id).toBe('song-5')
    expect(r.filter((x) => x.id === 'song-5').length).toBe(1)
  })

  it('V26: persisted records carry META only — no byte payloads', () => {
    recordRecent(meta('song-a'))
    const raw = backing.get('wave-rider-recents')!
    expect(raw.length).toBeLessThan(2000)
    expect(JSON.parse(raw)[0]).not.toHaveProperty('bytes')
  })

  it('survives corrupt storage', () => {
    backing.set('wave-rider-recents', '{not json')
    expect(loadRecents()).toEqual([])
  })

  it('sniffs container from magic bytes', () => {
    const buf = (chars: [number, string][]) => {
      const b = new Uint8Array(12)
      for (const [o, s] of chars) for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i)
      return b.buffer
    }
    expect(sniffAudioExt(buf([[0, 'RIFF'], [8, 'WAVE']]))).toBe('wav')
    expect(sniffAudioExt(buf([[0, 'OggS']]))).toBe('ogg')
    expect(sniffAudioExt(buf([[4, 'ftyp']]))).toBe('m4a')
    expect(sniffAudioExt(buf([[0, 'ID3']]))).toBe('mp3')
    expect(sniffAudioExt(new Uint8Array([0xff, 0xfb, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer)).toBe('mp3')
  })
})
