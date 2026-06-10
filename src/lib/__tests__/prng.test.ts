import { describe, expect, it } from 'vitest'
import { hashFeatures, mulberry32 } from '../prng'

describe('prng (V1, V8 foundations)', () => {
  it('mulberry32 same seed → identical sequence', () => {
    const a = mulberry32(123456)
    const b = mulberry32(123456)
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b())
  })

  it('mulberry32 different seed → different sequence', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 10 }, a)
    const seqB = Array.from({ length: 10 }, b)
    expect(seqA).not.toEqual(seqB)
  })

  it('hashFeatures stable for identical input, sensitive to change', () => {
    const v = [1.5, 2.25, 100.125, 0.0001]
    expect(hashFeatures('tag', v)).toBe(hashFeatures('tag', v))
    expect(hashFeatures('tag', v)).not.toBe(hashFeatures('tag', [1.5, 2.25, 100.125, 0.0002]))
    expect(hashFeatures('tag', v)).not.toBe(hashFeatures('other', v))
  })
})
