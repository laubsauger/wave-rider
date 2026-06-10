/** Minimal radix-2 in-place FFT. Input length must be a power of two. */
export function fftMag(re: Float32Array, im: Float32Array): Float32Array {
  const n = re.length
  if ((n & (n - 1)) !== 0) throw new Error(`fft length not power of two: ${n}`)

  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }

  const mags = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    mags[i] = Math.hypot(re[i], im[i])
  }
  return mags
}

/** Hann window applied in place. */
export function hann(buf: Float32Array): void {
  const n = buf.length
  for (let i = 0; i < n; i++) {
    buf[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
  }
}
