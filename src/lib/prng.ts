/**
 * Deterministic PRNG + hashing for track generation (V1, V8).
 * Track gen must never touch Math.random — all randomness flows from here,
 * seeded by audio features.
 */

/** FNV-1a 32-bit hash over a float array (quantized) + string tag. */
export function hashFeatures(tag: string, values: ArrayLike<number>): number {
  let h = 0x811c9dc5
  for (let i = 0; i < tag.length; i++) {
    h ^= tag.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  for (let i = 0; i < values.length; i++) {
    // quantize to avoid float noise differences across runs of same input
    const q = Math.round(values[i] * 1e4) | 0
    h ^= q & 0xff
    h = Math.imul(h, 0x01000193)
    h ^= (q >>> 8) & 0xff
    h = Math.imul(h, 0x01000193)
    h ^= (q >>> 16) & 0xff
    h = Math.imul(h, 0x01000193)
    h ^= (q >>> 24) & 0xff
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export type Rng = () => number

/** mulberry32 — small, fast, deterministic. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function rngRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}

export function rngPick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]
}
