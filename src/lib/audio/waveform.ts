/** Downsample PCM to per-bin peaks 0..1 for menu waveform displays (T34). */
export function computeWaveform(pcm: Float32Array, bins = 96): number[] {
  const out = new Array<number>(bins).fill(0)
  const per = Math.max(1, Math.floor(pcm.length / bins))
  for (let b = 0; b < bins; b++) {
    let peak = 0
    const end = Math.min(pcm.length, (b + 1) * per)
    for (let i = b * per; i < end; i += 4) {
      const v = Math.abs(pcm[i])
      if (v > peak) peak = v
    }
    out[b] = peak
  }
  const max = Math.max(0.001, ...out)
  return out.map((v) => Math.round((v / max) * 100) / 100)
}

export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
