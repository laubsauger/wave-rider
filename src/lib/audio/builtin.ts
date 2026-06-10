/**
 * Built-in soundtrack (T12): songs synthesized in pure TS — original
 * material, zero licensing, fully deterministic (same seed → same PCM →
 * same track, V1). Rendered on demand at 44100Hz mono.
 */
import { mulberry32, type Rng } from '../prng'

export const SR = 44100

export interface SongSpec {
  id: string
  title: string
  bpm: number
  seconds: number
  seed: number
  /** 0..1 — drives arrangement density */
  heat: number
  /** semitone offsets from root for the bass scale */
  scale: number[]
  rootHz: number
}

export const BUILTIN_SONGS: SongSpec[] = [
  {
    id: 'neon-surge',
    title: 'NEON SURGE',
    bpm: 142,
    seconds: 150,
    seed: 0xc0ffee,
    heat: 0.95,
    scale: [0, 3, 5, 7, 10],
    rootHz: 55,
  },
  {
    id: 'hyperglide',
    title: 'HYPERGLIDE',
    bpm: 126,
    seconds: 160,
    seed: 0xbeef42,
    heat: 0.7,
    scale: [0, 2, 5, 7, 9],
    rootHz: 49,
  },
  {
    id: 'midnight-drift',
    title: 'MIDNIGHT DRIFT',
    bpm: 96,
    seconds: 170,
    seed: 0x5eaf00d,
    heat: 0.35,
    scale: [0, 3, 7, 10, 12],
    rootHz: 41.2,
  },
]

/** Render a song spec to mono PCM. Pure — only seeded randomness. */
export function renderSong(spec: SongSpec): Float32Array {
  const n = SR * spec.seconds
  const pcm = new Float32Array(n)
  const rng = mulberry32(spec.seed)
  const beat = (60 / spec.bpm) * SR
  const bar = beat * 4
  const totalBars = Math.ceil(n / bar)

  // bassline: one note per half-bar from the scale, seeded walk
  const bassNotes: number[] = []
  let degree = 0
  for (let i = 0; i < totalBars * 2; i++) {
    degree = walk(rng, degree, spec.scale.length)
    bassNotes.push(spec.rootHz * Math.pow(2, spec.scale[degree] / 12))
  }
  // lead motif: 8 steps reused with variation
  const motif: number[] = []
  for (let i = 0; i < 8; i++) {
    motif.push(spec.rootHz * 4 * Math.pow(2, spec.scale[Math.floor(rng() * spec.scale.length)] / 12))
  }

  const noise = mulberry32(spec.seed ^ 0x9e3779b9)

  for (let i = 0; i < n; i++) {
    const t = i / SR
    const pos = i / n // 0..1 through the song
    // arrangement envelope: intro → build → drop → outro
    const arr =
      pos < 0.1 ? pos / 0.1 * 0.4 : pos < 0.3 ? 0.4 + ((pos - 0.1) / 0.2) * 0.3 : pos < 0.85 ? 1 : 1 - ((pos - 0.85) / 0.15) * 0.7

    const beatPhase = (i % beat) / beat
    const halfBarIdx = Math.floor(i / (bar / 2)) % bassNotes.length
    const stepIdx = Math.floor(i / (beat / 2)) % 8

    let v = 0
    // kick: every beat, stronger after build
    if (arr > 0.35) {
      const kickT = beatPhase * (60 / spec.bpm)
      v += Math.sin(2 * Math.PI * 50 * kickT * Math.exp(-kickT * 9)) * Math.exp(-kickT * 18) * 0.9 * arr
    }
    // bass: square-ish
    const bHz = bassNotes[halfBarIdx]
    const sq = Math.sign(Math.sin(2 * Math.PI * bHz * t)) * 0.5 + Math.sin(2 * Math.PI * bHz * t) * 0.5
    v += sq * 0.22 * arr * (0.6 + spec.heat * 0.4)
    // lead: saw motif, only past intro, gated 16ths by heat
    if (arr > 0.6) {
      const lHz = motif[stepIdx]
      const saw = 2 * ((t * lHz) % 1) - 1
      const gate = spec.heat > 0.5 || stepIdx % 2 === 0 ? 1 : 0
      v += saw * 0.13 * gate * arr
    }
    // hats: offbeat noise ticks
    const offbeat = ((i + beat / 2) % beat) / beat
    if (offbeat < 0.04 && arr > 0.5) {
      v += (noise() * 2 - 1) * (1 - offbeat / 0.04) * 0.18 * spec.heat
    }
    // air pad for chill ends of the spectrum
    v += Math.sin(2 * Math.PI * spec.rootHz * 2 * t) * 0.06 * (1 - spec.heat) * arr

    pcm[i] = Math.tanh(v * 1.4) * 0.9
  }
  return pcm
}

export function pcmToAudioBuffer(pcm: Float32Array, ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, pcm.length, SR)
  buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0)
  return buf
}

function walk(rng: Rng, current: number, len: number): number {
  const r = rng()
  if (r < 0.4) return current
  if (r < 0.7) return (current + 1) % len
  if (r < 0.9) return (current + len - 1) % len
  return Math.floor(rng() * len)
}
