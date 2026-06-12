import { beforeEach, describe, expect, it } from 'vitest'
import { loadRecord, recordKey, saveBestGhost, saveRun, type RunEntry } from '../records'

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

const run = (timeMs: number): RunEntry => ({ timeMs, topSpeed: 100, place: 1, date: timeMs })

describe('track records (T183, V28)', () => {
  it('keeps top-5 sorted ascending, reports rank + newBest', () => {
    const first = saveRun('song', 7, 'SONG', run(90_000))
    expect(first).toEqual({ rank: 1, newBest: true })
    saveRun('song', 7, 'SONG', run(80_000))
    saveRun('song', 7, 'SONG', run(95_000))
    saveRun('song', 7, 'SONG', run(85_000))
    saveRun('song', 7, 'SONG', run(99_000))
    const slow = saveRun('song', 7, 'SONG', run(120_000)) // 6th, slowest
    expect(slow).toEqual({ rank: 0, newBest: false })
    const rec = loadRecord('song', 7)!
    expect(rec.times.map((t) => t.timeMs)).toEqual([80_000, 85_000, 90_000, 95_000, 99_000])
    expect(rec.bestTimeMs).toBe(80_000)
  })

  it('V28: best ghost attaches only to the current best time', () => {
    saveRun('song', 7, 'SONG', run(90_000))
    saveBestGhost('song', 7, 90_000, 'GHOST-A')
    expect(loadRecord('song', 7)!.bestGhost).toBe('GHOST-A')
    // stale ghost for a beaten time must NOT replace
    saveRun('song', 7, 'SONG', run(80_000))
    saveBestGhost('song', 7, 90_000, 'GHOST-STALE')
    expect(loadRecord('song', 7)!.bestGhost).toBe('GHOST-A')
    saveBestGhost('song', 7, 80_000, 'GHOST-B')
    expect(loadRecord('song', 7)!.bestGhost).toBe('GHOST-B')
  })

  it('V28: same song, different seed = separate boards', () => {
    saveRun('song', 1, 'SONG', run(90_000))
    saveRun('song', 2, 'SONG', run(70_000))
    expect(loadRecord('song', 1)!.bestTimeMs).toBe(90_000)
    expect(loadRecord('song', 2)!.bestTimeMs).toBe(70_000)
    expect(recordKey('song', 1)).not.toBe(recordKey('song', 2))
  })

  it('LRU-caps stored records at 20', () => {
    for (let i = 0; i < 25; i++) saveRun(`song-${i}`, i, `S${i}`, run(60_000 + i))
    const all = JSON.parse(backing.get('wave-rider-records')!) as Record<string, unknown>
    expect(Object.keys(all).length).toBe(20)
    // newest survive
    expect(loadRecord('song-24', 24)).not.toBeNull()
  })

  it('survives corrupt storage', () => {
    backing.set('wave-rider-records', 'nope{')
    expect(loadRecord('song', 7)).toBeNull()
    expect(saveRun('song', 7, 'SONG', run(90_000)).newBest).toBe(true)
  })
})
